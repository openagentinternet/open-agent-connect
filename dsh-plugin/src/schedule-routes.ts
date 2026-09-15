/**
 * Scheduled-task routes — the host surface for the A2A panel's "Scheduled"
 * tab, mirroring the surf/grouptask route pattern: reads and enable/disable
 * forward to the `metabot schedule` CLI verbs (the store is per-Bot, so
 * every call carries `from`); `schedule/run` is a manual trigger whose CLI
 * verb executes the whole task inline (an LLM turn that can take minutes),
 * so the route spawns it detached and returns immediately — the view watches
 * the new run row appear through its poll.
 */
import { spawn } from 'node:child_process'
import { runMetabot, resolveCli, type MetabotCommandResult, type RunMetabotOptions } from './cli-bridge.js'

const CLI_TIMEOUT_MS = 60_000

export interface ScheduleRouteDeps {
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

function withFrom(slug: string): string[] {
  return slug ? ['--from', slug] : []
}

/** Fire-and-forget CLI spawn: the manual-run verb executes an LLM turn, so
 *  the route must not hold the HTTP request for it. */
function spawnDetached(args: string[], env: NodeJS.ProcessEnv): void {
  const resolution = resolveCli(env)
  if (!resolution.cliPath) {
    throw new Error('metabot CLI not found')
  }
  const child = spawn(resolution.nodePath, [resolution.cliPath, ...args], {
    env,
    stdio: 'ignore',
    detached: true,
  })
  child.unref()
}

/** Returns a handled result, or `undefined` to keep dispatching. */
export async function dispatchScheduleRoutes(
  method: string,
  payload: unknown,
  deps: ScheduleRouteDeps = {},
): Promise<MetabotCommandResult | undefined> {
  const run = deps.run ?? runMetabot
  const body = payloadObject(payload)

  switch (method) {
    case 'schedule/list': {
      const from = textArg(body, 'from')
      return run(['schedule', 'list', ...withFrom(from)], { timeoutMs: CLI_TIMEOUT_MS })
    }
    case 'schedule/runs': {
      const from = textArg(body, 'from')
      const id = textArg(body, 'id')
      if (!id) return failure('missing_id', 'id is required.')
      const limit = typeof body.limit === 'number' && Number.isFinite(body.limit)
        ? Math.max(1, Math.min(50, Math.floor(body.limit)))
        : undefined
      return run([
        'schedule', 'runs',
        ...withFrom(from),
        '--id', id,
        ...(limit !== undefined ? ['--limit', String(limit)] : []),
      ], { timeoutMs: CLI_TIMEOUT_MS })
    }
    case 'schedule/enable':
    case 'schedule/disable': {
      const from = textArg(body, 'from')
      const id = textArg(body, 'id')
      if (!id) return failure('missing_id', 'id is required.')
      const verb = method === 'schedule/enable' ? 'enable' : 'disable'
      return run(['schedule', verb, ...withFrom(from), '--id', id], { timeoutMs: CLI_TIMEOUT_MS })
    }
    case 'schedule/run': {
      const from = textArg(body, 'from')
      const id = textArg(body, 'id')
      if (!id) return failure('missing_id', 'id is required.')
      try {
        spawnDetached(['schedule', 'run', ...withFrom(from), '--id', id], process.env)
        return { ok: true, state: 'success', data: { started: true } }
      } catch (error) {
        return failure('schedule_run_start_failed', error instanceof Error ? error.message : String(error))
      }
    }
    default:
      return undefined
  }
}
