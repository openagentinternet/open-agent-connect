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
import { runMetabotWithPayloadFile } from './cli-payload.js'

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
    case 'schedule/create': {
      const from = textArg(body, 'from')
      const name = textArg(body, 'name')
      const prompt = textArg(body, 'prompt')
      if (!name) return failure('invalid_argument', 'name is required.')
      if (!prompt) return failure('invalid_argument', 'prompt is required.')
      // Schedule selector: exactly one of at (local datetime, no timezone
      // suffix) / everyMs (positive integer) / cron (5-field expression).
      const at = textArg(body, 'at')
      const everyMs = typeof body.everyMs === 'number' && Number.isFinite(body.everyMs)
        ? Math.floor(body.everyMs)
        : null
      const cron = textArg(body, 'cron')
      const selectors = [at !== '', everyMs !== null, cron !== ''].filter(Boolean).length
      if (selectors !== 1) {
        return failure('invalid_argument', 'Exactly one of at, everyMs, or cron is required.')
      }
      const channel = textArg(body, 'channel')
      if (channel !== '' && !['auto', 'host', 'daemon'].includes(channel)) {
        return failure('invalid_argument', 'channel must be auto, host, or daemon.')
      }
      return run([
        'schedule', 'create',
        ...withFrom(from),
        '--name', name,
        '--prompt', prompt,
        ...(at !== '' ? ['--at', at] : []),
        ...(everyMs !== null ? ['--every', String(everyMs)] : []),
        ...(cron !== '' ? ['--cron', cron] : []),
        ...(channel !== '' ? ['--channel', channel] : []),
        ...(body.enabled === false ? ['--disabled'] : []),
      ], { timeoutMs: CLI_TIMEOUT_MS })
    }
    case 'schedule/update': {
      const from = textArg(body, 'from')
      const id = textArg(body, 'id')
      if (!id) return failure('missing_id', 'id is required.')
      // The update verb takes a partial CreateScheduleTaskInput via
      // --payload-file; keep the payload strictly the editable fields.
      const patch: Record<string, unknown> = {}
      if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
      if (typeof body.prompt === 'string' && body.prompt.trim()) patch.prompt = body.prompt.trim()
      if (typeof body.channel === 'string' && ['auto', 'host', 'daemon'].includes(body.channel)) {
        patch.channel = body.channel
      }
      const at = textArg(body, 'at')
      const everyMs = typeof body.everyMs === 'number' && Number.isFinite(body.everyMs)
        ? Math.floor(body.everyMs)
        : null
      const cron = textArg(body, 'cron')
      const selectors = [at !== '', everyMs !== null, cron !== ''].filter(Boolean).length
      if (selectors > 1) {
        return failure('invalid_argument', 'At most one of at, everyMs, or cron may be given.')
      }
      if (at !== '') patch.schedule = { type: 'at', datetime: at }
      if (everyMs !== null) patch.schedule = { type: 'interval', intervalMs: everyMs }
      if (cron !== '') patch.schedule = { type: 'cron', expression: cron }
      if (Object.keys(patch).length === 0) {
        return failure('invalid_argument', 'Nothing to update.')
      }
      return runMetabotWithPayloadFile(
        ['schedule', 'update', ...withFrom(from), '--id', id],
        patch,
        '--payload-file',
        [],
        run,
        { timeoutMs: CLI_TIMEOUT_MS },
      )
    }
    case 'schedule/delete': {
      const from = textArg(body, 'from')
      const id = textArg(body, 'id')
      if (!id) return failure('missing_id', 'id is required.')
      return run(['schedule', 'delete', ...withFrom(from), '--id', id, '--confirm'], { timeoutMs: CLI_TIMEOUT_MS })
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
