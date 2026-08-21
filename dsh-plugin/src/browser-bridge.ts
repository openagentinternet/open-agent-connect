/**
 * Bot Browser bridge (host half).
 *
 * The plugin's DSH web clients render the local OAC Browser — the
 * `localUiUrl` of any Agent Internet resource (`metaid://`, `metaapp://`,
 * `pin://`, ...) — in a wide right sidebar. This module:
 *
 * 1. keeps a persistent SSE subscription to the OAC daemon's
 *    `/api/browser/events` (the same `registerBrowserTabSink` channel the
 *    standalone Browser page uses), so every `metabot browser tab open --uri`
 *    from the `/metabot-browser` skill reaches the plugin as an
 *    `agent-browser:open-tab` event. The skill needs no DSH-specific change
 *    and Codex/other hosts keep their own Browser behavior (when no Browser
 *    page — including this bridge — is open, `pagesReached` is 0 as before),
 * 2. resolves each incoming URI to its clickable `localUiUrl` and fans the
 *    `{ uri, localUiUrl }` pair out to every connected DSH web client, which
 *    opens the right-sidebar Bot Browser on that page,
 * 3. exposes `browser/open` for UI-initiated opens (the Bots section
 *    "Bot Browser" / per-card "Bot Page" buttons).
 *
 * The daemon base URL is read from `METABOT_DAEMON_BASE_URL` or
 * `~/.metabot/runtime/daemon.json` — the file `metabot daemon start` writes,
 * so the CLI and this bridge always agree on the running daemon.
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { get as httpGet } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  BrowserCommandRequest,
  BrowserCommandResult,
  BrowserOpenSource,
  BrowserSnapshot,
} from './browser-protocol.js'

/** One open request fanned out to the DSH web clients. */
export interface BrowserOpenEvent {
  uri: string | null
  localUiUrl: string
  /** daemon = ABC iframe already received the open; host = DSH must navigate. */
  source: BrowserOpenSource
}

export type BrowserSseFrame =
  | { event: 'browser-open'; data: BrowserOpenEvent }
  | { event: 'browser-command'; data: BrowserCommandRequest }

const COMMAND_TIMEOUT_MS = 10_000

const EMPTY_SNAPSHOT: BrowserSnapshot = { open: false, tabs: [] }

/** Deep-link schemes `metabot browser` maps to `/browser/<scheme>/<id>` paths. */
const BROWSER_DEEP_LINK_SCHEMES = new Set(['metaid', 'metaapp', 'metafile', 'pin'])
const BROWSER_PIN_ID_PATTERN = /^[0-9a-f]{64}i0$/iu
const BROWSER_DOMAIN_ALIAS_PATTERN = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu
const PREVIEW_METAAPP_URI_PATTERN = /^preview-metaapp:\/\/([^/?#]+)(\/.*)?$/iu

/**
 * Mirror of OAC's `resolveLocalBrowserPath` (src/cli/runtime.ts) so the
 * bridge and the CLI produce byte-identical `/browser/...` path forms for the
 * same URI without spawning a process per open.
 */
export function resolveBrowserPath(uri: string): string {
  const trimmedUri = uri.trim()
  const match = trimmedUri === uri
    ? /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)$/iu.exec(uri)
    : null
  const scheme = match?.[1]?.toLowerCase()
  const resourceId = match?.[2]
  if (scheme && resourceId && BROWSER_DEEP_LINK_SCHEMES.has(scheme)) {
    return `/browser/${scheme}/${encodeURIComponent(resourceId)}`
  }
  const previewMatch = trimmedUri === uri ? PREVIEW_METAAPP_URI_PATTERN.exec(uri) : null
  if (previewMatch) {
    const host = previewMatch[1]
    const rawPath = previewMatch[2] || ''
    const segments = rawPath.split('/').filter(Boolean).map((segment) => encodeURIComponent(segment))
    const pathSuffix = segments.length ? '/' + segments.join('/') : ''
    return `/browser/preview-metaapp/${encodeURIComponent(host)}${pathSuffix}`
  }
  if (!match && trimmedUri === uri && BROWSER_PIN_ID_PATTERN.test(uri)) {
    return `/browser/pin/${encodeURIComponent(uri)}`
  }
  if (!match && trimmedUri === uri && BROWSER_DOMAIN_ALIAS_PATTERN.test(uri)) {
    return `/browser/metaid/${encodeURIComponent(uri)}`
  }
  const query = new URLSearchParams()
  query.set('uri', uri)
  return `/browser?${query.toString()}`
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/u, '')
}

