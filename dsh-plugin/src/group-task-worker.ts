/**
 * Group Task worker sessions (Phase 3): the engine defers local worker turns
 * into work requests; this module claims them over the CLI, runs each one as
 * a REAL DSH sub-session (the Worker Bot's own preset: persona, memories,
 * skills — the local_worker_delegate machinery), and submits the handoff back
 * for the on-chain post. The reply is ONE group message; deliverables ride as
 * [DELIVERABLE] lines with owner-clickable URIs (serve-the-dish). Sessions are
 * reused per (task, worker) and kept alive after the turn (stop ≠ delete).
 *
 * Safety: the engine expires unclaimed/claim-stale requests (8/20 min TTLs)
 * and falls back to its bare-LLM turn, so a missing or wedged host can never
 * stall a task. Chair turns are NOT session-executed (orchestration text).
 */
import { randomUUID } from 'node:crypto'
import { runMetabot, type MetabotCommandResult } from './cli-bridge.js'
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
  HostUserMessage,
} from './context-types.js'

/** Group-task turn system prompt for the worker's sub-session. */
export const GROUP_TASK_WORK_SYSTEM_PROMPT =
  'You are a persistent Worker Bot executing ONE turn inside an on-chain multi-bot group task. '
  + 'Use your own persona, memories, skills, wallet, and permissions. '
  + 'Your reply is posted to the group as a single message; deliverables ride as [DELIVERABLE] lines '
  + 'with owner-clickable on-chain URIs (publish finished apps for metaapp://, publish text as pin:// '
  + 'notes, metafile:// only for binaries — never hand the owner a file to download). '
  + 'Do not broaden your permission scope or claim unverifiable completion.'

const DEFAULT_POLL_MS = 8_000
const DEFAULT_TURN_TIMEOUT_MS = 900_000

interface ActiveWorkerSession {
  agent: HostAgentLike
  sessionId: string
}

export interface GroupTaskWorkerOptions {
  run?: RunFn
  enabled?: boolean
  pollMs?: number
  turnTimeoutMs?: number
  /** Daemon liveness probe override (tests). */
  daemonAlive?: () => Promise<boolean>
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
    'Your final assistant message IS the group message posted on-chain as you — write it for the room, in the owner\'s language, concise.',
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
  const run = options.run ?? runMetabot
  const enabled = options.enabled !== false
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const turnTimeoutMs = options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS
  const daemonAlive = options.daemonAlive ?? daemonAliveByHttp

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

  async function postAck(claim: WorkClaim): Promise<void> {
    try {
      await run(['grouptask', 'post',
        '--chair', claim.chairSlug,
        '--task', String(claim.taskId),
        '--as', claim.workerSlug,
        '--content', '[WORKING] Claimed the assignment and started working.'], { timeoutMs: 180_000 })
    } catch {
      // Best-effort ACK: the engine's reminder ladder covers a missing one.
    }
  }

  async function runWorkTurn(claim: WorkClaim): Promise<void> {
    const registry: HostAgentsRegistryLike | undefined = agentsRegistryOf(ctx)
    const preset = presetIdForSlug(claim.workerSlug)
    const sessionKey = `${claim.taskId}:${claim.workerSlug}`
    const fail = async (error: string): Promise<void> => {
      await submit({ requestId: claim.requestId, error, dshSessionId: null })
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
        session = { agent, sessionId }
        activeSessions.set(sessionKey, session)
      } catch (error) {
        await fail(`worker_session_spawn_failed: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
    }

    // Immediate on-chain ACK so the engine's reminder ladder stands down.
    await postAck(claim)

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
      await submit({
        requestId: claim.requestId,
        error: `WORKER_TURN_TIMED_OUT after ${Math.round(turnTimeoutMs / 1000)}s (dshSessionId ${session.sessionId})`,
        dshSessionId: session.sessionId,
      })
      return
    }
    if (failureText) {
      await submit({ requestId: claim.requestId, error: failureText, dshSessionId: session.sessionId })
      return
    }
    if (!handoff) {
      const turnError = errorFromTurnEvents(sessionEvents)
      await submit({
        requestId: claim.requestId,
        error: `WORKER_EMPTY_HANDOFF: no handoff text${turnError ? ` — ${turnError}` : ''} (dshSessionId ${session.sessionId}; the session stays live)`,
        dshSessionId: session.sessionId,
      })
      return
    }
    await submit({
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
