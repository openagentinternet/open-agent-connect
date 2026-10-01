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
import type { HostContext } from './context-types.js'

const CLI_TIMEOUT_MS = 60_000

export interface ScheduleRouteDeps {
  run?: (args: string[], options?: RunMetabotOptions) => Promise<MetabotCommandResult>
  ctx?: HostContext
}

type OfficialScheduleRecord = {
  id: string
  kind: 'after' | 'at' | 'every' | 'daily' | 'weekly' | 'cron'
  title: string
  prompt: string
  scheduledAt: string
  afterSeconds?: number
  everySeconds?: number
  time?: string
  timeZone?: string
  expression?: string
  sessionId: string
  status: 'active' | 'inactive'
  lastDelivery?: { deliveredAt?: string }
}

type OfficialScheduleService = {
  create(sessionId: string, request: Record<string, unknown>): Promise<OfficialScheduleRecord>
  catalog(): Promise<OfficialScheduleRecord[]>
  delete(request: { sessionId: string; id: string }): Promise<unknown>
  update(request: Record<string, unknown>): Promise<unknown>
}

function officialScheduleOf(ctx?: HostContext): OfficialScheduleService | undefined {
  return ctx?.get?.('schedule') as OfficialScheduleService | undefined
}

function sessionControllerOf(ctx?: HostContext): { create(request: Record<string, unknown>): Promise<unknown> } | undefined {
  return ctx?.get?.('sessionController') as { create(request: Record<string, unknown>): Promise<unknown> } | undefined
}

function officialSessionId(slug: string): string {
  return `oac-schedule-${slug}`
}

async function ensureOfficialSession(ctx: HostContext | undefined, slug: string): Promise<string> {
  const sessionId = officialSessionId(slug)
  const controller = sessionControllerOf(ctx)
  if (!controller) throw new Error('DSH session controller is not available')
  await controller.create({ sessionId, agentPreset: `oac-${slug}`, cwd: process.cwd() })
  return sessionId
}

function officialTaskRow(task: OfficialScheduleRecord, slug: string): Record<string, unknown> {
  const schedule = task.kind === 'every'
    ? { type: 'interval', intervalMs: (task.everySeconds ?? 0) * 1000 }
    : task.kind === 'cron'
      ? { type: 'cron', expression: task.expression ?? '' }
      : { type: 'at', datetime: task.scheduledAt }
  const lastRunAtMs = task.lastDelivery?.deliveredAt ? Date.parse(task.lastDelivery.deliveredAt) : null
  return {
    id: task.id, name: task.title, description: '', enabled: task.status === 'active', schedule,
    prompt: task.prompt, workingDirectory: process.cwd(), channel: 'host', expiresAt: null,
    state: { nextRunAtMs: Date.parse(task.scheduledAt), lastRunAtMs, lastStatus: lastRunAtMs === null ? null : 'success', lastError: null, lastDurationMs: null, runningAtMs: null, consecutiveErrors: 0 },
    createdAt: task.scheduledAt, updatedAt: task.scheduledAt, botSlug: slug,
  }
}

function slugForOfficialSession(sessionId: string): string {
  return sessionId.startsWith('oac-schedule-') ? sessionId.slice('oac-schedule-'.length) : sessionId
}

function groupOfficialTasks(tasks: Array<Record<string, unknown>>): Array<{ slug: string; tasks: Array<Record<string, unknown>> }> {
  const groups = new Map<string, Array<Record<string, unknown>>>()
  for (const task of tasks) {
    const slug = String(task.botSlug ?? '')
    const rows = groups.get(slug) ?? []
    rows.push(task)
    groups.set(slug, rows)
  }
  return [...groups.entries()].map(([slug, rows]) => ({ slug, tasks: rows }))
}

function officialTiming(body: Record<string, unknown>): Record<string, unknown> | undefined {
  const at = textArg(body, 'at')
  const everyMs = typeof body.everyMs === 'number' && Number.isFinite(body.everyMs) ? Math.floor(body.everyMs) : null
  const cron = textArg(body, 'cron')
  if (at) return { at }
  if (everyMs !== null) return { every_seconds: Math.floor(everyMs / 1000) }
  if (cron) return { cron: { expression: cron, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone } }
  return undefined
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
  const official = officialScheduleOf(deps.ctx)
  const from = textArg(body, 'from')

  switch (method) {
    case 'schedule/list': {
      if (official) {
        const catalog = await official.catalog()
        const tasks = catalog
          .filter((task) => body.all === true || slugForOfficialSession(task.sessionId) === from)
          .map((task) => officialTaskRow(task, slugForOfficialSession(task.sessionId)))
        if (body.all === true) return { ok: true, state: 'success', data: { groups: groupOfficialTasks(tasks) } }
        return { ok: true, state: 'success', data: { tasks } }
      }
      if (body.all === true) {
        return run(['schedule', 'list', '--all'], { timeoutMs: CLI_TIMEOUT_MS })
      }
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
      if (official) {
        if (!from) return failure('missing_from', 'from is required.')
        const timing = officialTiming(body)
        if (!timing) return failure('invalid_argument', 'A schedule selector is required.')
        try {
          const sessionId = await ensureOfficialSession(deps.ctx, from)
          const task = await official.create(sessionId, { title: name, prompt, ...timing })
          return { ok: true, state: 'success', data: { task: officialTaskRow(task, from), warnings: [] } }
        } catch (error) {
          return failure('schedule_create_failed', error instanceof Error ? error.message : String(error))
        }
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
      if (official) {
        if (!from) return failure('missing_from', 'from is required.')
        try {
          const catalog = await official.catalog()
          const current = catalog.find((task) => task.id === id && slugForOfficialSession(task.sessionId) === from)
          if (!current) return failure('task_not_found', 'scheduled task not found')
          const change = officialTiming(body)
          const result = await official.update({
            sessionId: current.sessionId,
            id,
            expected: current,
            ...(patch.name ? { title: patch.name } : {}),
            ...(patch.prompt ? { prompt: patch.prompt } : {}),
            ...(change ? {
              change: 'at' in change
                ? { kind: 'at', at: change.at }
                : 'every_seconds' in change
                  ? { kind: 'every', every_seconds: change.every_seconds }
                  : { kind: 'cron', cron: change.cron },
            } : {}),
          }) as { record?: OfficialScheduleRecord }
          return { ok: true, state: 'success', data: { task: result.record ? officialTaskRow(result.record, from) : null, warnings: [] } }
        } catch (error) {
          return failure('schedule_update_failed', error instanceof Error ? error.message : String(error))
        }
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
      const id = textArg(body, 'id')
      if (!id) return failure('missing_id', 'id is required.')
      if (official) {
        if (!from) return failure('missing_from', 'from is required.')
        try {
          const catalog = await official.catalog()
          const current = catalog.find((task) => task.id === id && slugForOfficialSession(task.sessionId) === from)
          if (!current) return failure('task_not_found', 'scheduled task not found')
          await official.delete({ sessionId: current.sessionId, id })
          return { ok: true, state: 'success', data: { deleted: true } }
        } catch (error) {
          return failure('schedule_delete_failed', error instanceof Error ? error.message : String(error))
        }
      }
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
