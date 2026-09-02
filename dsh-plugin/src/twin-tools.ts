/**
 * Twin/Worker orchestration for the DSH host: twin-only tools (registered
 * only when the session's Bot is the current twin, re-validated at execution),
 * local delegation execution through DSH sub-sessions (`agents.create` +
 * `agentPresets.mount`). The toolset mirrors the IDBots seven: local_workers_list,
 * local_worker_delegate, twin_task_status, twin_task_reassign,
 * twin_task_cancel, worker_session_stop, and oac_session_insert_user_message
 * (the IDBots `idbots_session_insert_user_message`, renamed for this host and
 * targeting live sessions by Worker slug or delegated dshSessionId instead of
 * a cowork session id). Prompts are ported from IDBots (twin overlay:
 * coworkRunner.ts:4489-4508; delegation wrapper + worker system prompt:
 * twinOrchestrationService.ts:115-136,283); the overlay carries one
 * OAC-specific line for the cross-session tool.
 *
 * Session lifecycle mirrors IDBots (orchestratorCoworkBridge.ts:166-170):
 * a delegated Worker session is created per attempt, runs to completion, and
 * is KEPT ALIVE afterwards — the DSH conversation list shows it, the owner
 * can open it, and the Twin can follow up through
 * oac_session_insert_user_message. Disposing would delete the session from
 * the host store and drop its sidebar row mid-flow.
 *
 * Notification policy: the blocking tool result IS the delivery channel —
 * every settle marks its attempt `notified` in the task ledger, and nothing
 * injects ORCH-NOTIFY wake-ups into sessions. This host has no single "the
 * twin session" (the owner can hold many Bob conversations), so any
 * created-agent flush lands stale notifications in unrelated conversations.
 * clearPendingNotifications only silences backlog rows older plugin versions
 * left behind. The ledger (twin_task_status) remains the state of record.
 */
import { randomUUID } from 'node:crypto'
import { runMetabot, type MetabotCommandResult } from './cli-bridge.js'
import { runMetabotWithPayloadFile, type RunFn } from './cli-payload.js'
import { presetIdForSlug, slugFromPresetId } from './chip-logic.js'
import type { HostAgentLike, HostAgentsRegistryLike, HostContext, HostToolDefinition, HostUserMessage } from './context-types.js'

/** Twin orchestration overlay, ported verbatim from IDBots coworkRunner.ts. */
export const TWIN_OVERLAY_TEXT = `## Twin Bot Orchestration Role
You are the owner's one persistent Twin Bot: a private digital twin and chief-of-staff assistant.
Interpret the owner's ambiguous intent using known context, then turn material work into a concrete goal, ordered steps, measurable acceptance criteria, and a concise progress plan. When the request is unclear, ask short clarifying questions before delegating.
For specialist or multi-step work, prefer suitable local persistent Worker Bots. First call local_workers_list and choose by the returned persona, skills, capability evidence, availability, and permission fit; selection must be evidence-based rather than hard-coded by task category.
The host provides Twin-only orchestration tools — local_workers_list, local_worker_delegate, twin_task_status, twin_task_reassign, twin_task_cancel, and worker_session_stop — use them to delegate, monitor, and correct local Workers.
When a Worker session is genuinely stuck (no progress, repeated errors, or off-track output), stop it with worker_session_stop, then cancel or reassign its task instead of waiting indefinitely.
Drive a live local session directly with oac_session_insert_user_message (target a Worker by slug, or a delegated session by the dshSessionId shown in twin_task_status) when a full task wrapper is unnecessary; stop such a live session with worker_session_stop's target parameter.
Delegate with local_worker_delegate only after defining one bounded step, required evidence, and an explicit permission scope. A Worker is a persistent specialist with its own memories, skills, and wallet; a subagent is only an ephemeral tool inside a Worker run.
Remain available to the owner while delegated work runs. Never fabricate progress or completion. Treat a Worker handoff as evidence to review, not proof; verify against the acceptance criteria before reporting to the owner.
Do not disclose private owner memory or unrelated conversation history in a delegated prompt. Do not broaden authority for payments, transfers, destructive actions, public publishing, or private messaging without the owner's explicit bounded approval.
Do not personally perform specialist execution when a suitable local Worker can carry it out. Delegate, supervise, verify, and report.
Local Workers are preferred, never mandatory. When no suitable local Worker exists for a bounded step, execute the work yourself and note why no Worker fit.
Speak in plain user language, not internal jargon.
Own the task lifecycle end to end: refer to tasks by title (never #id), keep the owner informed in UI status words, and close out tasks when done.`

/** Worker system prompt for delegated sessions, ported verbatim. */
export const WORKER_DELEGATION_SYSTEM_PROMPT =
  'You are a persistent Worker Bot executing one delegated step for the owner Twin Bot. '
  + 'Use your own persona, memories, skills, wallet, and permissions. '
  + 'Do not broaden the permission scope or claim unverifiable completion.'

const DEFAULT_STEP_TIMEOUT_MS = 300_000

/** IDBots CROSS_SESSION_INSERT_MAX_CHARS, kept for the cross-session insert tool. */
const CROSS_SESSION_INSERT_MAX_CHARS = 12_000

export interface DelegationInput {
  workerSlug: string
  objective: string
  acceptanceCriteria?: string[]
  context?: string
  permissionScope?: Record<string, unknown>
  taskId?: string
  stepId?: string
  taskIntent?: string
  idempotencyKey?: string
}

