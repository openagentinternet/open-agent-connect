/**
 * Scheduled-task host claiming. The CLI/daemon own the data model, due math,
 * and run ledger (`metabot schedule *`, daemon `/api/schedule/*`); this module
 * ticks on a timer while the DSH host is alive, heartbeats each local Bot so
 * the daemon tick stands down under the fresh host lease, claims `auto`/`host`
 * due tasks as the host, and runs each one as a new DSH conversation — the
 * `local_worker_delegate` session pattern (`agents.create` + preset mount).
 * Serial by design: one task at a time, per process. When the daemon is
 * unreachable the whole daemon path falls back to the CLI verbs — safe because
 * a dead daemon cannot race a claim.
 */
import { randomUUID } from 'node:crypto'
import { request as httpRequest, get as httpGet } from 'node:http'
import { runMetabot, type MetabotCommandResult } from './cli-bridge.js'
import type { RunFn } from './cli-payload.js'
import { presetIdForSlug } from './chip-logic.js'
import type { AgentPresetsLike, HostAgentsRegistryLike, HostContext } from './context-types.js'
import { resolveDaemonBaseUrl } from './browser-bridge.js'
import {
  agentsRegistryOf,
  errorFromTurnEvents,
  workerModelPair,
  type DshModelPair,
} from './twin-tools.js'

const DEFAULT_TICK_SECONDS = 60
const DEFAULT_RUN_TIMEOUT_MS = 30 * 60_000
const LIST_TIMEOUT_MS = 30_000
const DAEMON_HTTP_TIMEOUT_MS = 10_000
const BOOT_DELAY_MS = 20_000
/** Host identity sent with every heartbeat (the daemon lease record). */
const HOST_NAME = 'dsh'
/** CLI flag values are argv entries; cap long error text like the bridge's stderr trim. */
const CLI_ERROR_MAX_CHARS = 400

/** A due task as `schedule due` reports it (structural subset of the store row). */
export interface ScheduleTaskLike {
  id: string
  name: string
  prompt: string
  workingDirectory: string
  channel: string
}

/**
 * The daemon schedule surface over loopback HTTP (`/api/schedule/*`). A null
 * return means "transport failed — the daemon is unreachable; use the CLI
 * fallback". Failed envelopes (task already running, expired, …) are NOT null:
 * the daemon answered, so its verdict stands.
 */
export interface ScheduleDaemonLike {
  heartbeat(slug: string, host: string): Promise<MetabotCommandResult | null>
  due(from: string): Promise<MetabotCommandResult | null>
  claim(from: string, taskId: string, executor: string): Promise<MetabotCommandResult | null>
  complete(
    from: string,
    runId: string,
    input: { error?: string; durationMs?: number },
  ): Promise<MetabotCommandResult | null>
}

function isEnvelope(value: unknown): value is MetabotCommandResult {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as { ok?: unknown }).ok === 'boolean'
}

/** One daemon JSON call. Null means "transport failed — try the CLI fallback". */
function daemonRequestJson(
  baseUrl: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<MetabotCommandResult | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: MetabotCommandResult | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const onResponse = (response: import('node:http').IncomingMessage): void => {
      response.setEncoding('utf8')
      let data = ''
      response.on('data', (chunk: string) => { data += chunk })
      response.on('end', () => {
        try {
          const parsed: unknown = JSON.parse(data)
          finish(isEnvelope(parsed) ? parsed : null)
        } catch {
          finish(null)
        }
      })
      response.on('error', () => finish(null))
    }
    const url = `${baseUrl}${path}`
    let request: ReturnType<typeof httpRequest>
    if (method === 'POST') {
      const payload = JSON.stringify(body ?? {})
      request = httpRequest(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      }, onResponse)
      request.write(payload)
      request.end()
    } else {
      request = httpGet(url, onResponse)
    }
    const timer = setTimeout(() => {
      request.destroy()
      finish(null)
    }, DAEMON_HTTP_TIMEOUT_MS)
    request.on('error', () => finish(null))
  })
}

