/**
 * Long-term task board tools (`longtask_*`) — the honest bridge over the OAC
 * CLI `metabot longtask …` surface. This is deliberately NOT the 17-verb
 * IDBots governed lifecycle: the OAC store keeps the state vocabulary (7
 * subtask statuses, 5 task stages, the three read-time derivations) but has
 * no acceptance gates, no evidence/waitNote fields, and no draft→activate
 * ceremony. These six tools describe the surface as it exists; the README
 * carries the condensed differences table so nobody mistakes this for
 * parity. All verbs are flag-only and daemon-free: the CLI handlers are
 * wired in-process to the profile's file-backed store.
 */
import { randomBytes } from 'node:crypto'
import { oacSlugOf } from './browser-tools.js'
import type { RunFn } from './cli-payload.js'
import type { HostAgentLike, HostContext, HostToolDefinition, HostToolExec } from './context-types.js'

/** The 7 stored subtask statuses (mirrors core/longtask/types.ts). */
export const LONGTASK_SUBTASK_STATUSES = [
  'pending', 'in_progress', 'waiting_owner', 'waiting_external',
  'accepted', 'rejected', 'skipped',
] as const
type LongtaskSubtaskStatus = (typeof LONGTASK_SUBTASK_STATUSES)[number]

/**
 * Reference lifecycle moves (mirrors the IDBots state machine). This is a
 * WARNING table, not a gate: the CLI/store accept any transition, and the
 * CLI remains the escape hatch — the plugin appends a warning instead of
 * refusing so an unusual-but-intended move is never blocked.
 */
const ALLOWED_STATUS_MOVES: Record<LongtaskSubtaskStatus, readonly string[]> = {
  pending: ['in_progress', 'skipped'],
  in_progress: ['waiting_owner', 'waiting_external', 'accepted', 'skipped'],
  waiting_owner: ['in_progress', 'accepted', 'rejected', 'skipped'],
  waiting_external: ['in_progress', 'skipped'],
  rejected: ['in_progress', 'skipped'],
  accepted: [],
  skipped: [],
}

/** Local file-backed store — no daemon round trip, 30s is generous. */
const LONGTASK_TIMEOUT_MS = 30_000

/** Event-detail trim budget for the compact show renderer. */
const EVENT_DETAIL_BUDGET = 120

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Tool error convention: a readable STRING the model can act on (the declared
 * output schema is `{ type: 'string' }`, same posture as metaweb-tools).
 */
function toolError(tool: string, message: string): string {
  return `${tool} failed: ${message}`
}

/** Render a MetabotCommandResult envelope; failures keep their code verbatim. */
function envelope(
  tool: string,
  result: { ok: boolean; code?: string; message?: string; data?: unknown },
  render: (data: unknown) => string,
): string {
  if (!result.ok) {
    return toolError(tool, `[${result.code ?? 'failed'}] ${result.message ?? 'command failed'}`)
  }
  return render(result.data)
}

/** uuid-ish slugs so callers never invent identifiers. */
const randomSuffix = (): string => randomBytes(3).toString('hex')
const generateTaskId = (): string => `lt-${Date.now().toString(36)}-${randomSuffix()}`
const generateSubtaskId = (): string => `st-${Date.now().toString(36)}-${randomSuffix()}`

interface LongtaskSubtaskRow {
  id?: unknown
  ordinal?: unknown
  title?: unknown
  status?: unknown
  dependsOn?: unknown
  expectedMinutes?: unknown
}

function subtaskLine(row: LongtaskSubtaskRow): string {
  const deps = Array.isArray(row.dependsOn) ? row.dependsOn.map((dep) => String(dep)) : []
  const estimate = typeof row.expectedMinutes === 'number' ? ` (est: ${row.expectedMinutes}m)` : ''
  return `- [${textOf(row.status) || '?'}] #${String(row.ordinal ?? '?')} ${textOf(row.id)} — ${textOf(row.title)}`
    + (deps.length ? ` (deps: ${deps.join(',')})` : '') + estimate
}