/** Delegation user message wrapper, ported from IDBots buildWorkerPrompt. */
export function buildDelegationMessage(input: DelegationInput & { taskId: string; stepId: string }): string {
  const lines = [
    '<twin_delegation>',
    `  <task_id>${input.taskId}</task_id>`,
    `  <step_id>${input.stepId}</step_id>`,
    `  <objective>${input.objective}</objective>`,
  ]
  if (input.acceptanceCriteria && input.acceptanceCriteria.length > 0) {
    lines.push(`  <acceptance_criteria>${JSON.stringify(input.acceptanceCriteria)}</acceptance_criteria>`)
  }
  if (input.context?.trim()) {
    lines.push(`  <verified_context>${input.context.trim()}</verified_context>`)
  }
  lines.push(`  <permission_scope>${JSON.stringify(input.permissionScope ?? { workspace: 'read_write', network: 'read_only' })}</permission_scope>`)
  lines.push(
    '  <handoff_contract>',
    'Return a concise structured handoff with summary, deliverables, verification evidence, and blockers. Do not claim an external action succeeded without evidence.',
    'ALWAYS close the session with a plain-text handoff summary so the Twin Bot can review your work.',
    '  </handoff_contract>',
    '</twin_delegation>',
  )
  return lines.join('\n')
}

function failure(code: string, message: string): MetabotCommandResult {
  return { ok: false, state: 'failed', code, message }
}

/**
 * Read the DSH agent registry as an OPTIONAL service. Cordis throws
 * "cannot get property without inject" on a direct `ctx.agents` read when the
 * plugin never declared `agents` in its inject list, so the safe read is
 * `ctx.get('agents')` (DSH convention for optional services; it reads the
 * global service store and never throws). The direct property read survives
 * only as a fallback for plain-object test contexts.
 */
function agentsRegistryOf(ctx: HostContext): HostAgentsRegistryLike | undefined {
  const viaGet = ctx.get?.('agents') as HostAgentsRegistryLike | undefined
  if (viaGet) return viaGet
  try {
    return ctx.agents
  } catch {
    return undefined
  }
}

function dataOf(result: MetabotCommandResult): Record<string, unknown> {
  if (!result.ok) {
    throw new Error(result.message ?? result.code ?? 'metabot command failed')
  }
  return (result.data ?? {}) as Record<string, unknown>
}

function textFromAssistantEvents(events: ReadonlyArray<{ type: string; data?: unknown }>): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'assistant/message') continue
    const content = (event.data as { message?: { content?: unknown } } | undefined)?.message?.content
    if (!Array.isArray(content)) continue
    const text = content
      .map((block) => {
        const candidate = block as { type?: unknown; text?: unknown }
        return candidate?.type === 'text' && typeof candidate.text === 'string' ? candidate.text : ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()
    if (text) return text
  }
  return ''
}

/** The last turn's error reason, when the worker turn died before answering (e.g. no model). */
function errorFromTurnEvents(events: ReadonlyArray<{ type: string; data?: unknown }>): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'turn/end') continue
    const reason = (event.data as { reason?: { kind?: string; error?: { message?: string } } } | undefined)?.reason
    if (reason?.kind === 'error' && typeof reason.error?.message === 'string') return reason.error.message
  }
  return ''
}

interface DshModelPair {
  provider: string
  model: string
  /** Adapter-owned reasoning effort (off/low/high/max); absent keeps the provider default. */
  reasoningEffort?: string
}

/** The host default model (same source UI-created conversations use), via the optional-service seam. */
function hostDefaultModelPair(ctx: HostContext): DshModelPair | null {
  const service = ctx.get?.('agentDefaultModel') as { currentSelection?: () => { provider?: unknown; model?: unknown } } | undefined
  try {
    const selection = service?.currentSelection?.()
    const provider = typeof selection?.provider === 'string' ? selection.provider.trim() : ''
    const model = typeof selection?.model === 'string' ? selection.model.trim() : ''
    return provider && model ? { provider, model } : null
  } catch {
    return null
  }
}

/**
 * Model route for one delegated worker session: the Worker Bot's own DSH LLM
 * pair (plus its reasoning effort) first, the host default model otherwise
 * (mirroring how UI-created conversations get theirs). Without either the
 * agent loop cannot run a turn.
 */
function workerModelPair(ctx: HostContext, profile: Record<string, unknown> | undefined): DshModelPair | null {
  const provider = typeof profile?.dshLlmProvider === 'string' ? (profile.dshLlmProvider as string).trim() : ''
  const model = typeof profile?.dshLlmModel === 'string' ? (profile.dshLlmModel as string).trim() : ''
  if (provider && model) {
    const reasoningEffort = typeof profile?.dshLlmReasoningEffort === 'string'
      ? (profile.dshLlmReasoningEffort as string).trim()
      : ''
    return { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) }
  }
  return hostDefaultModelPair(ctx)
}

/** Live oac-* agents, shared with the index.ts agent/created listener. */
export const liveOacAgents = new Map<string, HostAgentLike>()

interface InFlightAttempt {
  controller: AbortController
  workerSlug: string
  /** DSH session id of the delegated sub-session (also stored on the attempt). */
  sessionId: string
  /** Set once `agents.create` resolves; used by the cross-session tools. */
  agent: HostAgentLike | null
  /**
   * Reassign and stopAttempt set this before cancelling the run: the delegate
   * settle then records the attempt with this terminal status/error and skips
   * the step/task updates, so the caller owns all later bookkeeping.
   */
  settleOverride: { attemptStatus: string; error: string } | null
  /** Resolves after the delegate's bookkeeping has fully settled. */
  settled: Promise<void>
}

