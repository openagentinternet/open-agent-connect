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
import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { get as httpGet } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { resolveMetabotCliPath } from './cli-bridge.js'
import {
  normalizeBotBrowserUri,
  resolveBrowserPath,
  type BrowserCommandRequest,
  type BrowserCommandResult,
  type BrowserCatalogEntry,
  type BrowserOpenSource,
  type BrowserSnapshot,
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
  | { event: 'browser-catalog'; data: { apps: BrowserCatalogEntry[] } }

const COMMAND_TIMEOUT_MS = 10_000

const EMPTY_SNAPSHOT: BrowserSnapshot = { open: false, tabs: [] }

export { resolveBrowserPath }

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/u, '')
}

function systemMetabotRoot(env: NodeJS.ProcessEnv): string {
  return join(env.HOME ?? homedir(), '.metabot')
}

// ---------------------------------------------------------------------------
// Daemon-record trust (task-67 lesson): a stale or FOREIGN daemon record —
// e.g. an old global `metabot` install auto-starting its own daemon and
// overwriting ~/.metabot/runtime/daemon.json — makes pinned pollers talk to a
// daemon that lacks the current routes ("No route matched"). The record's
// runtimeFingerprint identifies the build that started the daemon; a mismatch
// with the local CLI build means the record is not ours — fail closed.
// ---------------------------------------------------------------------------

/**
 * Mirror of the CLI's getDaemonRuntimeFingerprint (src/cli/runtime.ts):
 * sha256 over sorted "relpath:size:mtimeFloor" entries for every .js file
 * under the resolved CLI's dist root. MUST stay algorithm-identical — a
 * drifted copy fails closed (pollers skip every tick). Exported so tests can
 * mint records that match a fixture dist tree.
 */
export function computeDaemonRuntimeFingerprint(distRoot: string): string {
  const entries: string[] = []
  const walk = (directory: string): void => {
    for (const dirent of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, dirent.name)
      if (dirent.isDirectory()) {
        walk(absolutePath)
        continue
      }
      if (!dirent.isFile() || !absolutePath.endsWith('.js')) continue
      const stat = statSync(absolutePath)
      entries.push(`${relative(distRoot, absolutePath)}:${stat.size}:${Math.floor(stat.mtimeMs)}`)
    }
  }
  walk(distRoot)
  entries.sort()
  return createHash('sha256').update(entries.join('\n')).digest('hex')
}

const FINGERPRINT_CACHE_MS = 60_000
let fingerprintCache: { key: string; value: string | null; computedAt: number } | null = null

/** Fingerprint of the dist tree the plugin's CLI resolution points at (cached 60s per dist root). */
function localDaemonRuntimeFingerprint(env: NodeJS.ProcessEnv): string | null {
  let cliPath: string | undefined
  try {
    cliPath = resolveMetabotCliPath(env)
  } catch {
    return null
  }
  if (!cliPath) return null
  const distRoot = resolve(dirname(dirname(cliPath)))
  const now = Date.now()
  if (fingerprintCache && fingerprintCache.key === distRoot && now - fingerprintCache.computedAt < FINGERPRINT_CACHE_MS) {
    return fingerprintCache.value
  }
  let value: string | null = null
  try {
    value = computeDaemonRuntimeFingerprint(distRoot)
  } catch {
    value = null
  }
  fingerprintCache = { key: distRoot, value, computedAt: now }
  return value
}

/**
 * Best-effort daemon base URL: the explicit env override wins, then the
 * daemon record `metabot daemon start` writes. A record whose
 * runtimeFingerprint does not match the local CLI build is rejected (foreign
 * or stale daemon) — onReject explains the refusal for host-side logs.
 */
export async function resolveDaemonBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
  options: { onReject?: (reason: string) => void } = {},
): Promise<string | null> {
  const explicit = (env.METABOT_DAEMON_BASE_URL ?? '').trim()
  if (explicit) return normalizeBaseUrl(explicit)
  try {
    const raw = await readFile(join(systemMetabotRoot(env), 'runtime', 'daemon.json'), 'utf8')
    const record = JSON.parse(raw) as { baseUrl?: unknown; runtimeFingerprint?: unknown }
    if (typeof record.baseUrl === 'string' && record.baseUrl.trim() !== '') {
      const recorded = typeof record.runtimeFingerprint === 'string' ? record.runtimeFingerprint : ''
      const local = localDaemonRuntimeFingerprint(env)
      if (local && recorded !== local) {
        options.onReject?.(
          `daemon record was written by a different OAC build (recorded fingerprint ${recorded.slice(0, 12) || 'none'}…, local ${local.slice(0, 12)}…) — refusing to pin to it`,
        )
        return null
      }
      return normalizeBaseUrl(record.baseUrl)
    }
  } catch {
    // daemon not bootstrapped yet — caller retries with backoff
  }
  return null
}

