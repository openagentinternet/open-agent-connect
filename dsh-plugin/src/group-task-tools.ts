/**
 * Group Task chat tools for the DSH host: one twin-only `group_task` tool
 * whose `action` union mirrors the IDBots metabot-group-task skill verbs
 * (propose/create/list/show/send/invite/kick/close/supervise-shaped surface,
 * backed by the OAC staffing + task stores instead of IDBots RPC). Execution
 * goes through dispatchGroupTaskRoutes — the same runner the panel routes use —
 * so flag building, timeouts, and the local-read fast path stay in one place.
 *
 * The `oac:group-task` prompt section is the DSH port of the IDBots
 * metabot-group-task SKILL.md: wish → coarse seats → candidate search → slate
 * proposal → owner confirm gate → staffed create → OpenTeam invites, then the
 * engine-driven phases. Mount on the twin only (group tasks are always
 * chaired by the Twin, exactly like IDBots), re-authorized at execution.
 *
 * The staffing `propose` action records the current DSH session id as the
 * proposal's sourceSessionId — the later source-session relay ("where the
 * wish was spoken is where the news returns") consumes it.
 */
import { dispatchGroupTaskRoutes, type GroupTaskRouteDeps } from './grouptask.js'
import { runMetabot, type MetabotCommandResult } from './cli-bridge.js'
import type { RunFn } from './cli-payload.js'
import type { HostAgentLike, HostToolDefinition } from './context-types.js'

/** Group-task SOP for the Twin, ported from the IDBots metabot-group-task SKILL.md. */
export const GROUP_TASK_SOP_TEXT = `## Group Tasks (multi-bot on-chain group tasks)
You are the chair of record for on-chain group tasks. The host exposes the twin-only \`group_task\` tool — one tool, one \`action\` per call.

### When to open a group task
Open one when the owner's wish needs several specialists working together toward one acceptance-checked outcome (for example: "build and publish a MetaApp", "run a launch campaign"). A group task is an on-chain group chat chaired by you; every message, member, and deliverable is visible to the owner in the Group Tasks panel (A2A Chat → Group Tasks).
Do NOT open one for single-step jobs (do them yourself or use local_worker_delegate), casual conversation, quick questions, or scheduled automation. When the wish is unclear, ask one short clarifying question first.

### The flow (wish → slate → confirm → create → invite)
1. Enrich the wish into a \`title\`, a concrete \`goal\`, and measurable \`acceptanceCriteria\`. Never copy the wish verbatim; research is a basic capability of every seat, not a seat of its own. Write acceptance criteria that demand SERVE-THE-DISH deliverables: the owner verifies by CLICKING a link in the UI, never by downloading files — app work must end with a published \`metaapp://\` link (publishing is part of the task, never deferred to the owner), text becomes \`pin://\` notes, \`metafile://\` is only for binaries.
2. Decompose into coarse seats — one Bot per seat. Seat roles: \`content\`, \`design\` (images and video), \`engineering\` (code, MetaApp, on-chain publish), \`promotion\`, \`domain\` (requires \`domainLabel\`, e.g. legal). Typical team ≤5 including you as chair; hard cap 8.
3. For each seat call \`{action:"search_candidates", seat}\` once (match-first; local Workers are a tie-break, not a gate), then \`{action:"propose", title, goal, plan, acceptanceCriteria}\`. The plan is {stages:[{id,title,seatRole,dependsOn[]}], seats:[{role, candidateName, candidateSlug?, candidateGlobalMetaId?, source:"local"|"remote", reason, domainLabel?, backupName?}]}.
4. The propose result carries \`slateText\` — show it to the owner in the owner's language (pass \`language\`), then WAIT. The owner confirms in chat → \`{action:"decide", proposalId, decision:"confirm"}\`; asks for changes → "revise", then propose again; wants staffing skipped → "skip".
5. After a confirm decision call \`{action:"create_from_proposal", proposalId}\`. Auto-start waiver: when the triggering wish itself said to just start (直接开始 / 直接开 / "just start" / "no need to confirm"), you may create immediately — pass the original wish text as \`wish\` on propose so the gate records it.
6. create_from_proposal returns the task (taskId, groupId) and \`pendingRemoteSeats\`. Invite each remote seat one at a time: \`{action:"invite", taskId, globalMetaId, name?, skills?}\` (invites expire in 10 minutes; the daemon must be alive when it arrives). Then report the group's title, roster, and stage plan to the owner and let the engine run.

### After creation
The daemon engine drives the task: it posts the kickoff, runs the planning turn, wakes @-mentioned workers, verifies deliverables, and moves planning → executing → review. Do not speak as the chair inside the group while it runs (the engine speaks with the chair's voice); if you must post, post as the owner (\`asOwner\`) or as a member Bot (\`asSlug\`).
- Follow progress: \`{action:"detail", taskId}\` / \`{action:"messages", taskId}\`.
- When the task reaches review, walk the owner through the acceptance summary in this chat, then close it: \`{action:"close", taskId, outcome:"done", rating:1-5, comment?}\` — or back to work: \`{action:"reopen", taskId, reason}\`. Cancel with outcome:"cancelled".
- Roster control: \`{action:"member_status", taskId, status, member|globalMetaId}\`, \`{action:"kick", taskId, member|globalMetaId, reason?}\`, \`{action:"invite", ...}\` to add a remote Bot by GlobalMetaId.
- Statuses: planning, executing, review, done, cancelled. Deliverables arrive as [DELIVERABLE] messages and are verified on-chain; app work must show up as a clickable \`metaapp://\` link — if a worker hands the owner a raw file instead, send it back before review.
- Owner supervision via \`{action:"supervise", taskId, superviseAction}\`: "nudge" wakes a quiet member (optionally target one with member/globalMetaId), "pause" suspends dispatch and "resume" continues (the chair re-engages the roster), "flag" records an observation into the acceptance record. Use \`{action:"deliverable_delete", taskId, deliverableId}\` to drop a mis-reported ledger row.
Never fabricate progress or completion; report what detail/messages actually show, refer to tasks by title (not raw ids) in conversation, and point the owner to the Group Tasks panel for the live view.`

