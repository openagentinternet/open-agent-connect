/**
 * MetaTask host routes: `/oac/api/metatask/*` -> `metabot metatask …`.
 * Same bridge pattern as grouptask.ts: a method dispatcher returning
 * undefined for non-metatask methods so index.ts can chain dispatchers.
 * Read-only verbs today — the panel never writes (participation drafts are
 * the UI's write surface, P4 skills own the actual flows).
 */
import { runMetabot, type MetabotCommandResult } from './cli-bridge.js'

type RunMetabot = typeof runMetabot

export interface MetaTaskRouteDeps {
  run?: RunMetabot
}

const READ_TIMEOUT_MS = 60_000
const REFRESH_TIMEOUT_MS = 180_000

function payloadObject(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {}
}

function readTrimmed(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Dispatch a `metatask/*` API method. Returns undefined when the method is
 * not a metatask route (lets index.ts fall through to other dispatchers).
 */
export async function dispatchMetaTaskRoutes(
  method: string,
  payload: unknown,
  deps: MetaTaskRouteDeps = {},
): Promise<MetabotCommandResult | undefined> {
  if (!method.startsWith('metatask/')) return undefined
  const run = deps.run ?? runMetabot
  const body = payloadObject(payload)

  if (method === 'metatask/board') {
    const args = ['metatask', 'list']
    if (body.refresh === true) args.push('--refresh')
    return run(args, { timeoutMs: body.refresh === true ? REFRESH_TIMEOUT_MS : READ_TIMEOUT_MS })
  }

  if (method === 'metatask/task') {
    const root = readTrimmed(body, 'root')
    if (!root) return { ok: false, state: 'failed', code: 'missing_root', message: 'root is required' }
    const args = ['metatask', 'get', '--root', root]
    if (body.refresh === true) args.push('--refresh')
    return run(args, { timeoutMs: body.refresh === true ? REFRESH_TIMEOUT_MS : READ_TIMEOUT_MS })
  }

  if (method === 'metatask/replay') {
    const root = readTrimmed(body, 'root')
    if (!root) return { ok: false, state: 'failed', code: 'missing_root', message: 'root is required' }
    return run(['metatask', 'replay', '--root', root], { timeoutMs: READ_TIMEOUT_MS })
  }

  if (method === 'metatask/refresh') {
    return run(['metatask', 'refresh'], { timeoutMs: REFRESH_TIMEOUT_MS })
  }

  return { ok: false, state: 'failed', code: 'unknown_metatask_method', message: `Unknown metatask method: ${method}` }
}