function systemMetabotRoot(env: NodeJS.ProcessEnv): string {
  return join(env.HOME ?? homedir(), '.metabot')
}

/**
 * Best-effort daemon base URL: the explicit env override wins, then the
 * daemon record `metabot daemon start` writes.
 */
export async function resolveDaemonBaseUrl(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const explicit = (env.METABOT_DAEMON_BASE_URL ?? '').trim()
  if (explicit) return normalizeBaseUrl(explicit)
  try {
    const raw = await readFile(join(systemMetabotRoot(env), 'runtime', 'daemon.json'), 'utf8')
    const record = JSON.parse(raw) as { baseUrl?: unknown }
    if (typeof record.baseUrl === 'string' && record.baseUrl.trim() !== '') {
      return normalizeBaseUrl(record.baseUrl)
    }
  } catch {
    // daemon not bootstrapped yet — caller retries with backoff
  }
  return null
}

type SseCallbacks = {
  onEvent: (eventName: string, data: string) => void
  onClose: () => void
  onError: (message: string) => void
}

/** Subscribe to the daemon's `agent-browser:open-tab` SSE stream. */
function subscribeToBrowserEvents(baseUrl: string, callbacks: SseCallbacks): () => void {
  const request = httpGet(`${baseUrl}/api/browser/events`, (response) => {
    if (response.statusCode !== 200) {
      callbacks.onError(`daemon browser events returned HTTP ${response.statusCode ?? 0}`)
      response.resume()
      return
    }
    response.setEncoding('utf8')
    let buffer = ''
    let eventName = ''
    response.on('data', (chunk: string) => {
      buffer += chunk
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim()
          else if (line.startsWith('data:')) callbacks.onEvent(eventName, line.slice(5).trim())
        }
        eventName = ''
        boundary = buffer.indexOf('\n\n')
      }
    })
    response.on('end', () => callbacks.onClose())
    response.on('error', (error) => callbacks.onError(error.message))
  })
  request.on('error', (error) => callbacks.onError(error.message))
  return () => { request.destroy() }
}

function parseOpenTabData(data: string): string | null {
  try {
    const parsed = JSON.parse(data) as { uri?: unknown }
    return typeof parsed.uri === 'string' ? parsed.uri : null
  } catch {
    return null
  }
}

const RETRY_DELAY_MS = 2_000

/**
 * Cross-process browser-open event hub: the single daemon SSE subscription
 * fans out to every DSH web client, and UI-initiated opens (`browser/open`)
 * ride the same path, so both the agent-driven and the button-driven flows
 * land on identical sidebar behavior.
 */
type PendingCommand = {
  resolve: (result: BrowserCommandResult) => void
  timeout: ReturnType<typeof setTimeout>
}

export class BrowserEventHub {
  private readonly listeners = new Map<number, (event: BrowserOpenEvent) => void>()
  private readonly clients = new Map<number, (frame: BrowserSseFrame) => void>()
  private readonly pending = new Map<string, PendingCommand>()
  private nextListenerId = 0
  private nextClientId = 0
  private baseUrl: string | null = null
  private subscription: (() => void) | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private started = false
  private snapshot: BrowserSnapshot = EMPTY_SNAPSHOT

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  /** Begin (or resume) daemon subscription. Idempotent. */
  start(): void {
    if (this.started) return
    this.started = true
    void this.connect()
  }

  stop(): void {
    this.started = false
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.subscription?.()
    this.subscription = null
    this.listeners.clear()
    this.clients.clear()
    for (const pending of this.pending.values()) clearTimeout(pending.timeout)
    this.pending.clear()
  }

  get daemonBaseUrl(): string | null {
    return this.baseUrl
  }

