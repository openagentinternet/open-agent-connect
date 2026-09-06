/**
 * Chat Settings host helpers: the skills catalog and the auto-reply config.
 * The data source is identical to the OAC `/ui/bots` chat settings tab:
 * `services skills` reads the platform skill catalog, auto-reply reads and
 * writes the daemon's `/api/chat/auto-reply/*` routes.
 *
 * Auto-reply goes to the daemon over loopback HTTP first — the CLI path
 * spawned a fresh `metabot` process per call (~2s per Bot-editor open) just to
 * relay the same request. The CLI stays as the fallback when the daemon is
 * unreachable (it also auto-starts the daemon, which the HTTP path cannot).
 */
import { request as httpRequest, type RequestOptions } from 'node:http'
import { resolveDaemonBaseUrl } from './browser-bridge.js'
import { runMetabot, type MetabotCommandResult } from './cli-bridge.js'
import { localChatSkills } from './local-read.js'

const AUTO_REPLY_TIMEOUT_MS = 10_000

function isEnvelope(value: unknown): value is MetabotCommandResult {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as { ok?: unknown }).ok === 'boolean'
}

/** One daemon JSON call (GET or POST). Null means "transport failed — fall back to the CLI". */
function daemonJson(
  baseUrl: string,
  path: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>,
): Promise<MetabotCommandResult | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: MetabotCommandResult | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const options: RequestOptions = { method }
    const payload = method === 'POST' && body !== undefined ? JSON.stringify(body) : undefined
    if (payload !== undefined) options.headers = { 'content-type': 'application/json' }
    const request = httpRequest(`${baseUrl}${path}`, options, (response) => {
      response.setEncoding('utf8')
      let text = ''
      response.on('data', (chunk: string) => { text += chunk })
      response.on('end', () => {
        try {
          const parsed: unknown = JSON.parse(text)
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
    }, AUTO_REPLY_TIMEOUT_MS)
    request.on('error', () => finish(null))
    if (payload !== undefined) request.write(payload)
    request.end()
  })
}

export async function listChatSkills(from: string): Promise<MetabotCommandResult> {
  const local = await localChatSkills(from)
  if (local) return local
  return runMetabot(['services', 'skills', '--from', from])
}

export async function getAutoReplyStatus(from: string): Promise<MetabotCommandResult> {
  const baseUrl = await resolveDaemonBaseUrl()
  if (baseUrl !== null) {
    const direct = await daemonJson(
      baseUrl,
      `/api/chat/auto-reply/status?from=${encodeURIComponent(from)}`,
      'GET',
    )
    if (direct) return direct
  }
  return runMetabot(['chat', 'auto-reply', 'status', '--from', from])
}

export async function setAutoReplyConfig(input: {
  from: string
  enabled?: boolean
  maxTurns?: number
  cooldownMs?: number
}): Promise<MetabotCommandResult> {
  const baseUrl = await resolveDaemonBaseUrl()
  if (baseUrl !== null) {
    const direct = await daemonJson(baseUrl, '/api/chat/auto-reply/config', 'POST', {
      from: input.from,
      ...(typeof input.enabled === 'boolean' ? { enabled: input.enabled } : {}),
      ...(typeof input.maxTurns === 'number' ? { maxTurns: input.maxTurns } : {}),
      ...(typeof input.cooldownMs === 'number' ? { cooldownMs: input.cooldownMs } : {}),
    })
    if (direct) return direct
  }
  const args = ['chat', 'auto-reply', 'config', '--from', input.from]
  if (typeof input.enabled === 'boolean') args.push('--enabled', input.enabled ? 'true' : 'false')
  if (typeof input.maxTurns === 'number') args.push('--max-turns', String(input.maxTurns))
  if (typeof input.cooldownMs === 'number') args.push('--cooldown-ms', String(input.cooldownMs))
  return runMetabot(args)
}