async function daemonRequest(
  resolveBaseUrl: () => Promise<string | null>,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<MetabotCommandResult | null> {
  const baseUrl = await resolveBaseUrl()
  if (baseUrl === null) return null
  return daemonRequestJson(baseUrl, method, path, body)
}

/** Loopback HTTP transport for the daemon schedule surface. */
export function createDaemonScheduleTransport(
  resolveBaseUrl: () => Promise<string | null> = resolveDaemonBaseUrl,
): ScheduleDaemonLike {
  return {
    heartbeat: (slug, host) => daemonRequest(resolveBaseUrl, 'POST', '/api/schedule/heartbeat', { slug, host }),
    due: (from) => daemonRequest(resolveBaseUrl, 'GET', `/api/schedule/due?from=${encodeURIComponent(from)}`),
    claim: (from, taskId, executor) => (
      daemonRequest(resolveBaseUrl, 'POST', '/api/schedule/claim', { from, id: taskId, executor })
    ),
    complete: (from, runId, input) => (
      daemonRequest(resolveBaseUrl, 'POST', '/api/schedule/complete', { from, runId, ...input })
    ),
  }
}

function parseDueTasks(value: unknown): ScheduleTaskLike[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
  const due = (value as { due?: unknown }).due
  if (!Array.isArray(due)) return []
  const tasks: ScheduleTaskLike[] = []
  for (const entry of due) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const list = (entry as { tasks?: unknown }).tasks
    if (!Array.isArray(list)) continue
    for (const task of list) {
      if (task === null || typeof task !== 'object' || Array.isArray(task)) continue
      const raw = task as Record<string, unknown>
      const id = typeof raw.id === 'string' ? raw.id.trim() : ''
      if (!id) continue
      tasks.push({
        id,
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id,
        prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
        workingDirectory: typeof raw.workingDirectory === 'string' ? raw.workingDirectory : '',
        channel: typeof raw.channel === 'string' ? raw.channel : 'auto',
      })
    }
  }
  return tasks
}

function runIdOf(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return ''
  const run = (value as { run?: unknown }).run
  if (run === null || typeof run !== 'object' || Array.isArray(run)) return ''
  const id = (run as { id?: unknown }).id
  return typeof id === 'string' ? id.trim() : ''
}

/**
 * Claim one due task as this host. Daemon route first (its store instance is
 * the same one the daemon tick uses, so claims are serialized with it); the
 * CLI fallback is safe because a dead daemon cannot race a claim. Executor is
 * `host` (the only value both surfaces accept; the daemon route normalizes
 * anything else to it). Returns null when the claim did not land (already
 * running, expired, deleted, transport failure) — the task is simply skipped
 * this pass.
 */
async function claimTask(deps: ScheduleTickDeps, from: string, taskId: string): Promise<string | null> {
  const daemonClaim = await deps.daemon.claim(from, taskId, 'host')
  if (daemonClaim !== null) {
    if (!daemonClaim.ok) return null
    return runIdOf(daemonClaim.data) || null
  }
  const cliClaim = await deps.run(
    ['schedule', 'claim', '--id', taskId, '--from', from, '--executor', 'host'],
    { timeoutMs: LIST_TIMEOUT_MS },
  )
  if (!cliClaim.ok) return null
  return runIdOf(cliClaim.data) || null
}

/** Settle a claimed run. Daemon route first; CLI fallback when it is unreachable. */
async function completeTask(
  deps: ScheduleTickDeps,
  from: string,
  runId: string,
  input: { error?: string; durationMs?: number },
): Promise<void> {
  const daemonComplete = await deps.daemon.complete(from, runId, input)
  if (daemonComplete !== null) return
  const args = ['schedule', 'complete', '--run-id', runId, '--from', from]
  if (input.durationMs !== undefined) args.push('--duration-ms', String(Math.max(0, Math.floor(input.durationMs))))
  if (input.error) args.push('--error', input.error.slice(0, CLI_ERROR_MAX_CHARS))
  await deps.run(args, { timeoutMs: LIST_TIMEOUT_MS })
}

/**
 * Run one claimed task as a new DSH conversation: `agents.create` +
 * `agentPresets.mount` of `oac-<slug>`, the Bot's DSH LLM pair with the host
 * default as fallback, `cwd = task.workingDirectory || host cwd`. The session
 * stays alive afterwards (the conversation list shows it, the owner can
 * continue it) — only the run ledger settles here.
 */
