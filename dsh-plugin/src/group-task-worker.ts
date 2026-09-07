/**
 * Group Task worker sessions (Phase 3, single-commander): the engine defers
 * local worker turns into work requests; this module claims them over the CLI,
 * runs each one as a REAL DSH sub-session (the Worker Bot's own preset:
 * persona, memories, skills — the local_worker_delegate machinery), and
 * submits the handoff back for the on-chain post.
 *
 * Mid-turn speech (IDBots task #65/#66 parity): each work session carries a
 * session-scoped `group_chat` tool (action `send_group_message`) bound to the
 * claimed task's group — the worker posts [WORKING] progress and [DELIVERABLE]
 * lines the moment results land instead of holding everything for the turn's
 * end. A turn that delivered mid-turn closes with [NO_REPLY] and NOTHING else
 * posts (no duplicate announcement); the service completes such submissions
 * without an on-chain post.
 *
 * Single-commander: the host NEVER speaks under a bot identity — there is no
 * auto-[WORKING] ACK on claim; the worker's own speech (mid-turn or final) is
 * the only voice. The engine treats an outstanding work request as "engaged"
 * (no false no-ACK/timeout flags while a live turn runs).
 *
 * Safety: the engine expires unclaimed/claim-stale requests (8/20 min TTLs)
 * and falls back to its bare-LLM turn, so a missing or wedged host can never
 * stall a task. Chair turns are NOT session-executed (orchestration text).
 */
import { randomUUID } from 'node:crypto'
import { type MetabotCommandResult } from './cli-bridge.js'
import { runMetabotPinned } from './daemon-pinned-run.js'
import { runMetabotWithPayloadFile, type RunFn } from './cli-payload.js'
import { presetIdForSlug } from './chip-logic.js'
import { resolveDaemonBaseUrl } from './browser-bridge.js'
import {
  agentsRegistryOf,
  errorFromTurnEvents,
  textFromAssistantEvents,
  workerModelPair,
} from './twin-tools.js'
import type {
  HostAgentLike,
  HostAgentsRegistryLike,
  HostContext,
  HostToolDefinition,
  HostUserMessage,
} from './context-types.js'

/** Group-task turn system prompt for the worker's sub-session. */
export const GROUP_TASK_WORK_SYSTEM_PROMPT =
  'You are a persistent Worker Bot executing ONE turn inside an on-chain multi-bot group task. '
  + 'Use your own persona, memories, skills, wallet, and permissions. '
  + 'MID-TURN GROUP MESSAGES: you may speak to the group DURING the turn with the group_chat tool '
  + '(action send_group_message) — post [WORKING] progress lines and [DELIVERABLE] lines the moment '
  + 'results land instead of holding everything for the turn\'s end; mid-turn [DELIVERABLE] lines are '
  + 'recorded on the task ledger exactly like turn replies. Never guess or invent a group_id — the '
  + 'current group id is listed in your turn brief (a bare number like "65" is the task number, never '
  + 'a group id). '
  + 'ONE VOICE PER TURN: if you already delivered everything mid-turn, close the turn with exactly '
  + '[NO_REPLY] instead of repeating it as the final reply — duplicate announcements read as double '
  + 'postings to the group. '
  + 'Otherwise your final assistant message is posted to the group as a single message; deliverables '
  + 'ride as [DELIVERABLE] lines with owner-clickable on-chain URIs (publish finished apps for '
  + 'metaapp://, publish text as pin:// notes, metafile:// only for binaries — never hand the owner '
  + 'a file to download). '
  + 'Do not broaden your permission scope or claim unverifiable completion.'

const DEFAULT_POLL_MS = 8_000
const DEFAULT_TURN_TIMEOUT_MS = 900_000
/** work-submit retries: transient daemon hiccups must not silently drop a finished turn. */
const SUBMIT_RETRY_DELAYS_MS = [0, 2_000, 5_000]

