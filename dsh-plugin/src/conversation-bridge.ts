/**
 * A2A conversation bridge (host half).
 *
 * The A2A Chat panel should show the same enriched rows the OAC
 * `/ui/conversations` page renders: peer names/avatars resolved through the
 * daemon's profile index + chain-profile cache. That enrichment lives in the
 * daemon (`/api/conversations*`), so these helpers reach it over loopback
 * HTTP instead of booting a CLI (slow) or reading the raw on-disk projection
 * (no enrichment — outbound-only peers stay nameless). When the daemon is
 * unreachable the readers return null and the caller falls back to the
 * in-process read and then the CLI.
 */
import { get as httpGet } from 'node:http'
import { resolveDaemonBaseUrl } from './browser-bridge.js'
import type { MetabotCommandResult } from './cli-bridge.js'
import type { PluginHttpRequest, PluginHttpResponse } from './context-types.js'
import { writeJson } from './http.js'

const DAEMON_JSON_TIMEOUT_MS = 10_000
// The daemon itself may walk several upstream content URLs (4.5 s each)
// before an avatar resolves, so this proxy has to outlast that worst case.
const AVATAR_PROXY_TIMEOUT_MS = 30_000

function isEnvelope(value: unknown): value is MetabotCommandResult {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as { ok?: unknown }).ok === 'boolean'
}

/** GET one daemon JSON endpoint. Null means "transport failed — try the next source". */
function daemonGetJson(baseUrl: string, path: string): Promise<MetabotCommandResult | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: MetabotCommandResult | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const request = httpGet(`${baseUrl}${path}`, (response) => {
      response.setEncoding('utf8')
      let body = ''
      response.on('data', (chunk: string) => { body += chunk })
      response.on('end', () => {
        try {
          const parsed: unknown = JSON.parse(body)
          finish(isEnvelope(parsed) ? parsed : null)
        } catch {
          finish(null)
        }
      })
      response.on('error', () => finish(null))
    })
    const timer = setTimeout(() => {
      request.destroy()
      finish(null)
    }, DAEMON_JSON_TIMEOUT_MS)
    request.on('error', () => finish(null))
  })
}

/** Enriched conversation summaries from the daemon; null when the daemon cannot be reached. */
export async function daemonConversationsList(from: string, limit?: number): Promise<MetabotCommandResult | null> {
  const baseUrl = await resolveDaemonBaseUrl()
  if (baseUrl === null) return null
  const params = new URLSearchParams({ local: from })
  if (typeof limit === 'number') params.set('limit', String(limit))
  return daemonGetJson(baseUrl, `/api/conversations?${params.toString()}`)
}

/** Enriched conversation thread from the daemon; null when the daemon cannot be reached. */
export async function daemonConversationsMessages(from: string, peer: string): Promise<MetabotCommandResult | null> {
  const baseUrl = await resolveDaemonBaseUrl()
  if (baseUrl === null) return null
  const params = new URLSearchParams({ local: from, peer })
  return daemonGetJson(baseUrl, `/api/conversations/messages?${params.toString()}`)
}

/**
 * Proxy one avatar from the daemon's `/api/file/avatar` (`GET
 * /oac/api/file/avatar?ref=…`) so the web client renders chain avatar
 * references same-origin.
 */
export async function proxyDaemonAvatar(ref: string, res: PluginHttpResponse): Promise<void> {
  const baseUrl = await resolveDaemonBaseUrl()
  if (baseUrl === null) {
    writeJson(res, 404, { ok: false, state: 'failed', code: 'daemon_unreachable', message: 'OAC daemon is not reachable.' })
    return
  }
  let settled = false
  const fail = (status: number, code: string, message: string): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    writeJson(res, status, { ok: false, state: 'failed', code, message })
  }
  const request = httpGet(`${baseUrl}/api/file/avatar?ref=${encodeURIComponent(ref)}`, (response) => {
    const chunks: Buffer[] = []
    response.on('data', (chunk: Buffer) => { chunks.push(Buffer.from(chunk)) })
    response.on('end', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const headers: Record<string, string> = {}
      const contentType = response.headers['content-type']
      if (typeof contentType === 'string' && contentType !== '') headers['content-type'] = contentType
      const cacheControl = response.headers['cache-control']
      if (typeof cacheControl === 'string' && cacheControl !== '') headers['cache-control'] = cacheControl
      res.writeHead(response.statusCode ?? 502, headers)
      res.end(Buffer.concat(chunks))
    })
    response.on('error', (error) => fail(502, 'avatar_proxy', error.message))
  })
  const timer = setTimeout(() => {
    request.destroy()
    fail(504, 'avatar_proxy_timeout', 'Daemon avatar fetch timed out.')
  }, AVATAR_PROXY_TIMEOUT_MS)
  request.on('error', (error) => fail(502, 'avatar_proxy', error.message))
}

/**
 * Pipe the daemon's per-Bot conversation SSE (`/api/conversations/events`)
 * into one DSH client connection (`GET /oac/api/chat/events?from=<slug>`).
 * The daemon emits `conversation-update` when stored rows change and after a
 * cold chain-profile warm-up completes, so the panel can re-pull the enriched
 * list. When the daemon stream drops, this response ends and the browser
 * EventSource reconnects on its own.
 */
export async function streamDaemonConversationEvents(
  req: PluginHttpRequest,
  res: PluginHttpResponse,
  from: string,
): Promise<void> {
  const baseUrl = await resolveDaemonBaseUrl()
  if (baseUrl === null) {
    writeJson(res, 503, { ok: false, state: 'failed', code: 'daemon_unreachable', message: 'OAC daemon is not reachable.' })
    return
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  res.write?.('retry: 3000\n\n')
  let closed = false
  const endResponse = (): void => {
    if (closed) return
    closed = true
    try {
      res.end?.()
    } catch {
      // already ended
    }
  }
  const daemonRequest = httpGet(`${baseUrl}/api/conversations/events?local=${encodeURIComponent(from)}`, (response) => {
    if (response.statusCode !== 200) {
      response.resume()
      endResponse()
      return
    }
    response.setEncoding('utf8')
    response.on('data', (chunk: string) => {
      if (closed) return
      try {
        res.write?.(chunk)
      } catch {
        // a broken connection is torn down via req close below
      }
    })
    response.on('end', endResponse)
    response.on('error', endResponse)
  })
  daemonRequest.on('error', endResponse)
  req.on?.('close', () => {
    daemonRequest.destroy()
    endResponse()
  })
}