/** Tool-level cap: chain writes (create/invite/post) may wait on indexer polls. */
const TOOL_TIMEOUT_MS = 240_000

const ACTIONS = [
  'list',
  'detail',
  'messages',
  'create',
  'propose',
  'decide',
  'create_from_proposal',
  'search_candidates',
  'post',
  'close',
  'reopen',
  'kick',
  'member_status',
  'invite',
  'invites',
  'supervise',
  'deliverable_delete',
  'health',
] as const

export type GroupTaskAction = (typeof ACTIONS)[number]

export interface GroupTaskCallContext {
  /** Session the tool ran in; recorded on staffing proposals for the relay. */
  sessionId?: string | null
}

export interface GroupTaskController {
  twinSlug: string
  run(action: string, args: Record<string, unknown>, call?: GroupTaskCallContext): Promise<string>
}

function readString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function readBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  return typeof args[key] === 'boolean' ? (args[key] as boolean) : undefined
}

function readNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key]
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value))
  }
  return undefined
}

function readStringList(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key]
  if (!Array.isArray(value)) return undefined
  const list = value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean)
  return list.length > 0 ? list : undefined
}

function fail(code: string, message: string): never {
  throw new Error(`${code}: ${message}`)
}

function dataOf(result: MetabotCommandResult): Record<string, unknown> {
  if (!result.ok) {
    throw new Error(result.message ?? result.code ?? 'group_task action failed')
  }
  return (result.data ?? {}) as Record<string, unknown>
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function formatList(data: Record<string, unknown>): string {
  const tasks = (data.tasks ?? []) as Array<Record<string, unknown>>
  if (tasks.length === 0) return 'No group tasks.'
  return tasks
    .map((task) => {
      const parts = [
        `[${String(task.status)}] ${String(task.title)}`,
        `task ${String(task.id)}`,
        `chair ${String(task.chairSlug)}`,
        `${String(task.memberCount ?? '?')} members`,
      ]
      if (task.openTeam === true) parts.push('OpenTeam')
      if (task.archivedAt) parts.push('archived')
      return '- ' + parts.join(' · ')
    })
    .join('\n')
}

function formatCreated(data: Record<string, unknown>): string {
  const task = (data.task ?? {}) as Record<string, unknown>
  const lines = [
    `Group task "${String(task.title)}" created: task ${String(task.id)}, group ${String(task.groupId)}, status ${String(task.status)}.`,
    `${String(data.chairSlug)} chairs it. The engine posts the kickoff and runs planning within seconds; follow with {action:"detail", taskId:${String(task.id)}}.`,
  ]
  const remoteSeats = (data.pendingRemoteSeats ?? []) as Array<Record<string, unknown>>
  if (remoteSeats.length > 0) {
    lines.push(`Pending remote seats (${remoteSeats.length}) — invite each one next, invites expire in 10 minutes:`)
    for (const seat of remoteSeats) {
      lines.push(`  - ${String(seat.role)}: ${String(seat.candidateName)}${seat.candidateGlobalMetaId ? ` (globalMetaId ${String(seat.candidateGlobalMetaId)})` : ''}`)
    }
    lines.push(`Invite with {action:"invite", taskId:${String(task.id)}, globalMetaId:"..."} (chair defaults to ${String(data.chairSlug)}).`)
  }
  return lines.join('\n')
}

function formatPropose(data: Record<string, unknown>): string {
  const proposal = (data.proposal ?? {}) as Record<string, unknown>
  return [
    String(data.slateText ?? ''),
    '',
    `proposalId: ${String(proposal.id)}`,
    `ownerConfirmRequired: ${String(data.ownerConfirmRequired)}`,
  ].join('\n')
}

/**
 * Build the twin-side group-task controller: authorization (the caller's Bot
 * must be the current twin, same rule as the delegation toolset) plus one
 * action → `/oac/api/grouptask/*` payload mapping, executed through
 * dispatchGroupTaskRoutes.
 */
export function createGroupTaskController(
  twinSlug: string,
  options: { run?: RunFn } = {},
): GroupTaskController {
  const run = options.run ?? runMetabot

  const ensureTwinAuthorized = async (): Promise<void> => {
    const show = await run(['bot', 'show', '--from', twinSlug], { timeoutMs: 30_000 })
    const profile = show.ok
      ? (show.data as { profile?: { botType?: string } } | undefined)?.profile
      : undefined
    if (!show.ok || profile?.botType !== 'twin') {
      fail('TWIN_TOOL_FORBIDDEN', 'group_task is only available to the current Twin Bot.')
    }
  }

  const dispatch = async (method: string, payload: Record<string, unknown>): Promise<MetabotCommandResult> => {
    const result = await dispatchGroupTaskRoutes(method, payload, { run } satisfies GroupTaskRouteDeps)
    if (!result) fail('unknown_action', `no grouptask route for ${method}`)
    return result
  }

  return {
    twinSlug,
    async run(action, args, call = {}) {
      await ensureTwinAuthorized()
      const chair = readString(args, 'chair') ?? twinSlug
      const chairSlugPayload = { chairSlug: chair }
      const taskId = readNumber(args, 'taskId')

      switch (action as GroupTaskAction) {
        case 'list': {
          return formatList(dataOf(await dispatch('grouptask/list', {
            tab: readString(args, 'tab') ?? 'active',
            ...(readBoolean(args, 'includeArchived') === true ? { includeArchived: true } : {}),
          })))
        }
        case 'detail': {
          if (!taskId) fail('missing_task_id', 'taskId is required.')
          return json(dataOf(await dispatch('grouptask/detail', {
            chair,
            taskId,
            ...(readString(args, 'view') ? { view: readString(args, 'view') } : {}),
          })))
        }
        case 'messages': {
          if (!taskId) fail('missing_task_id', 'taskId is required.')
          const limit = readNumber(args, 'limit')
          const beforeIndex = readNumber(args, 'beforeIndex')
          return json(dataOf(await dispatch('grouptask/messages', {
            chair,
            taskId,
            ...(limit !== undefined ? { limit } : {}),
            ...(beforeIndex !== undefined ? { beforeIndex } : {}),
          })))
        }
        case 'create': {
          const title = readString(args, 'title')
          const goal = readString(args, 'goal')
          if (!title || !goal) fail('missing_fields', 'title and goal are required.')
          const acceptanceCriteria = readString(args, 'acceptanceCriteria')
          const workerSlugs = readStringList(args, 'workerSlugs')
          return formatCreated(dataOf(await dispatch('grouptask/create', {
            title,
            goal,
            ...(acceptanceCriteria ? { acceptanceCriteria } : {}),
            ...(workerSlugs ? { workerSlugs } : {}),
            ...chairSlugPayload,
          })))
        }
        case 'propose': {
          const title = readString(args, 'title')
          const goal = readString(args, 'goal')
          const plan = args.plan
          if (!title || !goal) fail('missing_fields', 'title and goal are required.')
          if (!plan || (typeof plan === 'object' && Object.keys(plan).length === 0)) {
            fail('missing_plan', 'plan ({stages, seats}) is required — run search_candidates per seat first.')
          }
          const acceptanceCriteria = readString(args, 'acceptanceCriteria')
          const wish = readString(args, 'wish')
          const language = readString(args, 'language')
          return formatPropose(dataOf(await dispatch('grouptask/staffing/propose', {
            title,
            goal,
            plan,
            ...(acceptanceCriteria ? { acceptanceCriteria } : {}),
            ...(wish ? { triggeringWish: wish } : {}),
            // Where the wish was spoken is where the news returns (relay).
            ...(call.sessionId ? { sourceSessionId: call.sessionId } : {}),
            ...chairSlugPayload,
            ...(language ? { language } : {}),
          })))
        }
        case 'decide': {
          const proposalId = readNumber(args, 'proposalId')
          const decision = readString(args, 'decision')
          if (!proposalId) fail('missing_proposal', 'proposalId is required.')
          if (decision !== 'confirm' && decision !== 'revise' && decision !== 'skip') {
            fail('invalid_decision', "decision must be 'confirm', 'revise', or 'skip'.")
          }
          return json(dataOf(await dispatch('grouptask/staffing/decide', {
            ...chairSlugPayload,
            proposalId,
            decision,
          })))
        }
        case 'create_from_proposal': {
          const proposalId = readNumber(args, 'proposalId')
          if (!proposalId) fail('missing_proposal', 'proposalId is required.')
          return formatCreated(dataOf(await dispatch('grouptask/staffing/create', {
            proposalId,
            ...chairSlugPayload,
          })))
        }
        case 'search_candidates': {
          const seat = readString(args, 'seat')
          const query = readString(args, 'query')
          if (!seat && !query) fail('missing_query', 'seat or query is required.')
          const domainLabel = readString(args, 'domainLabel')
          const skills = readStringList(args, 'skills')
          const limit = readNumber(args, 'limit')
          return json(dataOf(await dispatch('grouptask/staffing/search', {
            ...(seat ? { seat } : {}),
            ...(query ? { query } : {}),
            ...(domainLabel ? { domainLabel } : {}),
            ...(skills ? { skills } : {}),
            ...(limit !== undefined ? { limit } : {}),
          })))
        }
        case 'post': {
          if (!taskId) fail('missing_task_id', 'taskId is required.')
          const content = readString(args, 'content')
          if (!content) fail('missing_content', 'content is required.')
          const asSlug = readString(args, 'asSlug')
          const asOwner = readBoolean(args, 'asOwner') === true
          if (asSlug && asOwner) fail('conflicting_sender', 'asSlug and asOwner are mutually exclusive.')
          const replyPin = readString(args, 'replyPin')
          const mention = readStringList(args, 'mention')
          return json(dataOf(await dispatch('grouptask/post', {
            chair,
            taskId,
            content,
            ...(asSlug ? { asSlug } : {}),
            ...(asOwner ? { asOwner: true } : {}),
            ...(replyPin ? { replyPin } : {}),
            ...(mention ? { mention } : {}),
          })))
        }
        case 'close': {
          if (!taskId) fail('missing_task_id', 'taskId is required.')
          const outcome = readString(args, 'outcome')
          if (outcome !== 'done' && outcome !== 'cancelled') {
            fail('invalid_outcome', "outcome must be 'done' or 'cancelled'.")
          }
          const rating = readNumber(args, 'rating')
          const comment = readString(args, 'comment')
          const reason = readString(args, 'reason')
          return json(dataOf(await dispatch('grouptask/close', {
            chair,
            taskId,
            outcome,
            ...(rating !== undefined ? { rating } : {}),
            ...(comment ? { ratingComment: comment } : {}),
            ...(reason ? { reason } : {}),
          })))
        }
        case 'reopen': {
          if (!taskId) fail('missing_task_id', 'taskId is required.')
          const reason = readString(args, 'reason')
          return json(dataOf(await dispatch('grouptask/reopen', {
            chair,
            taskId,
            ...(reason ? { reason } : {}),
          })))
        }
        case 'kick': {
          if (!taskId) fail('missing_task_id', 'taskId is required.')
          const member = readString(args, 'member')
          const globalMetaId = readString(args, 'globalMetaId')
          if (!member && !globalMetaId) fail('missing_member', 'member (slug) or globalMetaId is required.')
          const reason = readString(args, 'reason')
          return json(dataOf(await dispatch('grouptask/kick', {
            chair,
            taskId,
            ...(member ? { slug: member } : {}),
            ...(!member && globalMetaId ? { globalMetaId } : {}),
            ...(reason ? { reason } : {}),
          })))
        }
        case 'member_status': {
          if (!taskId) fail('missing_task_id', 'taskId is required.')
          const status = readString(args, 'status')
          if (!status) fail('missing_status', 'status is required.')
          const member = readString(args, 'member')
          const globalMetaId = readString(args, 'globalMetaId')
          if (!member && !globalMetaId) fail('missing_member', 'member (slug) or globalMetaId is required.')
          return json(dataOf(await dispatch('grouptask/member-status', {
            chair,
            taskId,
            status,
            ...(member ? { slug: member } : {}),
            ...(!member && globalMetaId ? { globalMetaId } : {}),
          })))
        }
        case 'invite': {
          if (!taskId) fail('missing_task_id', 'taskId is required.')
          const globalMetaId = readString(args, 'globalMetaId')
          if (!globalMetaId) fail('missing_global_metaid', 'globalMetaId is required.')
          const name = readString(args, 'name')
          const skills = readStringList(args, 'skills')
          return json(dataOf(await dispatch('grouptask/invite', {
            chair,
            taskId,
            globalMetaId,
            ...(name ? { name } : {}),
            ...(skills ? { requiredSkills: skills } : {}),
            ...(readBoolean(args, 'allowReinvite') === true ? { allowReinvite: true } : {}),
          })))
        }
        case 'invites': {
          if (!taskId) fail('missing_task_id', 'taskId is required.')
          return json(dataOf(await dispatch('grouptask/invites', { chair, taskId })))
        }
        case 'supervise': {
          if (!taskId) fail('missing_task_id', 'taskId is required.')
          const superviseAction = readString(args, 'superviseAction')
          if (!superviseAction || !['nudge', 'flag', 'pause', 'resume'].includes(superviseAction)) {
            fail('invalid_action', "superviseAction must be 'nudge', 'flag', 'pause', or 'resume'.")
          }
          const member = readString(args, 'member')
          const globalMetaId = readString(args, 'globalMetaId')
          if (member && globalMetaId) fail('conflicting_member', 'member and globalMetaId are mutually exclusive.')
          const note = readString(args, 'note')
          return json(dataOf(await dispatch('grouptask/supervise', {
            chair,
            taskId,
            superviseAction,
            ...(member ? { member } : {}),
            ...(!member && globalMetaId ? { globalMetaId } : {}),
            ...(note ? { note } : {}),
          })))
        }
        case 'deliverable_delete': {
          if (!taskId) fail('missing_task_id', 'taskId is required.')
          const deliverableId = readNumber(args, 'deliverableId')
          if (!deliverableId) fail('missing_deliverable', 'deliverableId is required.')
          return json(dataOf(await dispatch('grouptask/deliverable-delete', {
            chair,
            taskId,
            deliverableId,
          })))
        }
        case 'health': {
          return json(dataOf(await dispatch('grouptask/health', {})))
        }
        default:
          fail('unknown_action', `Unknown group_task action "${action}". Available: ${ACTIONS.join(', ')}.`)
      }
    },
  }
}

/** The single twin-only group-task tool definition (action-union shape). */
export function buildGroupTaskToolDefinition(controller: GroupTaskController): HostToolDefinition {
  return {
    name: 'group_task',
    description:
      'On-chain multi-bot group tasks (Group Tasks panel): propose a staffing slate for a wish, create the group, '
      + 'invite remote Bots, follow progress, manage the roster, and close with acceptance. One action per call.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [...ACTIONS],
          description: 'list | detail | messages | create | propose | decide | create_from_proposal | search_candidates | post | close | reopen | kick | member_status | invite | invites | supervise | deliverable_delete | health',
        },
        taskId: { type: 'integer', description: 'Task id (from list/propose results).' },
        chair: { type: 'string', description: 'Chair Bot slug; defaults to you (the Twin).' },
        title: { type: 'string' },
        goal: { type: 'string' },
        acceptanceCriteria: { type: 'string', description: 'Measurable acceptance criteria, newline-separated.' },
        plan: {
          type: 'object',
          description: 'Staffing plan {stages:[{id,title,seatRole,dependsOn[]}], seats:[{role,candidateName,candidateSlug?,candidateGlobalMetaId?,source,reason,domainLabel?,backupName?}]}.',
        },
        wish: { type: 'string', description: 'The original wish text on propose (drives the skip-confirm gate).' },
        language: { type: 'string', enum: ['zh', 'en'], description: 'Slate language on propose.' },
        proposalId: { type: 'integer', description: 'Staffing proposal id (from propose).' },
        decision: { type: 'string', enum: ['confirm', 'revise', 'skip'] },
        tab: { type: 'string', enum: ['active', 'done', 'cancelled', 'all'], description: 'list filter; default active.' },
        view: { type: 'string', enum: ['summary', 'full'] },
        limit: { type: 'integer' },
        beforeIndex: { type: 'integer' },
        content: { type: 'string', description: 'Message text on post.' },
        asSlug: { type: 'string', description: 'Post as this member Bot instead of the owner.' },
        asOwner: { type: 'boolean', description: 'Post as the owner identity.' },
        replyPin: { type: 'string' },
        mention: { type: 'array', items: { type: 'string' }, description: 'GlobalMetaIds or @Names to mention.' },
        workerSlugs: { type: 'array', items: { type: 'string' }, description: 'Direct-create local worker seats (bypasses staffing; prefer propose).' },
        outcome: { type: 'string', enum: ['done', 'cancelled'] },
        rating: { type: 'integer', description: '1-5 acceptance rating on close done.' },
        comment: { type: 'string', description: 'Rating comment on close.' },
        reason: { type: 'string' },
        member: { type: 'string', description: 'Member Bot slug (kick/member_status).' },
        globalMetaId: { type: 'string', description: 'Remote member GlobalMetaId (kick/member_status/invite).' },
        status: { type: 'string', description: 'Member status: assigned|working|standby|done|unreachable.' },
        name: { type: 'string', description: 'Display name for an invited remote Bot.' },
        skills: { type: 'array', items: { type: 'string' } },
        allowReinvite: { type: 'boolean', description: 'Re-send an invite to an already-invited remote Bot.' },
        seat: { type: 'string', enum: ['content', 'design', 'engineering', 'promotion', 'domain'], description: 'Seat role on search_candidates.' },
        query: { type: 'string', description: 'Free-text candidate search on search_candidates.' },
        domainLabel: { type: 'string', description: 'Domain specialty label (search_candidates with seat=domain).' },
        superviseAction: { type: 'string', enum: ['nudge', 'flag', 'pause', 'resume'], description: 'Supervision action on supervise.' },
        note: { type: 'string', description: 'Owner note on supervise (flag context / nudge hint).' },
        deliverableId: { type: 'integer', description: 'Deliverable ledger row id on deliverable_delete.' },
        includeArchived: { type: 'boolean' },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
    },
    timeoutMs: TOOL_TIMEOUT_MS,
    async execute(args, exec) {
      return controller.run(String(args.action ?? ''), args, {
        sessionId: exec?.agent?.session?.id ?? null,
      })
    },
  }
}

/** Install the group-task SOP section + the `group_task` tool on the twin's agent. */
export function installGroupTaskOnAgent(
  agent: HostAgentLike,
  twinSlug: string,
  options: { run?: RunFn } = {},
): void {
  agent.ctx.systemPrompt?.section({
    name: 'oac:group-task',
    order: 100,
    text: GROUP_TASK_SOP_TEXT,
  })
  agent.ctx.tools?.register(
    buildGroupTaskToolDefinition(createGroupTaskController(twinSlug, options)),
  )
}