interface ActiveWorkerSession {
  agent: HostAgentLike
  sessionId: string
  /** Successful mid-turn group posts via the session's group_chat tool. */
  midTurnSends: number
}

export interface GroupTaskWorkerOptions {
  run?: RunFn
  enabled?: boolean
  pollMs?: number
  turnTimeoutMs?: number
  /** Daemon liveness probe override (tests). */
  daemonAlive?: () => Promise<boolean>
  /** work-submit retry delays in ms (tests pass [0] to disable retries). */
  submitRetryDelaysMs?: number[]
}

export interface GroupTaskWorkerRunner {
  /** One claim + execution pass (exposed for tests and manual flushes). */
  claimOnce(): Promise<boolean>
  stop(): void
}

interface WorkClaim {
  requestId: number
  chairSlug: string
  taskId: number
  groupId: string | null
  workerSlug: string
  workerName: string
  targetPinId: string | null
  task: { title: string; goal: string; acceptanceCriteria: string | null; status: string }
  roster: Array<{ name: string; role: string; remote: boolean }>
  recentMessages: Array<{ index: number; sender: string; content: string }>
  targetMessage: { index: number; sender: string; content: string } | null
}

function buildWorkMessage(claim: WorkClaim): string {
  const roster = claim.roster
    .map((seat) => `- ${seat.name} (${seat.role}${seat.remote ? ', remote teammate via OpenTeam' : ''})`)
    .join('\n')
  const log = claim.recentMessages
    .map((message) => `#${message.index} ${message.sender}: ${message.content.replace(/\s*\n\s*/gu, ' ').trim()}`)
    .join('\n')
  const lines = [
    '<group_task_work>',
    `  <task_id>${claim.taskId}</task_id>`,
    claim.groupId ? `  <group_id>${claim.groupId}</group_id>` : null,
    `  <task_title>${claim.task.title}</task_title>`,
    `  <goal>${claim.task.goal}</goal>`,
    claim.task.acceptanceCriteria ? `  <acceptance_criteria>${claim.task.acceptanceCriteria}</acceptance_criteria>` : null,
    '  <roster>',
    roster,
    '  </roster>',
    '  <recent_group_log>',
    log,
    '  </recent_group_log>',
    claim.targetMessage
      ? `  <message_you_are_responding_to>#${claim.targetMessage.index} ${claim.targetMessage.sender}: ${claim.targetMessage.content}</message_you_are_responding_to>`
      : null,
    '  <handoff_contract>',
    'MID-TURN SPEECH: post [WORKING] progress and [DELIVERABLE] lines the moment results land via the group_chat tool (action send_group_message) — the group id is the one above, never the task number.',
    'Your final assistant message IS the group message posted on-chain as you — write it for the room, in the owner\'s language, concise. If you already said everything mid-turn, reply exactly [NO_REPLY] and nothing else posts.',
    'Append [DELIVERABLE] lines (one per line) for anything you produced, with owner-clickable on-chain URIs.',
    'If you genuinely have nothing to add this turn, reply exactly [NO_REPLY].',
    '  </handoff_contract>',
    '</group_task_work>',
  ]
  return lines.filter((line): line is string => line !== null).join('\n')
}