export type SseCallbacks = {
  onEvent: (eventName: string, data: string) => void
  onClose: () => void
  onError: (message: string) => void
}

/** Subscribe to one daemon SSE endpoint (frames: `event:`/`data:` lines). */
export function subscribeDaemonSse(url: string, callbacks: SseCallbacks, label = 'daemon sse'): () => void {
  const request = httpGet(url, (response) => {
    if (response.statusCode !== 200) {
      callbacks.onError(`${label} returned HTTP ${response.statusCode ?? 0}`)
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

/** Subscribe to the daemon's `agent-browser:open-tab` SSE stream. */
function subscribeToBrowserEvents(baseUrl: string, callbacks: SseCallbacks): () => void {
  return subscribeDaemonSse(`${baseUrl}/api/browser/events`, callbacks, 'daemon browser events')
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
  private snapshotAt = 0
  private lastOpenTabAt = 0
  private catalog: BrowserCatalogEntry[] = []

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

  /** When the current snapshot was last refreshed (ms epoch; 0 = never). */
  getSnapshotAt(): number {
    return this.snapshotAt
  }

  /**
   * When an open (open event or open-tab command) was last issued (ms epoch;
   * 0 = never). A just-opened page registers in the tab state only when the
   * navigation commits — no-arg readers use this to tell "nothing is open"
   * from "the new page has not landed yet" instead of reporting a false
   * terminal "no page" (N-1).
   */
  getLastOpenAt(): number {
    return this.lastOpenTabAt
  }

  /** Replace the last-reported client snapshot (POST /oac/api/browser/state). */
  applySnapshot(snapshot: BrowserSnapshot): void {
    this.snapshot = {
      open: snapshot.open === true,
      tabs: Array.isArray(snapshot.tabs) ? snapshot.tabs : [],
      rendererType: typeof snapshot.rendererType === 'string' ? snapshot.rendererType : snapshot.rendererType ?? null,
    }
    this.snapshotAt = Date.now()
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

  /** SSE sink for DSH web clients (open + tab commands + search catalog). */
  addClient(listener: (frame: BrowserSseFrame) => void): () => void {
    const id = this.nextClientId
    this.nextClientId += 1
    this.clients.set(id, listener)
    if (this.catalog.length > 0) {
      try {
        listener({ event: 'browser-catalog', data: { apps: this.catalog } })
      } catch {
        // one bad client must not block registration
      }
    }
    return () => { this.clients.delete(id) }
  }

  /** Remember search hits so the web client can turn restated names into links. */
  publishCatalog(apps: BrowserCatalogEntry[]): void {
    this.catalog = apps
    if (apps.length === 0) return
    this.emitFrame({ event: 'browser-catalog', data: { apps } })
  }

  /**
   * Resolve and broadcast one open (agent-driven event or UI-initiated call).
   * Returns the event when the daemon base URL is known, else null.
   */
  open(uri: string | null, source: BrowserOpenSource = 'host'): BrowserOpenEvent | null {
    const baseUrl = this.baseUrl
    if (baseUrl === null) return null
    const resolved = uri && uri.trim() ? (normalizeBotBrowserUri(uri) ?? uri.trim()) : null
    const event: BrowserOpenEvent = {
      uri: resolved,
      localUiUrl: resolved ? `${baseUrl}${resolveBrowserPath(resolved)}` : `${baseUrl}/browser`,
      source,
    }
    this.lastOpenTabAt = Date.now()
    this.snapshot = {
      ...this.snapshot,
      open: true,
      ...(resolved ? {} : { tabs: [], rendererType: null }),
    }
    this.snapshotAt = Date.now()
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
    this.noteCommandResult(result)
    pending.resolve(result)
    return true
  }

  /**
   * Fold one successful client command result into the shared snapshot. The
   * command answer is the freshest client contact (the pushed state report
   * lags behind it), so every reader of getSnapshot() — bot_browser_tabs and
   * the per-turn <browser_context> alike — samples the same, latest truth
   * (N-2). An open-tab answer is a pre-navigation snapshot; that is still the
   * client's own tab list at that moment, and the following state report
   * overwrites it when the page commits.
   */
  private noteCommandResult(result: BrowserCommandResult): void {
    if (!result.ok) return
    if (result.action === 'open-tab') this.lastOpenTabAt = Date.now()
    if (!Array.isArray(result.tabs)) return
    this.snapshot = { ...this.snapshot, open: true, tabs: result.tabs }
    this.snapshotAt = Date.now()
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