/** Compact board render: one line per derived card, current subtask indented. */
function renderBoard(data: unknown): string {
  const cards = (data as { cards?: unknown })?.cards
  if (!Array.isArray(cards) || cards.length === 0) return 'No long-term tasks on the board.'
  const lines: string[] = []
  for (const entry of cards) {
    const card = entry as {
      task?: { id?: unknown; title?: unknown; stage?: unknown }
      column?: unknown
      progress?: { accepted?: unknown; total?: unknown; percent?: unknown }
      currentSubtask?: LongtaskSubtaskRow | null
    }
    const column = card.column === null || card.column === undefined ? 'off-board' : String(card.column)
    const progress = card.progress ?? {}
    lines.push(
      `- [${column}] ${textOf(card.task?.id)} — ${textOf(card.task?.title)}`
      + ` (${String(progress.accepted ?? 0)}/${String(progress.total ?? 0)}, ${String(progress.percent ?? 0)}%)`
      + ` stage:${textOf(card.task?.stage)}`,
    )
    if (card.currentSubtask) {
      lines.push(`  current: ${subtaskLine(card.currentSubtask).slice(2)}`)
    }
  }
  return lines.join('\n')
}

/** Compact show render: task block + subtask lines + trimmed journal. */
function renderShow(data: unknown): string {
  const payload = (data ?? {}) as {
    task?: { id?: unknown; title?: unknown; goal?: unknown; stage?: unknown; currentSubtaskId?: unknown }
    subtasks?: LongtaskSubtaskRow[]
    events?: Array<{ at?: unknown; actor?: unknown; kind?: unknown; subtaskId?: unknown; detail?: unknown }>
  }
  const task = payload.task ?? {}
  const lines: string[] = [
    `# ${textOf(task.title)} (${textOf(task.id)}) stage:${textOf(task.stage)}`,
    `goal: ${textOf(task.goal) || '(none)'}`,
  ]
  const subtasks = Array.isArray(payload.subtasks) ? [...payload.subtasks] : []
  subtasks.sort((left, right) => Number(left.ordinal ?? 0) - Number(right.ordinal ?? 0))
  lines.push('', '## subtasks', ...(subtasks.length ? subtasks.map(subtaskLine) : ['- (none yet)']))
  const events = Array.isArray(payload.events) ? payload.events : []
  lines.push('', `## journal (${events.length})`)
  let trimmed = 0
  for (const event of events) {
    const detail = textOf(event.detail)
    if (detail.length > EVENT_DETAIL_BUDGET) {
      trimmed += 1
      lines.push(`- ${textOf(event.at)} ${textOf(event.actor)} ${textOf(event.kind)}`
        + `${event.subtaskId ? `/${textOf(event.subtaskId)}` : ''} ${detail.slice(0, EVENT_DETAIL_BUDGET)}…`)
    } else {
      lines.push(`- ${textOf(event.at)} ${textOf(event.actor)} ${textOf(event.kind)}`
        + `${event.subtaskId ? `/${textOf(event.subtaskId)}` : ''} ${detail}`.trimEnd())
    }
  }
  if (trimmed > 0) lines.push(`(${trimmed} event detail(s) trimmed for size)`)
  return lines.join('\n')
}