async function runScheduledSession(
  deps: ScheduleTickDeps,
  slug: string,
  profile: Record<string, unknown> | undefined,
  task: ScheduleTaskLike,
  runTimeoutMs: number,
  hostCwd: string,
): Promise<ScheduledSessionResult> {
  const modelPair = deps.modelPair(profile)
  if (!modelPair) {
    return {
      ok: false,
      error: 'No LLM model for the scheduled task: configure the Bot DSH LLM pair (Settings → Bots) or a host default model.',
    }
  }
  const sessionId = randomUUID()
  const controller = new AbortController()
  let failureText: string | null = null
  let timedOut = false
  let sessionEvents: ReadonlyArray<{ type: string; data?: unknown }> = []
  try {
    const handle = await deps.agents.create({
      sessionId,
      // cwd keeps the session in the host workspace bucket: the DSH
      // conversation list drops cold sessions without one.
      meta: { agentPreset: presetIdForSlug(slug), cwd: task.workingDirectory || hostCwd },
      agentOptions: {
        provider: modelPair.provider,
        model: modelPair.model,
        ...(modelPair.reasoningEffort ? { reasoningEffort: modelPair.reasoningEffort } : {}),
      },
      setup: async (agentCtx: unknown) => {
        await deps.agentPresets.mount?.(agentCtx, presetIdForSlug(slug))
      },
      signal: controller.signal,
    })
    const worker = handle.agent
    // The `[Scheduled] <name>` prefix becomes the session title through the
    // DSH deterministic title fallback (first eligible human message's leading
    // words), matching the IDBots `[Scheduled] <name>` conversation naming.
    worker.followup?.({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: `[Scheduled] ${task.name}: ${task.prompt}` }],
      source: { kind: 'plugin', plugin: 'oac-dsh', form: 'scheduled-task' },
    })
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timed_out'>((resolve) => {
      timeoutTimer = setTimeout(() => resolve('timed_out'), runTimeoutMs)
      controller.signal.addEventListener('abort', () => {
        clearTimeout(timeoutTimer)
        resolve('timed_out')
      }, { once: true })
    })
    const idle = Promise.resolve(worker.whenIdle?.()).then(() => 'idle' as const)
    const outcome = await Promise.race([idle, timeout])
    // The losing arm's timer must not outlive the race (same rule as the delegate timeout).
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
    }
    // Keep the session alive after the run (IDBots parity): disposing would
    // delete it from the host store and drop its conversation row.
  } catch (error) {
    failureText = error instanceof Error ? error.message : String(error)
  }
  const turnError = errorFromTurnEvents(sessionEvents)
  const errorText = failureText
    ?? (timedOut ? `scheduled task timed out after ${Math.round(runTimeoutMs / 1000)}s` : turnError)
  if (failureText !== null || timedOut || turnError) {
    return { ok: false, error: errorText }
  }
  return { ok: true }
}

/** One claimed task's session outcome. */
interface ScheduledSessionResult {
  ok: boolean
  error?: string
}

/** Per-Bot result of one scheduler pass: claimed/ran/failed counts or a skip reason. */
export interface ScheduleBotOutcome {
  slug: string
  claimed: number
  ran: number
  failed: number
  error?: string
  /** Set when the Bot was passed over without attempting any claim. */
  skipped?: string
}

export interface ScheduleTickDeps {
  run: RunFn
  daemon: ScheduleDaemonLike
  agents: HostAgentsRegistryLike
  agentPresets: AgentPresetsLike
  /** Bot DSH LLM pair with host-default fallback; null means no session can run. */
  modelPair: (profile: Record<string, unknown> | undefined) => DshModelPair | null
  /** Per-run idle watchdog (default 30 minutes). */
  runTimeoutMs?: number
  /** Session cwd fallback when a task carries no workingDirectory (default process.cwd()). */
  cwd?: string
}

/**
 * One scheduler pass over every local Bot: heartbeat, fetch due tasks, claim
 * `auto`/`host` ones, and run each as a new DSH conversation. One task at a
 * time, serial; per-bot failures land on the outcome and never throw.
 */
export async function runScheduleSchedulerTick(deps: ScheduleTickDeps): Promise<ScheduleBotOutcome[]> {
  const runTimeoutMs = Math.max(1, deps.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS)
  const hostCwd = deps.cwd ?? process.cwd()
  const outcomes: ScheduleBotOutcome[] = []
  const list = await deps.run(['bot', 'list'], { timeoutMs: LIST_TIMEOUT_MS })
  const profiles = list.ok && list.data && typeof list.data === 'object'
    ? ((list.data as { profiles?: Array<Record<string, unknown>> }).profiles ?? [])
    : []
  for (const profile of profiles) {
    const slug = typeof profile.slug === 'string' ? profile.slug.trim() : ''
    if (!slug) continue
    const outcome: ScheduleBotOutcome = { slug, claimed: 0, ran: 0, failed: 0 }
    outcomes.push(outcome)
    try {
      // Heartbeat is daemon-only (there is no CLI verb; a dead daemon holds no
      // lease to refresh). A failure here must not stop the bot — due may
      // still be served through the CLI fallback below.
      await deps.daemon.heartbeat(slug, HOST_NAME)
      const due = await deps.daemon.due(slug)
      let tasks: ScheduleTaskLike[]
      if (due === null) {
        const cliDue = await deps.run(['schedule', 'due', '--from', slug], { timeoutMs: LIST_TIMEOUT_MS })
        if (!cliDue.ok) {
          outcome.error = cliDue.message ?? cliDue.code ?? 'schedule due failed'
          continue
        }
        tasks = parseDueTasks(cliDue.data)
      } else {
        if (!due.ok) {
          outcome.error = due.message ?? due.code ?? 'schedule due failed'
          continue
        }
        tasks = parseDueTasks(due.data)
      }
      // Channel `daemon` tasks are owned by the daemon tick; this host only
      // claims `auto`/`host` ones.
      const claimable = tasks.filter((task) => task.prompt && task.channel !== 'daemon')
      if (claimable.length === 0) {
        outcome.skipped = 'no claimable due tasks'
        continue
      }
      for (const task of claimable) {
        const claimedAtMs = Date.now()
        const runId = await claimTask(deps, slug, task.id)
        if (runId === null) continue // already running / expired / deleted — skip
        outcome.claimed += 1
        const result = await runScheduledSession(deps, slug, profile, task, runTimeoutMs, hostCwd)
        const durationMs = Math.max(0, Date.now() - claimedAtMs)
        try {
          await completeTask(deps, slug, runId, {
            ...(result.ok ? {} : { error: result.error ?? 'scheduled task failed' }),
            durationMs,
          })
        } catch (error) {
          outcome.error = `settle failed: ${error instanceof Error ? error.message : String(error)}`
        }
        if (result.ok) outcome.ran += 1
        else outcome.failed += 1
      }
    } catch (error) {
      outcome.error = error instanceof Error ? error.message : String(error)
    }
  }
  return outcomes
}