  getSnapshot(): BrowserSnapshot {
    return this.snapshot
  }

  /** Replace the last-reported client snapshot (POST /oac/api/browser/state). */
  applySnapshot(snapshot: BrowserSnapshot): void {
    this.snapshot = {
      open: snapshot.open === true,
      tabs: Array.isArray(snapshot.tabs) ? snapshot.tabs : [],
      rendererType: typeof snapshot.rendererType === 'string' ? snapshot.rendererType : snapshot.rendererType ?? null,
    }
  }

  clientCount(): number {
    return this.clients.size
  }

  /** Register a web-client listener; returns an unsubscribe function. */
  addListener(listener: (event: BrowserOpenEvent) => void): () => void {
    const id = this.nextListenerId
    this.nextListenerId += 1
    this.listeners.set(id, listener)
    return () => { this.listeners.delete(id) }
  }

  /** SSE sink for DSH web clients (open + tab commands). */
  addClient(listener: (frame: BrowserSseFrame) => void): () => void {
    const id = this.nextClientId
    this.nextClientId += 1
    this.clients.set(id, listener)
    return () => { this.clients.delete(id) }
  }

  /**
   * Resolve and broadcast one open (agent-driven event or UI-initiated call).
   * Returns the event when the daemon base URL is known, else null.
   */
  open(uri: string | null, source: BrowserOpenSource = 'host'): BrowserOpenEvent | null {
    const baseUrl = this.baseUrl
    if (baseUrl === null) return null
    const event: BrowserOpenEvent = {
      uri,
      localUiUrl: uri ? `${baseUrl}${resolveBrowserPath(uri)}` : `${baseUrl}/browser`,
      source,
    }
    this.emitFrame({ event: 'browser-open', data: event })
    for (const listener of this.listeners.values()) {
      try {
        listener(event)
      } catch {
        // one bad listener must not block the rest
      }
    }
    return event
  }

  /**
   * Ask a connected DSH web client to run one ABC tab command and wait for
   * POST /oac/api/browser/command-result. Fails fast when no client is listening.
   */
  requestCommand(
    command: Omit<BrowserCommandRequest, 'requestId'>,
    timeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<BrowserCommandResult> {
    if (this.clients.size === 0) {
      return Promise.resolve({
        requestId: '',
        ok: false,
        error: 'The Bot Browser surface is not open; ask the user to open Bot Browser, or call bot_browser_open_uri first.',
      })
    }
    const requestId = randomUUID()
    const request: BrowserCommandRequest = { ...command, requestId }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        resolve({
          requestId,
          ok: false,
          error: 'Bot Browser did not respond in time. The sidebar may be closed or still loading.',
        })
      }, timeoutMs)
      this.pending.set(requestId, { resolve, timeout })
      this.emitFrame({ event: 'browser-command', data: request })
    })
  }

  completeCommand(result: BrowserCommandResult): boolean {
    const pending = this.pending.get(result.requestId)
    if (!pending) return false
    this.pending.delete(result.requestId)
    clearTimeout(pending.timeout)
    pending.resolve(result)
    return true
  }

  private emitFrame(frame: BrowserSseFrame): void {
    for (const listener of this.clients.values()) {
      try {
        listener(frame)
      } catch {
        // one bad client must not block the rest
      }
    }
  }

  private async connect(): Promise<void> {
    if (!this.started) return
    this.subscription?.()
    this.subscription = null
    const baseUrl = await resolveDaemonBaseUrl(this.env)
    if (baseUrl === null) {
      this.baseUrl = null
      this.scheduleRetry()
      return
    }
    this.baseUrl = baseUrl
    this.subscription = subscribeToBrowserEvents(baseUrl, {
      onEvent: (eventName, data) => {
        if (eventName !== 'agent-browser:open-tab') return
        const uri = parseOpenTabData(data)
        if (uri !== null) this.open(uri, 'daemon')
      },
      onClose: () => this.scheduleRetry(),
      onError: () => this.scheduleRetry(),
    })
  }

  private scheduleRetry(): void {
    if (!this.started || this.retryTimer !== null) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.connect()
    }, RETRY_DELAY_MS)
  }
}