function renderJson(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

export function buildLongtaskToolDefinitions(input: {
  host: HostContext
  hostAgent: HostAgentLike
  run?: RunFn
}): HostToolDefinition[] {
  const { host, hostAgent } = input
  const run = input.run ?? (async (args, options) => {
    const { runMetabot } = await import('./cli-bridge.js')
    return runMetabot(args, options)
  })

  // Same resolution as metaweb-tools' actorSlug (not exported there; this
  // file must not touch existing ones). Empty slug = no oac preset on this
  // session: omit --from and let the CLI's actor resolution speak for itself.
  const actorSlug = (exec: HostToolExec): string => {
    const agent = exec.agent ?? hostAgent
    const live = oacSlugOf(host, agent)
    if (live) return live
    const preset = host.agentPresets?.composedPreset?.(agent.ctx)
    return typeof preset === 'string' ? preset.replace(/^oac-/, '') : ''
  }

  const argv = (exec: HostToolExec, words: string[]): string[] => {
    const slug = actorSlug(exec)
    return slug ? [...words, '--from', slug] : words
  }

  const render = (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
  ]

  /** Read one task's subtask rows via `longtask show` (shared pre-read). */
  const readSubtasks = async (
    tool: string,
    taskId: string,
    exec: HostToolExec,
  ): Promise<{ error?: string; subtasks?: LongtaskSubtaskRow[] }> => {
    const result = await run(argv(exec, ['longtask', 'show', '--id', taskId]), { timeoutMs: LONGTASK_TIMEOUT_MS })
    if (!result.ok) {
      return { error: envelope(tool, result, () => '') }
    }
    const subtasks = (result.data as { subtasks?: unknown })?.subtasks
    return { subtasks: Array.isArray(subtasks) ? (subtasks as LongtaskSubtaskRow[]) : [] }
  }

  return [
    {
      name: 'longtask_board',
      description:
        'Read the long-term task board: every task with its derived column (waiting_owner/in_progress/'
        + 'waiting_external/defining/paused/done/off-board), progress (accepted/total non-skipped, percent) and '
        + 'the current subtask. This is the list view of the board; open one task in full with longtask_show.',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render },
      timeoutMs: LONGTASK_TIMEOUT_MS,
      execute: async (_args: Record<string, unknown>, exec: HostToolExec) => {
        const result = await run(argv(exec, ['longtask', 'board']), { timeoutMs: LONGTASK_TIMEOUT_MS })
        return envelope('longtask_board', result, renderBoard)
      },
    },
    {
      name: 'longtask_show',
      description:
        'Read one long-term task in full: task header (stage, goal), every subtask (status, ordinal, deps, '
        + 'estimate) and the append-only journal (status moves, advance decisions). Journal event details are '
        + 'trimmed for size with an explicit omission count. The board overview is longtask_board; subtask '
        + 'status moves go through longtask_set_status.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Task id (the `lt-…` slug shown on the board).' },
        },
        required: ['taskId'],
      },
      output: { schema: { type: 'string' }, render },
      timeoutMs: LONGTASK_TIMEOUT_MS,
      execute: async (args: Record<string, unknown>, exec: HostToolExec) => {
        const taskId = textOf(args.taskId)
        if (!taskId) return toolError('longtask_show', 'taskId is required.')
        const result = await run(argv(exec, ['longtask', 'show', '--id', taskId]), { timeoutMs: LONGTASK_TIMEOUT_MS })
        return envelope('longtask_show', result, renderShow)
      },
    },
    {
      name: 'longtask_create',
      description:
        'Create one long-term task on the board. The task id (`lt-…` slug) is generated by this tool — callers '
        + 'never invent one. HONEST LIMIT: the task goes live as stage active IMMEDIATELY (this surface has no '
        + 'draft→activate ceremony), so only create after the plan is agreed. State the goal as the done-ness '
        + 'definition. Subtasks are added one at a time afterwards with longtask_add_subtask.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short task title.' },
          goal: { type: 'string', description: 'The full goal statement including the done-ness definition.' },
        },
        required: ['title', 'goal'],
      },
      output: { schema: { type: 'string' }, render },
      timeoutMs: LONGTASK_TIMEOUT_MS,
      execute: async (args: Record<string, unknown>, exec: HostToolExec) => {
        const title = textOf(args.title)
        const goal = textOf(args.goal)
        if (!title) return toolError('longtask_create', 'title is required.')
        if (!goal) return toolError('longtask_create', 'goal is required.')
        const id = generateTaskId()
        const result = await run(
          argv(exec, ['longtask', 'create', '--id', id, '--title', title, '--goal', goal]),
          { timeoutMs: LONGTASK_TIMEOUT_MS },
        )
        return envelope('longtask_create', result, renderJson)
      },
    },
    {
      name: 'longtask_add_subtask',
      description:
        'Add one subtask (sub-project) to a task created with longtask_create. The subtask id (`st-…` slug) is '
        + 'generated by this tool; the ordinal (board order) is auto-assigned as max+1 from the task\'s existing '
        + 'subtasks unless you pass one. dependsOn lists subtask ids that must be accepted before this one can '
        + 'start. HONEST LIMIT: subtasks carry only {ordinal, title, status, dependsOn} (the store\'s '
        + 'expectedMinutes is not settable through this surface yet) — no description, acceptance criteria or '
        + 'channel fields exist on this board; put the acceptance criteria in the task goal text.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Owning task id (`lt-…` slug).' },
          title: { type: 'string', description: 'Subtask title.' },
          subtaskId: { type: 'string', description: 'Optional explicit subtask id; generated when omitted.' },
          ordinal: { type: 'number', description: 'Optional explicit board ordinal; auto-assigned max+1 when omitted.' },
          dependsOn: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional subtask ids that must be accepted before this one starts.',
          },
        },
        required: ['taskId', 'title'],
      },
      output: { schema: { type: 'string' }, render },
      timeoutMs: LONGTASK_TIMEOUT_MS,
      execute: async (args: Record<string, unknown>, exec: HostToolExec) => {
        const taskId = textOf(args.taskId)
        const title = textOf(args.title)
        if (!taskId) return toolError('longtask_add_subtask', 'taskId is required.')
        if (!title) return toolError('longtask_add_subtask', 'title is required.')
        const subtaskId = textOf(args.subtaskId) || generateSubtaskId()
        const dependsOn = Array.isArray(args.dependsOn)
          ? args.dependsOn.map((dep) => String(dep).trim()).filter(Boolean)
          : []

        let ordinal: number | undefined
        if (args.ordinal !== undefined && args.ordinal !== null) {
          ordinal = Number(args.ordinal)
          if (!Number.isInteger(ordinal) || ordinal < 0) {
            return toolError('longtask_add_subtask', `ordinal must be a non-negative integer, got ${JSON.stringify(args.ordinal)}.`)
          }
        } else {
          // Auto-assign max+1 from the existing rows; an unreadable task
          // surfaces here instead of as a doomed add-subtask write.
          const read = await readSubtasks('longtask_add_subtask', taskId, exec)
          if (read.error) return read.error
          ordinal = read.subtasks!.reduce((max, row) => Math.max(max, Number(row.ordinal ?? 0)), 0) + 1
        }

        const result = await run(
          argv(exec, [
            'longtask', 'add-subtask', '--id', taskId, '--subtask', subtaskId,
            '--title', title, '--ordinal', String(ordinal),
            ...(dependsOn.length ? ['--depends-on', dependsOn.join(',')] : []),
          ]),
          { timeoutMs: LONGTASK_TIMEOUT_MS },
        )
        return envelope('longtask_add_subtask', result, renderJson)
      },
    },
    {
      name: 'longtask_set_status',
      description:
        'Set one subtask\'s status: pending | in_progress | waiting_owner | waiting_external | accepted | '
        + 'rejected | skipped. HONEST LIMIT: acceptance is NOT gated on this surface — there is no owner-only '
        + 'rule, no acceptance-delegate switch and no evidence requirement, so YOU hold the discipline: only '
        + 'set accepted on the owner\'s explicit verdict in the conversation, and record what they accepted '
        + 'against. Moves outside the reference lifecycle (e.g. flipping an accepted subtask back) are applied '
        + 'with a WARNING, not refused — be sure they are intended. Read a task\'s subtasks with longtask_show; '
        + 'the board overview is longtask_board.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Owning task id (`lt-…` slug).' },
          subtaskId: { type: 'string', description: 'Subtask id (`st-…` slug).' },
          status: { type: 'string', enum: [...LONGTASK_SUBTASK_STATUSES], description: 'Target status.' },
        },
        required: ['taskId', 'subtaskId', 'status'],
      },
      output: { schema: { type: 'string' }, render },
      timeoutMs: LONGTASK_TIMEOUT_MS,
      execute: async (args: Record<string, unknown>, exec: HostToolExec) => {
        const taskId = textOf(args.taskId)
        const subtaskId = textOf(args.subtaskId)
        const status = textOf(args.status)
        if (!taskId) return toolError('longtask_set_status', 'taskId is required.')
        if (!subtaskId) return toolError('longtask_set_status', 'subtaskId is required.')
        if (!LONGTASK_SUBTASK_STATUSES.includes(status as LongtaskSubtaskStatus)) {
          return toolError('longtask_set_status', `unknown status "${status}". Valid statuses: ${LONGTASK_SUBTASK_STATUSES.join(', ')}.`)
        }

        // Pre-read for the transition WARNING (not a gate). A missing task or
        // subtask would fail the write anyway — surface it with the same
        // envelope the CLI would produce, before touching the store.
        const read = await readSubtasks('longtask_set_status', taskId, exec)
        if (read.error) return read.error
        const current = read.subtasks!.find((row) => textOf(row.id) === subtaskId)
        if (!current) {
          return toolError('longtask_set_status', `[longtask_subtask_not_found] No sub-task ${subtaskId} in ${taskId}.`)
        }

        const result = await run(
          argv(exec, ['longtask', 'set-status', '--id', taskId, '--subtask', subtaskId, '--status', status]),
          { timeoutMs: LONGTASK_TIMEOUT_MS },
        )
        return envelope('longtask_set_status', result, (data) => {
          const notes: string[] = [renderJson(data)]
          const from = textOf(current.status) || 'pending'
          if (!(ALLOWED_STATUS_MOVES[from as LongtaskSubtaskStatus] ?? []).includes(status)) {
            notes.push(
              `WARNING: transition ${from} -> ${status} is outside the reference lifecycle `
              + `(from ${from} expected one of: ${(ALLOWED_STATUS_MOVES[from as LongtaskSubtaskStatus] ?? []).join(', ') || '(terminal)'}). `
              + 'Applied anyway — this surface does not gate transitions; confirm it was intended.',
            )
          }
          if (status === 'accepted') {
            notes.push(
              'NOTE: acceptance is ungated here — make sure this reflects the owner\'s explicit verdict and that '
              + 'what they accepted against is recorded in the conversation.',
            )
          }
          return notes.join('\n')
        })
      },
    },
    {
      name: 'longtask_advance',
      description:
        'Run one advance pass over the long-term task board. What it does TODAY, honestly: the planner checks '
        + 'the staleness of each task and records its push decisions in the task journal, plus updates the nudge '
        + 'throttle state — it does NOT deliver anything anywhere (no session source is wired on this surface, '
        + 'so no reminder or message is sent to anyone). Its value is the auditable journal and the bookkeeping '
        + 'that later passes read.',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render },
      timeoutMs: LONGTASK_TIMEOUT_MS,
      execute: async (_args: Record<string, unknown>, exec: HostToolExec) => {
        const result = await run(argv(exec, ['longtask', 'advance']), { timeoutMs: LONGTASK_TIMEOUT_MS })
        return envelope('longtask_advance', result, renderJson)
      },
    },
  ]
}

function isDuplicateToolError(error: unknown): boolean {
  return error instanceof Error && /already.*(registered|exists)|duplicate/i.test(error.message)
}

/**
 * Register the longtask tools on the host global layer during plugin apply
 * (same posture as the metaweb tools: visible from the first turn).
 */
export function bindLongtaskToolInstall(ctx: HostContext): void {
  for (const definition of buildLongtaskToolDefinitions({ host: ctx, hostAgent: { ctx } })) {
    try {
      ctx.tools?.register(definition)
    } catch (error) {
      if (!isDuplicateToolError(error)) {
        ctx.logger?.warn?.(`[oac-dsh] longtask tool install failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
