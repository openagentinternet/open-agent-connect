/**
 * Surf routes — the host surface for the bot editor's Advanced-tab surf
 * section, mirroring the IDBots surf:* IPC. Reads (surf/status) run
 * in-process against the OAC core stores; writes (surf/run, surf/enable,
 * surf/disable, surf/budget) forward to the `metabot surf` CLI verbs so the
 * daemon owns the actual run lifecycle. `surf/run` is fire-and-forget by
 * design (the run is unattended); the panel polls `surf/status` for the
 * running state and refreshes on settle.
 */
import { runMetabot, type MetabotCommandResult, type RunMetabotOptions } from './cli-bridge.js'

const CLI_TIMEOUT_MS = 60_000

export interface SurfRouteDeps {
  run?: (args: string[], options?: RunMetabotOptions) => Promise<MetabotCommandResult>
}

function failure(code: string, message: string): MetabotCommandResult {
  return { ok: false, state: 'failed', code, message }
}

function payloadObject(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {}
}

function textArg(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  return typeof value === 'string' ? value.trim() : ''
}

function numberArg(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Returns a handled result, or `undefined` to keep dispatching. */
export async function dispatchSurfRoutes(
  method: string,
  payload: unknown,
  deps: SurfRouteDeps = {},
): Promise<MetabotCommandResult | undefined> {
  const run = deps.run ?? runMetabot
  const body = payloadObject(payload)

  const withFrom = (slug: string): string[] => (slug ? ['--from', slug] : [])

  switch (method) {
    case 'surf/status': {
      const slug = textArg(body, 'from')
      const limit = numberArg(body, 'limit')
      return run([
        'surf', 'status',
        ...withFrom(slug),
        ...(limit !== undefined ? ['--limit', String(Math.max(1, Math.min(50, Math.floor(limit))))] : []),
      ], { timeoutMs: CLI_TIMEOUT_MS })
    }
    case 'surf/run': {
      const slug = textArg(body, 'from')
      const triggerRaw = textArg(body, 'trigger')
      const trigger = triggerRaw === 'manual-chat' || triggerRaw === 'pre-dream' ? triggerRaw : 'manual-ui'
      return run([
        'surf', 'run',
        ...withFrom(slug),
        '--trigger', trigger,
      ], { timeoutMs: CLI_TIMEOUT_MS })
    }
    case 'surf/enable': {
      const slug = textArg(body, 'from')
      return run(['surf', 'enable', ...withFrom(slug)], { timeoutMs: CLI_TIMEOUT_MS })
    }
    case 'surf/disable': {
      const slug = textArg(body, 'from')
      return run(['surf', 'disable', ...withFrom(slug)], { timeoutMs: CLI_TIMEOUT_MS })
    }
    case 'surf/budget': {
      const slug = textArg(body, 'from')
      const budget = numberArg(body, 'budget')
      if (budget === undefined || !Number.isInteger(budget) || budget < 0 || budget > 100) {
        return failure('invalid_budget', 'budget must be an integer between 0 and 100.')
      }
      return run(['surf', 'budget', ...withFrom(slug), String(budget)], { timeoutMs: CLI_TIMEOUT_MS })
    }
    default:
      return undefined
  }
}