export interface ReassignInput {
  stepId: string
  workerSlug: string
  /** Optional hint; the owning task is resolved from the step id otherwise. */
  taskId?: string
  objective?: string
  acceptanceCriteria?: string[]
  context?: string
  permissionScope?: Record<string, unknown>
}

export interface TwinOrchestrator {
  delegate(input: DelegationInput): Promise<MetabotCommandResult>
  reassign(input: ReassignInput): Promise<MetabotCommandResult>
  stopAttempt(taskId: string, stepId: string): Promise<MetabotCommandResult>
  /** Stop a live local session that is NOT a delegated step (by Worker slug or session id). */
  stopLiveSession(target: string): Promise<MetabotCommandResult>
  /** Insert one user message into a live local session (by Worker slug or session id). */
  insertSessionMessage(target: string, message: string): Promise<MetabotCommandResult>
  /** Mark any backlog pending-notify rows notified WITHOUT injecting them. */
  clearPendingNotifications(twinSlug: string): Promise<void>
}

export function createTwinOrchestrator(
  ctx: HostContext,
  twinSlug: string,
  options: { run?: RunFn; stepTimeoutMs?: number } = {},
): TwinOrchestrator {
  const run = options.run ?? runMetabot
  const stepTimeoutMs = options.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS
  const inFlight = new Map<string, InFlightAttempt>()

  const tasksUpdate = (payload: Record<string, unknown>) =>
    runMetabotWithPayloadFile(['twin', 'tasks', 'update', '--from', twinSlug], payload, '--payload-file', [], run)

  /** Host-side authorization shared by every twin tool: caller's Bot must be the current twin. */
  const ensureTwinAuthorized = async (toolName: string): Promise<MetabotCommandResult | null> => {
    const twinShow = await run(['bot', 'show', '--from', twinSlug], { timeoutMs: 30_000 })
    const twinProfile = twinShow.ok
      ? (twinShow.data as { profile?: { botType?: string } } | undefined)?.profile
      : undefined
    if (!twinShow.ok || twinProfile?.botType !== 'twin') {
      return failure('TWIN_TOOL_FORBIDDEN', `${toolName} is only available to the current Twin Bot.`)
    }
    return null
  }

  interface LiveTarget {
    agent: HostAgentLike
    /** Worker slug when one could be resolved for this session. */
    slug: string | null
    sessionId: string | null
    /** Set when the target is an in-flight delegated step (`taskId:stepId`). */
    inFlightKey: string | null
  }

  const composedSlugOf = (agent: HostAgentLike): string | null => {
    try {
      const preset = ctx.agentPresets?.composedPreset?.(agent.ctx)
      return preset ? slugFromPresetId(preset) ?? null : null
    } catch {
      return null
    }
  }

  /**
   * Resolve a live local session by Worker slug or session id: in-flight
   * delegated sub-sessions first, then interactive oac-* agents, then the DSH
   * agent registry. Persisted-but-not-running sessions cannot be woken from
   * the plugin surface, so resolution is live-only.
   */
  const resolveLiveTarget = (rawTarget: string): LiveTarget | null => {
    const target = rawTarget.trim()
    if (!target) return null
    const registry = agentsRegistryOf(ctx)
    // Map-held agents may outlive their DSH registration (liveOacAgents is
    // pruned on agent/disposed, but a stale entry must never be messaged —
    // followup on a detached agent runs an invisible zombie turn). Where the
    // registry seam exists it is the liveness authority.
    const isLive = (agent: HostAgentLike): boolean => {
      if (!registry?.get || agent.id === undefined) return true
      try {
        return registry.get(agent.id) === agent
      } catch {
        return false
      }
    }
    for (const [key, flight] of inFlight) {
      if ((flight.workerSlug === target || flight.sessionId === target) && flight.agent && isLive(flight.agent)) {
        return { agent: flight.agent, slug: flight.workerSlug, sessionId: flight.sessionId, inFlightKey: key }
      }
    }
    const interactive = liveOacAgents.get(target)
    if (interactive && isLive(interactive)) {
      return { agent: interactive, slug: target, sessionId: interactive.session?.id ?? null, inFlightKey: null }
    }
    const direct = registry?.get?.(target)
    if (direct) {
      return { agent: direct, slug: composedSlugOf(direct), sessionId: direct.session?.id ?? null, inFlightKey: null }
    }
    for (const agent of registry?.list?.() ?? []) {
      const slug = composedSlugOf(agent)
      if (agent.id === target || agent.session?.id === target || slug === target) {
        return { agent, slug, sessionId: agent.session?.id ?? agent.id ?? null, inFlightKey: null }
      }
    }
    return null
  }

  const orchestrator: TwinOrchestrator = {
    async delegate(input) {
      // Host-side authorization: the caller's Bot must be the current twin,
      // and the target must be a different local Bot.
      const authFailure = await ensureTwinAuthorized('local_worker_delegate')
      if (authFailure) return authFailure
      const workerSlug = input.workerSlug.trim()
      if (!workerSlug || workerSlug === twinSlug) {
        return failure('invalid_worker', 'workerSlug must name a different local Bot.')
      }
      const workerShow = await run(['bot', 'show', '--from', workerSlug], { timeoutMs: 30_000 })
      if (!workerShow.ok) {
        return failure('worker_not_found', `Worker Bot not found: ${workerSlug}`)
      }
      const workerProfile = (workerShow.data as { profile?: Record<string, unknown> } | undefined)?.profile
      const agentsRegistry = agentsRegistryOf(ctx)
      if (!agentsRegistry?.create || !ctx.agentPresets?.mount) {
        return failure('delegation_unavailable', 'The DSH agent registry or preset service is unavailable.')
      }
      // The agent loop enters every step with an empty route unless AgentOptions
      // carries provider+model — a delegated session has no UI model selection,
      // so resolve the pair here (worker Bot pair, then the host default).
      const modelPair = workerModelPair(ctx, workerProfile)
      if (!modelPair) {
        return failure('delegation_unavailable', 'No LLM model for the worker session: configure the Worker Bot DSH LLM pair (Settings → Bots) or a host default model.')
      }

      // Resolve or create the task + step.
      let taskId = input.taskId?.trim() ?? ''
      let stepId = input.stepId?.trim() ?? ''
      let taskTitle = input.taskIntent?.trim() ?? ''
      if (!taskId || !stepId) {
        const created = await runMetabotWithPayloadFile(
          ['twin', 'tasks', 'create', '--from', twinSlug],
          {
            title: taskTitle || input.objective.slice(0, 60),
            goal: input.objective,
            ...(taskTitle ? { intent: taskTitle } : {}),
            steps: [{
              workerSlug,
              objective: input.objective,
              ...(input.acceptanceCriteria ? { acceptanceCriteria: input.acceptanceCriteria } : {}),
              ...(input.permissionScope ? { permissionScope: input.permissionScope } : {}),
              ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
            }],
          },
          '--payload-file',
          [],
          run,
        )
        const task = dataOf(created).task as { id: string; title: string; steps: Array<{ id: string }> }
        taskId = task.id
        taskTitle = task.title
        stepId = task.steps[0]?.id ?? ''
      }
      if (!taskId || !stepId) {
        return failure('orchestration_invalid', 'Could not resolve the delegation task/step.')
      }

      const workerSessionId = randomUUID()
      const attemptResult = await tasksUpdate({ taskId, stepId, newAttempt: true, dshSessionId: workerSessionId })
      const attempt = dataOf(attemptResult).attempt as { id: string }
      await tasksUpdate({ taskId, stepId, stepStatus: 'running' })
      await tasksUpdate({ taskId, taskStatus: 'running' })

      const controller = new AbortController()
      const flightKey = `${taskId}:${stepId}`
      let markSettled: () => void = () => undefined
      const settled = new Promise<void>((resolve) => { markSettled = resolve })
      const flight: InFlightAttempt = {
        controller,
        workerSlug,
        sessionId: workerSessionId,
        agent: null,
        settleOverride: null,
        settled,
      }
      inFlight.set(flightKey, flight)

      let handoff = ''
      let sessionEvents: ReadonlyArray<{ type: string; data?: unknown }> = []
      let failureText: string | null = null
      let timedOut = false
      try {
        const handle = await agentsRegistry.create({
          sessionId: workerSessionId,
          // cwd keeps the session in the host workspace bucket: the DSH
          // conversation list drops cold sessions without one.
          meta: { agentPreset: presetIdForSlug(workerSlug), cwd: process.cwd() },
          agentOptions: {
            provider: modelPair.provider,
            model: modelPair.model,
            ...(modelPair.reasoningEffort ? { reasoningEffort: modelPair.reasoningEffort } : {}),
          },
          setup: async (agentCtx: unknown) => {
            await ctx.agentPresets?.mount?.(agentCtx, presetIdForSlug(workerSlug))
          },
          signal: controller.signal,
        })
        const worker = handle.agent
        flight.agent = worker
        worker.ctx.systemPrompt?.section({
          name: 'oac:worker-delegation',
          order: 100,
          text: WORKER_DELEGATION_SYSTEM_PROMPT,
        })
        worker.followup?.({
          role: 'user',
          content: [{ type: 'text', text: buildDelegationMessage({ ...input, taskId, stepId }) }],
          source: { kind: 'plugin', plugin: 'oac-dsh', form: 'delegation' },
        })
        let timeoutTimer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<'timed_out'>((resolve) => {
          timeoutTimer = setTimeout(() => resolve('timed_out'), stepTimeoutMs)
          controller.signal.addEventListener('abort', () => {
            clearTimeout(timeoutTimer)
            resolve('timed_out')
          }, { once: true })
        })
        const idle = Promise.resolve(worker.whenIdle?.()).then(() => 'idle' as const)
        const outcome = await Promise.race([idle, timeout])
        // The losing arm's timer must not outlive the race: an idle win leaves
        // an armed step-timeout that keeps the process alive for its full span.
        clearTimeout(timeoutTimer)
        if (outcome === 'timed_out') {
          timedOut = true
          try {
            worker.cancel?.({ kind: 'timeout' })
          } catch {
            // worker may already be gone
          }
        } else {
          // The live DSH Session exposes its log through snapshotEvents();
          // there is no `events` property on it.
          sessionEvents = worker.session?.snapshotEvents?.() ?? worker.session?.events ?? []
          handoff = textFromAssistantEvents(sessionEvents)
        }
        // Keep the Worker session alive after the attempt (IDBots parity):
        // disposing deletes the session from the host store, which drops its
        // sidebar row and strands any follow-up. The ledger owns the outcome.
      } catch (error) {
        failureText = error instanceof Error ? error.message : String(error)
      }

      const settleOverride = flight.settleOverride
      // An idle win without any handoff text is a FAILED step (the worker turn
      // errored out or closed silently), never a completion — the IDBots
      // WORKER_EMPTY_HANDOFF rule.
      const attemptStatus = settleOverride?.attemptStatus
        ?? (timedOut ? 'timed_out' : failureText ? 'failed' : handoff ? 'completed' : 'failed')
      const errorText = settleOverride?.error
        ?? failureText
        ?? (timedOut
          ? `worker step timed out after ${Math.round(stepTimeoutMs / 1000)}s`
          : handoff
            ? null
            : errorFromTurnEvents(sessionEvents)
              || `WORKER_EMPTY_HANDOFF: the worker session produced no handoff text (dshSessionId ${workerSessionId}; the session stays live — inspect it or drive it with oac_session_insert_user_message)`)
      try {
        await tasksUpdate({
          taskId,
          stepId,
          attemptId: attempt.id,
          attemptStatus,
          ...(handoff ? { handoff } : {}),
          ...(errorText ? { error: errorText } : {}),
        })
        // The blocking tool result IS the delivery channel, so settle the
        // attempt as already notified. Un-notified terminal attempts become
        // pending-notify rows, and this host has no single "twin session" to
        // flush them into — any created-agent flush lands them in unrelated
        // conversations (the bug this replaces). The CLI treats markNotified
        // as its own branch, so it cannot fold into the status update above.
        await tasksUpdate({ taskId, stepId, attemptId: attempt.id, markNotified: true })
        if (!settleOverride) {
          await tasksUpdate({ taskId, stepId, stepStatus: attemptStatus === 'completed' ? 'completed' : 'failed' })
          await tasksUpdate({ taskId, taskStatus: attemptStatus === 'completed' ? 'review' : 'running' })
        }
      } finally {
        // The flight stays resolvable until bookkeeping is done so a concurrent
        // reassign/stop never observes a half-settled step.
        inFlight.delete(flightKey)
        markSettled()
      }

      if (settleOverride) {
        return failure('attempt_superseded', settleOverride.error)
      }
      if (attemptStatus !== 'completed') {
        return failure(
          timedOut ? 'worker_timed_out' : 'worker_failed',
          errorText ?? `worker step ${attemptStatus}`,
        )
      }
      return {
        ok: true,
        state: 'success',
        data: { taskId, stepId, attemptId: attempt.id, handoff },
      }
    },

    async stopAttempt(taskId, stepId) {
      const flight = inFlight.get(`${taskId}:${stepId}`)
      if (!flight) {
        return failure('not_found', 'No running delegated step with that taskId/stepId.')
      }
      // The creation signal is detached once agents.create resolves, so
      // aborting it alone cannot stop a running turn — cancel the agent. The
      // settleOverride makes the delegate's settle record the attempt as this
      // cancellation; the Worker session itself stays live (stop ≠ delete).
      flight.settleOverride = { attemptStatus: 'cancelled', error: 'STOPPED_BY_TWIN' }
      try {
        flight.agent?.cancel?.({ kind: 'orchestrator_stop', reason: 'Twin requested stop via worker_session_stop' })
      } catch {
        // worker may already be gone
      }
      flight.controller.abort()
      await flight.settled
      inFlight.delete(`${taskId}:${stepId}`)
      await tasksUpdate({ taskId, stepId, stepStatus: 'cancelled' })
      return { ok: true, state: 'success', data: { stopped: true } }
    },

    async reassign(input) {
      const authFailure = await ensureTwinAuthorized('twin_task_reassign')
      if (authFailure) return authFailure
      const workerSlug = input.workerSlug.trim()
      if (!workerSlug || workerSlug === twinSlug) {
        return failure('invalid_worker', 'workerSlug must name a different local Bot.')
      }
      const workerShow = await run(['bot', 'show', '--from', workerSlug], { timeoutMs: 30_000 })
      if (!workerShow.ok) {
        return failure('worker_not_found', `Worker Bot not found: ${workerSlug}`)
      }
      const stepId = input.stepId.trim()
      if (!stepId) {
        return failure('invalid_step', 'stepId is required.')
      }

      // Locate the owning task + step. With an explicit taskId go straight to
      // show; otherwise scan the recent task list (tasks carry their steps).
      const pick = (
        candidate: Record<string, unknown> | null | undefined,
      ): { task: Record<string, unknown>; step: Record<string, unknown> } | null => {
        const hit = ((candidate?.steps ?? []) as Array<Record<string, unknown>>)
          .find((entry) => entry.id === stepId)
        return candidate && hit ? { task: candidate, step: hit } : null
      }
      let found: { task: Record<string, unknown>; step: Record<string, unknown> } | null = null
      if (input.taskId?.trim()) {
        const shown = await run(['twin', 'tasks', 'show', '--from', twinSlug, '--task-id', input.taskId.trim()], { timeoutMs: 30_000 })
        if (!shown.ok) return failure('not_found', shown.message ?? `Orchestration task not found: ${input.taskId.trim()}`)
        found = pick(dataOf(shown).task as Record<string, unknown> | null)
      } else {
        const listed = await run(['twin', 'tasks', 'list', '--from', twinSlug, '--limit', '200'], { timeoutMs: 30_000 })
        if (!listed.ok) return failure('list_failed', listed.message ?? 'Could not list orchestration tasks.')
        const tasks = (listed.data as { tasks?: Array<Record<string, unknown>> } | undefined)?.tasks ?? []
        for (const candidate of tasks) {
          found = pick(candidate)
          if (found) break
        }
      }
      if (!found) {
        return failure('step_not_found', `No orchestration step found: ${stepId}`)
      }
      const { task, step } = found
      const taskId = String(task.id)
      if (task.status === 'cancelled' || step.status === 'cancelled') {
        return failure('illegal_state', 'A cancelled task or step cannot be reassigned.')
      }

      // Settle the active attempt (IDBots REASSIGNED_TO_ANOTHER_WORKER): when
      // it is running in this host, abort it and let the delegate settle apply
      // the cancelled record (its step/task/notify writes are suppressed); a
      // stale record from another host run is record-cancelled directly.
      const attempts = (Array.isArray(step.attempts) ? step.attempts : []) as Array<{ id: string; status: string }>
      let active: { id: string; status: string } | null = null
      for (let index = attempts.length - 1; index >= 0; index -= 1) {
        const candidate = attempts[index]
        if (candidate && ['queued', 'running', 'timed_out'].includes(candidate.status)) {
          active = candidate
          break
        }
      }
      const flightKey = `${taskId}:${stepId}`
      const flight = inFlight.get(flightKey)
      if (flight) {
        flight.settleOverride = { attemptStatus: 'cancelled', error: 'REASSIGNED_TO_ANOTHER_WORKER' }
        // The creation signal alone cannot stop an already-created run; cancel
        // the agent's turn. The Worker session stays live (stop ≠ delete).
        try {
          flight.agent?.cancel?.({ kind: 'orchestrator_stop', reason: 'reassigned to another worker' })
        } catch {
          // worker may already be gone
        }
        flight.controller.abort()
        let settleCapTimer: ReturnType<typeof setTimeout> | undefined
        await Promise.race([
          flight.settled,
          new Promise((resolve) => { settleCapTimer = setTimeout(resolve, 30_000) }),
        ])
        // The losing arm's timer must not outlive the race (same rule as the delegate timeout).
        clearTimeout(settleCapTimer)
        inFlight.delete(flightKey)
      } else if (active) {
        await tasksUpdate({
          taskId,
          stepId,
          attemptId: active.id,
          attemptStatus: 'cancelled',
          error: 'REASSIGNED_TO_ANOTHER_WORKER',
        })
      }
      await tasksUpdate({ taskId, stepId, stepStatus: 'ready', workerSlug })

      // Immediately launch the fresh attempt on the new Worker, inheriting the
      // step record for anything the caller did not override.
      return orchestrator.delegate({
        workerSlug,
        objective: input.objective?.trim() || String(step.objective ?? ''),
        ...(input.acceptanceCriteria
          ? { acceptanceCriteria: input.acceptanceCriteria }
          : Array.isArray(step.acceptanceCriteria) && step.acceptanceCriteria.length > 0
            ? { acceptanceCriteria: (step.acceptanceCriteria as unknown[]).filter((item): item is string => typeof item === 'string') }
            : {}),
        ...(input.context ? { context: input.context } : {}),
        ...(input.permissionScope
          ? { permissionScope: input.permissionScope }
          : step.permissionScope && typeof step.permissionScope === 'object' && !Array.isArray(step.permissionScope)
            ? { permissionScope: step.permissionScope as Record<string, unknown> }
            : {}),
        taskId,
        stepId,
      })
    },

    async stopLiveSession(target) {
      const authFailure = await ensureTwinAuthorized('worker_session_stop')
      if (authFailure) return authFailure
      if (target.trim() === twinSlug) {
        return failure('same_session', 'target must not be the Twin Bot itself.')
      }
      const resolved = resolveLiveTarget(target)
      if (!resolved) {
        return failure('session_not_live', `No live local session found for "${target.trim()}". Only running sessions can be stopped.`)
      }
      if (resolved.inFlightKey) {
        const [taskId, stepId] = resolved.inFlightKey.split(':')
        return failure(
          'use_task_step',
          `That session is running a delegated step; stop it with worker_session_stop using taskId "${taskId}" and stepId "${stepId}" so the task bookkeeping settles too.`,
        )
      }
      try {
        resolved.agent.cancel?.({ kind: 'orchestrator_stop', reason: 'Twin requested stop via worker_session_stop' })
      } catch (error) {
        return failure('stop_failed', error instanceof Error ? error.message : String(error))
      }
      return { ok: true, state: 'success', data: { target: target.trim(), stopped: true } }
    },

    async insertSessionMessage(target, message) {
      const authFailure = await ensureTwinAuthorized('oac_session_insert_user_message')
      if (authFailure) return authFailure
      const text = message.trim()
      if (!text) {
        return failure('empty_message', 'message must not be empty.')
      }
      if (text.length > CROSS_SESSION_INSERT_MAX_CHARS) {
        return failure('message_too_long', `message exceeds the ${CROSS_SESSION_INSERT_MAX_CHARS}-character limit.`)
      }
      if (target.trim() === twinSlug) {
        return failure('same_session', 'target must not be the Twin Bot itself.')
      }
      const resolved = resolveLiveTarget(target)
      if (!resolved) {
        return failure(
          'session_not_live',
          `No live local session found for "${target.trim()}". Target a Worker by slug or a delegated session by the dshSessionId shown in twin_task_status; only running sessions can receive messages.`,
        )
      }
      if (!resolved.agent.followup) {
        return failure('delivery_unavailable', 'The target session cannot accept injected messages.')
      }
      try {
        resolved.agent.followup({
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: `[Cross-session message from ${twinSlug}]: ${text}` }],
          source: { kind: 'plugin', plugin: 'oac-dsh', form: 'cross-session' },
        })
      } catch (error) {
        return failure('delivery_failed', error instanceof Error ? error.message : String(error))
      }
      return {
        ok: true,
        state: 'success',
        data: {
          target: target.trim(),
          workerSlug: resolved.slug,
          sessionId: resolved.sessionId,
          delivered: true,
        },
      }
    },

    async clearPendingNotifications(twin) {
      // The blocking delegate tool result is the delivery channel, so settle
      // already marks fresh attempts notified; this only drains backlog rows
      // that older plugin versions left un-notified. They are marked notified
      // WITHOUT being injected anywhere: this host has no single "twin
      // session", so flushing them on agent/created landed stale
      // notifications in unrelated (often old, resumed) conversations.
      const pending = await run(['twin', 'tasks', 'pending-notify', '--from', twin], { timeoutMs: 30_000 })
      if (!pending.ok) return
      const rows = (pending.data as { pending?: Array<Record<string, unknown>> } | undefined)?.pending ?? []
      for (const row of rows) {
        try {
          await tasksUpdate({
            taskId: String(row.taskId),
            stepId: String(row.stepId),
            attemptId: String(row.attemptId),
            markNotified: true,
          })
        } catch {
          // best-effort; retried next time the twin appears
        }
      }
    },
  }
  return orchestrator
}