export function applyGroupTaskWorkerSessions(
  ctx: HostContext,
  options: GroupTaskWorkerOptions = {},
): GroupTaskWorkerRunner {
  const run: RunFn = options.run
    ?? ((args, runOptions) => runMetabotPinned(
      args,
      runOptions,
      undefined,
      (reason) => ctx.logger?.warn?.(`[oac-dsh] ${reason}`),
    ))
  const enabled = options.enabled !== false
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const turnTimeoutMs = options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS
  const daemonAlive = options.daemonAlive ?? daemonAliveByHttp
  const submitRetryDelaysMs = options.submitRetryDelaysMs ?? SUBMIT_RETRY_DELAYS_MS

  /** Live sub-sessions keyed by `${taskId}:${workerSlug}` (reused across turns). */
  const activeSessions = new Map<string, ActiveWorkerSession>()
  let claiming = false
  let stopped = false

  async function submit(payload: Record<string, unknown>): Promise<MetabotCommandResult> {
    return runMetabotWithPayloadFile(
      ['grouptask', 'work', 'submit'],
      payload,
      '--payload-file',
      [],
      run,
    )
  }

  /**
   * Checked submit (task-67 lesson): a failed work-submit used to be swallowed,
   * leaving a FINISHED turn stuck in "claimed" until the engine's 20-min TTL.
   * Retry short bursts and warn loudly; the engine TTL stays the final backstop.
   */
  async function submitChecked(payload: Record<string, unknown>): Promise<MetabotCommandResult> {
    let last: MetabotCommandResult | null = null
    for (let attempt = 0; attempt < submitRetryDelaysMs.length; attempt++) {
      const delay = submitRetryDelaysMs[attempt]!
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
      last = await submit(payload)
      if (last.ok) return last
      ctx.logger?.warn?.(
        `[oac-dsh] group-task work submit failed (request ${String(payload.requestId)}, attempt ${attempt + 1}/${submitRetryDelaysMs.length}): ${last.message ?? last.code ?? 'unknown error'}`,
      )
    }
    return last!
  }

  /**
   * The session-scoped mid-turn speech tool (IDBots group_chat
   * send_group_message parity): bound to the claimed task's group, so a
   * worker can never guess a wrong group id — a mismatched group_id is
   * overridden with a note, a malformed one is rejected with the teaching
   * error. Successful sends count on the session so an empty final reply
   * after mid-turn delivery settles as DELIVERED, not WORKER_EMPTY_HANDOFF.
   */
  function buildMidTurnGroupChatTool(
    claim: WorkClaim,
    sessionRef: () => ActiveWorkerSession | null,
  ): HostToolDefinition {
    return {
      name: 'group_chat',
      description:
        'Speak in the group task DURING your turn: post [WORKING] progress lines and [DELIVERABLE] '
        + 'lines the moment results land. Sends route to THIS turn\'s task group automatically.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['send_group_message'], description: 'Only send_group_message is supported here.' },
          content: { type: 'string', description: 'The message text posted to the group as you.' },
          group_id: { type: 'string', description: 'The on-chain group id (64 hex chars + "i0") from your turn brief. Optional; sends always route to this task\'s group.' },
        },
        required: ['action', 'content'],
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
      },
      timeoutMs: 200_000,
      async execute(args: Record<string, unknown>): Promise<string> {
        const action = typeof args.action === 'string' ? args.action.trim() : ''
        if (action !== 'send_group_message') {
          throw new Error(`invalid_action: only send_group_message is supported in a group-task work turn (got "${action}")`)
        }
        const content = typeof args.content === 'string' ? args.content.trim() : ''
        if (!content) throw new Error('missing_content: content is required.')
        if (!claim.groupId) {
          throw new Error('group_unavailable: this work turn has no on-chain group id; deliver through your final reply instead.')
        }
        let note = ''
        const passed = typeof args.group_id === 'string' ? args.group_id.trim() : ''
        if (passed) {
          if (!/^[0-9a-f]{64}i\d+$/i.test(passed)) {
            throw new Error(`Invalid group_id "${passed}": an on-chain group id is the group's pin id — exactly 64 lowercase hex chars followed by "i0" (66 characters). A bare number such as "65" is the TASK number, not a group id. Do not guess; the group id is in your turn brief.`)
          }
          if (passed.toLowerCase() !== claim.groupId!.toLowerCase()) {
            note = `\n- note: routed to this turn's task group — you passed "${passed}", which is not that group id; the group id is the 64-hex+"i0" pin id shown in your turn brief, never the task number.`
          }
        }
        const result: MetabotCommandResult = await run([
          'grouptask', 'post',
          '--chair', claim.chairSlug,
          '--task', String(claim.taskId),
          '--as', claim.workerSlug,
          '--content', content,
        ], { timeoutMs: 180_000 })
        if (!result.ok) {
          throw new Error(`send_failed: ${result.message ?? result.code ?? 'unknown error'}`)
        }
        const session = sessionRef()
        if (session) session.midTurnSends += 1
        const pinId = (result.data as { pinId?: string } | undefined)?.pinId ?? null
        return `Sent to the group as ${claim.workerName}${pinId ? ` (pin ${pinId})` : ''}.${note}`
      },
    }
  }

  async function runWorkTurn(claim: WorkClaim): Promise<void> {
    const registry: HostAgentsRegistryLike | undefined = agentsRegistryOf(ctx)
    const preset = presetIdForSlug(claim.workerSlug)
    const sessionKey = `${claim.taskId}:${claim.workerSlug}`
    const fail = async (error: string): Promise<void> => {
      await submitChecked({ requestId: claim.requestId, error, dshSessionId: null })
    }
    if (!registry?.create || !ctx.agentPresets?.mount) {
      await fail('worker_session_unavailable: the DSH agent registry or preset service is unavailable')
      return
    }

    // Model route: the Worker Bot's own DSH LLM pair, then the host default.
    const shown = await run(['bot', 'show', '--from', claim.workerSlug], { timeoutMs: 30_000 })
    const profile = shown.ok
      ? (shown.data as { profile?: Record<string, unknown> } | undefined)?.profile
      : undefined
    const modelPair = workerModelPair(ctx, profile)
    if (!modelPair) {
      await fail('worker_session_unavailable: no LLM model for the worker session (configure the Bot DSH LLM pair or a host default)')
      return
    }

    // Reuse the (task, worker) session when it is still live; else create one.
    let session = activeSessions.get(sessionKey) ?? null
    if (session) {
      const live = !registry.get || session.agent.id === undefined
        ? true
        : (() => { try { return registry.get(session!.agent.id!) === session!.agent } catch { return false } })()
      if (!live) session = null
    }
    if (!session) {
      const sessionId = randomUUID()
      try {
        const handle = await registry.create({
          sessionId,
          meta: { agentPreset: preset, cwd: process.cwd() },
          agentOptions: {
            provider: modelPair.provider,
            model: modelPair.model,
            ...(modelPair.reasoningEffort ? { reasoningEffort: modelPair.reasoningEffort } : {}),
          },
          setup: async (agentCtx: unknown) => {
            await ctx.agentPresets?.mount?.(agentCtx, preset)
          },
        })
        const agent = handle.agent
        agent.ctx.systemPrompt?.section({
          name: 'oac:group-task-work',
          order: 100,
          text: GROUP_TASK_WORK_SYSTEM_PROMPT,
        })
        session = { agent, sessionId, midTurnSends: 0 }
        activeSessions.set(sessionKey, session)
        agent.ctx.tools?.register(
          buildMidTurnGroupChatTool(claim, () => activeSessions.get(sessionKey) ?? null),
        )
      } catch (error) {
        await fail(`worker_session_spawn_failed: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
    }

    // Single-commander: NO host-posted [WORKING] ACK — the worker speaks for
    // itself (mid-turn via group_chat, or in its final reply). The engine
    // treats this outstanding request as "engaged" in its monitors.
    session.midTurnSends = 0

    const agent = session.agent
    agent.followup?.({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: buildWorkMessage(claim) }],
      source: { kind: 'plugin', plugin: 'oac-dsh', form: 'group-task-work' },
    })

    let handoff = ''
    let sessionEvents: ReadonlyArray<{ type: string; data?: unknown }> = []
    let failureText: string | null = null
    let timedOut = false
    try {
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<'timed_out'>((resolve) => {
        timeoutTimer = setTimeout(() => resolve('timed_out'), turnTimeoutMs)
      })
      const idle = Promise.resolve(agent.whenIdle?.()).then(() => 'idle' as const)
      const outcome = await Promise.race([idle, timeout])
      clearTimeout(timeoutTimer)
      if (outcome === 'timed_out') {
        timedOut = true
        try {
          agent.cancel?.({ kind: 'timeout' })
        } catch {
          // session may already be gone
        }
      } else {
        sessionEvents = agent.session?.snapshotEvents?.() ?? []
        handoff = textFromAssistantEvents(sessionEvents)
      }
    } catch (error) {
      failureText = error instanceof Error ? error.message : String(error)
    }

    if (timedOut) {
      await submitChecked({
        requestId: claim.requestId,
        error: `WORKER_TURN_TIMED_OUT after ${Math.round(turnTimeoutMs / 1000)}s (dshSessionId ${session.sessionId})`,
        dshSessionId: session.sessionId,
      })
      return
    }
    if (failureText) {
      await submitChecked({ requestId: claim.requestId, error: failureText, dshSessionId: session.sessionId })
      return
    }
    if (!handoff) {
      if (session.midTurnSends > 0) {
        // IDBots task #66-A parity: an empty final reply after mid-turn group
        // sends is a DELIVERED turn — complete without re-posting.
        await submitChecked({
          requestId: claim.requestId,
          handoff: '[NO_REPLY]',
          dshSessionId: session.sessionId,
        })
        return
      }
      const turnError = errorFromTurnEvents(sessionEvents)
      await submitChecked({
        requestId: claim.requestId,
        error: `WORKER_EMPTY_HANDOFF: no handoff text${turnError ? ` — ${turnError}` : ''} (dshSessionId ${session.sessionId}; the session stays live)`,
        dshSessionId: session.sessionId,
      })
      return
    }
    // A [NO_REPLY] final reply completes WITHOUT an on-chain post (service-side).
    await submitChecked({
      requestId: claim.requestId,
      handoff,
      dshSessionId: session.sessionId,
    })
  }

  /**
   * Cheap raw-HTTP daemon probe — NO CLI spawn, so a down daemon can never be
   * auto-started by this poller (the Phase 3 daemon-storm incident: the 8s
   * claim poll racing dsh-web restarts auto-started three daemons and wedged
   * every panel CLI call). The engine's TTL fallback covers the outage.
   */
  async function daemonAliveByHttp(): Promise<boolean> {
    try {
      const base = await resolveDaemonBaseUrl()
      if (!base) return false
      const response = await fetch(`${base}/api/grouptask/health`, { signal: AbortSignal.timeout(2_500) })
      return response.ok
    } catch {
      return false
    }
  }

  async function claimOnce(): Promise<boolean> {
    if (!(await daemonAlive())) return false
    const result: MetabotCommandResult = await run(['grouptask', 'work', 'claim'], { timeoutMs: 60_000 })
    if (!result.ok) return false
    const claim = (result.data as { request?: WorkClaim | null } | undefined)?.request ?? null
    if (!claim) return false
    await runWorkTurn(claim)
    return true
  }

  const timer = setInterval(() => {
    void runner.claimOnce().catch(() => undefined)
  }, pollMs)
  timer.unref?.()

  const runner: GroupTaskWorkerRunner = {
    async claimOnce(): Promise<boolean> {
      if (claiming || stopped) return false
      claiming = true
      try {
        const worked = await claimOnce()
        // Drain queued turns promptly: another claim right after a completion.
        if (worked && !stopped) {
          const requeue = setTimeout(() => { void runner.claimOnce().catch(() => undefined) }, 1_000)
          requeue.unref?.()
        }
        return worked
      } finally {
        claiming = false
      }
    },
    stop(): void {
      stopped = true
      clearInterval(timer)
    },
  }
  return runner
}