/** Surface one tick's outcomes on the host logger (silent by default otherwise). */
export function reportScheduleOutcomes(ctx: HostContext, outcomes: ScheduleBotOutcome[]): void {
  for (const outcome of outcomes) {
    if (outcome.error) {
      ctx.logger?.warn?.(`[oac-dsh] schedule scheduler: ${outcome.slug}: ${outcome.error}`)
    } else if (outcome.skipped) {
      ctx.logger?.info?.(`[oac-dsh] schedule scheduler: ${outcome.slug} skipped: ${outcome.skipped}`)
    } else if (outcome.claimed > 0) {
      ctx.logger?.info?.(`[oac-dsh] schedule scheduler: ${outcome.slug} ran ${outcome.ran}, failed ${outcome.failed}`)
    }
  }
}

export interface ScheduleSchedulerOptions {
  run?: RunFn
  /** Scheduler tick period in seconds (default 60). */
  tickSeconds?: number
  /** Per-run idle watchdog (default 30 minutes). */
  runTimeoutMs?: number
  /** Daemon transport override (tests). */
  daemon?: ScheduleDaemonLike
  /** Agents registry override (tests). */
  agents?: HostAgentsRegistryLike
  /** Agent presets override (tests). */
  agentPresets?: AgentPresetsLike
  /** Model route override (tests); defaults to the Bot DSH pair with host-default fallback. */
  modelPair?: (profile: Record<string, unknown> | undefined) => DshModelPair | null
  /** Session cwd override (tests; default process.cwd()). */
  cwd?: string
  /** Test hook: called after each tick with per-bot outcomes. */
  onTick?: (outcomes: ScheduleBotOutcome[]) => void
}

/** Mount the scheduler; disposed with the plugin effect. */
export function applyScheduleScheduler(ctx: HostContext, options: ScheduleSchedulerOptions = {}): void {
  const agents = options.agents ?? agentsRegistryOf(ctx)
  const agentPresets = options.agentPresets ?? ctx.agentPresets
  if (!agents?.create || !agentPresets?.mount) return // the host cannot spawn sessions
  const run = options.run ?? runMetabot
  const daemon = options.daemon ?? createDaemonScheduleTransport()
  const modelPair = options.modelPair ?? ((profile) => workerModelPair(ctx, profile))
  const tickSeconds = Math.max(1, options.tickSeconds ?? DEFAULT_TICK_SECONDS)
  const runTimeoutMs = options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS
  const cwd = options.cwd ?? process.cwd()
  let running = false

  const tick = (): void => {
    if (running) return
    running = true
    void runScheduleSchedulerTick({ run, daemon, agents, agentPresets, modelPair, runTimeoutMs, cwd })
      .then((outcomes) => {
        reportScheduleOutcomes(ctx, outcomes)
        options.onTick?.(outcomes)
      })
      .catch((error) => {
        ctx.logger?.warn?.(`[oac-dsh] schedule scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => { running = false })
  }

  ctx.effect(() => {
    const timer = setInterval(tick, tickSeconds * 1000)
    // One pass shortly after mount: due tasks start draining as soon as the
    // host is alive instead of waiting for the first interval.
    const boot = setTimeout(tick, BOOT_DELAY_MS)
    return () => {
      clearInterval(timer)
      clearTimeout(boot)
    }
  }, 'oac-dsh: schedule scheduler')
}