/** Twin-only tools on the twin's agent (re-authorized at execution time). */
export function buildTwinToolDefinitions(
  orchestrator: TwinOrchestrator,
  twinSlug: string,
  run: RunFn = runMetabot,
): HostToolDefinition[] {
  return [
    {
      name: 'local_workers_list',
      description: 'List the sanitized roster of local Worker Bots: persona, skills, capability evidence, availability. Always call this before choosing a Worker.',
      parameters: { type: 'object', properties: {} },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
      },
      async execute() {
        const result = await run(['twin', 'workers', '--from', twinSlug], { timeoutMs: 30_000 })
        const data = dataOf(result) as { rosterBlock?: string }
        return data.rosterBlock ?? 'No local Worker Bots.'
      },
    },
    {
      name: 'local_worker_delegate',
      description: 'Delegate one bounded step to a local Worker Bot. Runs the Worker session to completion and returns its handoff; the session stays live in the conversation list afterwards, so you can follow up there or with oac_session_insert_user_message.',
      parameters: {
        type: 'object',
        properties: {
          workerSlug: { type: 'string', description: 'slug from local_workers_list.' },
          objective: { type: 'string', description: 'One bounded step for the Worker.' },
          acceptanceCriteria: { type: 'array', items: { type: 'string' } },
          context: { type: 'string', description: 'Verified context the Worker needs (never private owner memory).' },
          permissionScope: { type: 'object' },
          taskIntent: { type: 'string' },
          idempotencyKey: { type: 'string' },
        },
        required: ['workerSlug', 'objective'],
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
      },
      timeoutMs: DEFAULT_STEP_TIMEOUT_MS + 60_000,
      async execute(args) {
        const result = await orchestrator.delegate({
          workerSlug: String(args.workerSlug ?? ''),
          objective: String(args.objective ?? ''),
          ...(Array.isArray(args.acceptanceCriteria)
            ? { acceptanceCriteria: args.acceptanceCriteria.filter((item): item is string => typeof item === 'string') }
            : {}),
          ...(typeof args.context === 'string' ? { context: args.context } : {}),
          ...(args.permissionScope && typeof args.permissionScope === 'object' && !Array.isArray(args.permissionScope)
            ? { permissionScope: args.permissionScope as Record<string, unknown> }
            : {}),
          ...(typeof args.taskIntent === 'string' ? { taskIntent: args.taskIntent } : {}),
          ...(typeof args.idempotencyKey === 'string' ? { idempotencyKey: args.idempotencyKey } : {}),
        })
        if (!result.ok) {
          throw new Error(result.message ?? result.code ?? 'delegation failed')
        }
        const data = result.data as { handoff?: string }
        return data.handoff ?? 'Worker completed without a handoff summary.'
      },
    },
    {
      name: 'twin_task_reassign',
      description: 'Reassign one step to a different local Worker: the active attempt is cancelled (REASSIGNED_TO_ANOTHER_WORKER, stopping its live session when one runs here) and a fresh attempt starts immediately with the new Worker, inheriting the step record for anything not overridden. Runs to completion and returns the new worker handoff.',
      parameters: {
        type: 'object',
        properties: {
          stepId: { type: 'string', description: 'Step id from twin_task_status.' },
          workerSlug: { type: 'string', description: 'New Worker slug from local_workers_list.' },
          taskId: { type: 'string', description: 'Owning task id (optional hint; resolved from stepId otherwise).' },
          objective: { type: 'string', description: 'Override the step objective for the new attempt.' },
          acceptanceCriteria: { type: 'array', items: { type: 'string' } },
          context: { type: 'string', description: 'Verified context the Worker needs (never private owner memory).' },
          permissionScope: { type: 'object' },
        },
        required: ['stepId', 'workerSlug'],
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
      },
      timeoutMs: DEFAULT_STEP_TIMEOUT_MS + 60_000,
      async execute(args) {
        const result = await orchestrator.reassign({
          stepId: String(args.stepId ?? ''),
          workerSlug: String(args.workerSlug ?? ''),
          ...(typeof args.taskId === 'string' ? { taskId: args.taskId } : {}),
          ...(typeof args.objective === 'string' ? { objective: args.objective } : {}),
          ...(Array.isArray(args.acceptanceCriteria)
            ? { acceptanceCriteria: args.acceptanceCriteria.filter((item): item is string => typeof item === 'string') }
            : {}),
          ...(typeof args.context === 'string' ? { context: args.context } : {}),
          ...(args.permissionScope && typeof args.permissionScope === 'object' && !Array.isArray(args.permissionScope)
            ? { permissionScope: args.permissionScope as Record<string, unknown> }
            : {}),
        })
        if (!result.ok) {
          throw new Error(result.message ?? result.code ?? 'reassign failed')
        }
        const data = result.data as { handoff?: string }
        return data.handoff ?? 'Worker completed without a handoff summary.'
      },
    },
    {
      name: 'twin_task_status',
      description: 'List delegation tasks (or show one) with step/attempt states.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          status: { type: 'string' },
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
      },
      async execute(args) {
        if (typeof args.taskId === 'string' && args.taskId.trim()) {
          const result = await run(['twin', 'tasks', 'show', '--from', twinSlug, '--task-id', args.taskId.trim()], { timeoutMs: 30_000 })
          return JSON.stringify(dataOf(result).task ?? null, null, 2)
        }
        const result = await run(['twin', 'tasks', 'list', '--from', twinSlug], { timeoutMs: 30_000 })
        const tasks = (dataOf(result).tasks ?? []) as Array<Record<string, unknown>>
        if (tasks.length === 0) return 'No delegation tasks.'
        return tasks.map((task) =>
          `- [${String(task.status)}] ${String(task.title)} (${String(task.id)})`
        ).join('\n')
      },
    },
    {
      name: 'twin_task_cancel',
      description: 'Cancel a delegation task and stop any live worker step.',
      parameters: {
        type: 'object',
        properties: { taskId: { type: 'string' } },
        required: ['taskId'],
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
      },
      async execute(args) {
        const taskId = String(args.taskId ?? '')
        const shown = await run(['twin', 'tasks', 'show', '--from', twinSlug, '--task-id', taskId], { timeoutMs: 30_000 })
        const task = dataOf(shown).task as { steps?: Array<{ id: string; status: string }> } | null
        for (const step of task?.steps ?? []) {
          if (step.status === 'running' || step.status === 'queued') {
            await orchestrator.stopAttempt(taskId, step.id)
          }
        }
        await runMetabotWithPayloadFile(
          ['twin', 'tasks', 'update', '--from', twinSlug],
          { taskId, taskStatus: 'cancelled' },
          '--payload-file',
          [],
          run,
        )
        return `Task ${taskId} cancelled.`
      },
    },
    {
      name: 'worker_session_stop',
      description: 'Stop a wedged worker session: pass taskId+stepId for a delegated step (task bookkeeping settles too), or target (Worker slug / live session id) for any other live local session.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          stepId: { type: 'string' },
          target: { type: 'string', description: 'Worker slug or live session id (alternative to taskId+stepId).' },
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
      },
      async execute(args) {
        const target = typeof args.target === 'string' ? args.target.trim() : ''
        if (target) {
          const result = await orchestrator.stopLiveSession(target)
          if (!result.ok) throw new Error(result.message ?? 'stop failed')
          return 'Worker session stopped.'
        }
        const result = await orchestrator.stopAttempt(String(args.taskId ?? ''), String(args.stepId ?? ''))
        if (!result.ok) throw new Error(result.message ?? 'stop failed')
        return 'Worker session stopped.'
      },
    },
    {
      name: 'oac_session_insert_user_message',
      description: 'Insert one instruction as a user message into another LIVE local session (a Worker by slug, or a delegated session by the dshSessionId shown in twin_task_status) to drive it directly, outside task framing. Only running sessions can receive messages.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Worker slug or live session id.' },
          message: { type: 'string', description: 'The instruction to deliver.' },
        },
        required: ['target', 'message'],
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
      },
      async execute(args) {
        const result = await orchestrator.insertSessionMessage(String(args.target ?? ''), String(args.message ?? ''))
        if (!result.ok) throw new Error(result.message ?? result.code ?? 'insert failed')
        return `Message delivered to ${String(args.target)}.`
      },
    },
  ]
}

/** Install the twin overlay + twin tools on the twin's agent. */
export function installTwinOnAgent(
  ctx: HostContext,
  agent: HostAgentLike,
  twinSlug: string,
  options: { run?: RunFn; stepTimeoutMs?: number } = {},
): TwinOrchestrator {
  const orchestrator = createTwinOrchestrator(ctx, twinSlug, options)
  agent.ctx.systemPrompt?.section({
    name: 'oac:twin-orchestration',
    order: 100,
    text: TWIN_OVERLAY_TEXT,
  })
  for (const definition of buildTwinToolDefinitions(orchestrator, twinSlug, options.run)) {
    agent.ctx.tools?.register(definition)
  }
  return orchestrator
}
