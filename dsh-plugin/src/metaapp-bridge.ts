/**
 * MetaApp publish progress bridge (host half).
 *
 * The daemon publishes op-keyed stage events for metaapp publish/update
 * (`GET /api/metaapp/events?op=<id>`: archive → upload → write → done|error).
 * This pipes that SSE stream into one DSH client connection
 * (`GET /oac/api/metaapp/events?op=<id>`) so the Apps panel can render real
 * progress instead of a bare spinner. Mirrors the conversation SSE proxy in
 * conversation-bridge.ts.
 */
import { get as httpGet } from 'node:http'
import { resolveDaemonBaseUrl } from './browser-bridge.js'
import type { PluginHttpRequest, PluginHttpResponse } from './context-types.js'
import { writeJson } from './http.js'

export async function streamDaemonMetaAppEvents(
  req: PluginHttpRequest,
  res: PluginHttpResponse,
  op: string,
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
  const daemonRequest = httpGet(`${baseUrl}/api/metaapp/events?op=${encodeURIComponent(op)}`, (response) => {
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
