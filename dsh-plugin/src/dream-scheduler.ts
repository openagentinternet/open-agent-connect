/**
 * Nightly dream scheduler. The CLI owns the window/stagger/catch-up/backoff
 * arithmetic (`metabot dream due`); this module just ticks on a timer while
 * the DSH host is alive, asks each dream-enabled Bot what is due, and drives
 * the dream through `ctx.llm`. Serial by design: one dream at a time, per
 * process. Missed nights are caught up by the due-date algorithm itself.
 */
import { runMetabot } from './cli-bridge.js'
import type { RunFn } from './cli-payload.js'
import type { HostContext } from './context-types.js'
import type { LlmStreamLike } from './llm-generate.js'
import { runDreamWithLlm } from './memory-routes.js'

const DEFAULT_TICK_MINUTES = 10
const LIST_TIMEOUT_MS = 30_000
/** Hygiene runs in-process on the CLI; the deep-consolidation LLM attempt alone may take 3 minutes. */
const HYGIENE_RUN_TIMEOUT_MS = 600_000

/** Per-Bot result of one scheduler pass: dreamed dates, a failure, or a skip reason. */
export interface DreamBotOutcome {
  slug: string
  dreamed: string[]
  error?: string
  /** Set when the Bot was passed over without attempting a dream. */
  skipped?: string
  /** Set when the memory-hygiene tail ran for this Bot. */
  hygieneRan?: boolean
  hygieneError?: string
  hygieneSkipped?: string
}

export interface DreamSchedulerOptions {
  run?: RunFn
  llm?: LlmStreamLike
  tickMinutes?: number
  /** Dream pass master switch (default enabled); when false the tick only runs the hygiene tail. */
  dreamEnabled?: boolean
  /** Memory-hygiene tail after the dream pass (default enabled; CLI `memory hygiene due/run`). */
  hygieneEnabled?: boolean
  /** Test hook: called after each tick with per-bot outcomes. */
  onTick?: (outcomes: DreamBotOutcome[]) => void
}

function readPolicyEnabled(data: unknown): boolean {
  if (!data || typeof data !== 'object') return true
  const effective = (data as { effective?: { dreamEnabled?: unknown } }).effective
  return effective?.dreamEnabled !== false
}

/** One scheduler pass over every dream-enabled Bot with a configured DSH LLM. */
export async function runDreamSchedulerTick(
  options: DreamSchedulerOptions & { run: RunFn; llm?: LlmStreamLike },
): Promise<DreamBotOutcome[]> {
  const outcomes: DreamBotOutcome[] = []
  const list = await options.run(['bot', 'list'], { timeoutMs: LIST_TIMEOUT_MS })
  const profiles = list.ok && list.data && typeof list.data === 'object'
    ? ((list.data as { profiles?: Array<Record<string, unknown>> }).profiles ?? [])
    : []
  for (const profile of profiles) {
    const slug = typeof profile.slug === 'string' ? profile.slug : ''
    if (!slug) continue
    const outcome: DreamBotOutcome = { slug, dreamed: [] }
    outcomes.push(outcome)
    if (options.dreamEnabled === false) continue
    const llm = options.llm
    if (!llm) {
      outcome.skipped = 'host LLM unavailable'
      continue
    }
    try {
      const policy = await options.run(['memory', 'policy', 'get', '--from', slug], { timeoutMs: LIST_TIMEOUT_MS })
      if (policy.ok && !readPolicyEnabled(policy.data)) {
        outcome.skipped = 'dream disabled by policy'
        continue
      }
      const provider = typeof profile.dshLlmProvider === 'string' ? profile.dshLlmProvider.trim() : ''
      const model = typeof profile.dshLlmModel === 'string' ? profile.dshLlmModel.trim() : ''
      if (!provider || !model) {
        outcome.skipped = 'no DSH LLM configured on Bot'
        continue
      }
      const fallbackProvider = typeof profile.dshLlmFallbackProvider === 'string' ? profile.dshLlmFallbackProvider.trim() : ''
      const fallbackModel = typeof profile.dshLlmFallbackModel === 'string' ? profile.dshLlmFallbackModel.trim() : ''
      const llmConfig = { provider, model, fallbackProvider, fallbackModel }
      const due = await options.run(['dream', 'due', '--from', slug], { timeoutMs: LIST_TIMEOUT_MS })
      if (!due.ok) {
        outcome.error = due.message ?? due.code ?? 'dream due failed'
        continue
      }
      const dueData = due.data as { dueDates?: string[]; repairDates?: string[] }
      const dueDates = Array.isArray(dueData.dueDates) ? dueData.dueDates : []
      const repairDates = Array.isArray(dueData.repairDates) ? dueData.repairDates : []
      // At most one version-repair per pass (IDBots nightly cap).
      const repairDate = repairDates[0]
      if (dueDates.length === 0 && !repairDate) {
        outcome.skipped = 'no due dates'
        continue
      }
      for (const date of dueDates) {
        const result = await runDreamWithLlm({ from: slug, date, ...llmConfig }, options.run, llm)
        if (result.ok) outcome.dreamed.push(date)
        else outcome.error = result.message ?? result.code
      }
      if (repairDate) {
        const result = await runDreamWithLlm(
          { from: slug, date: repairDate, ...llmConfig, isRepair: true },
          options.run,
          llm,
        )
        if (result.ok) outcome.dreamed.push(repairDate)
        else outcome.error = result.message ?? result.code
      }
    } catch (error) {
      outcome.error = error instanceof Error ? error.message : String(error)
    }
  }
  // Hygiene tail: after the dream pass, each Bot's due memory-hygiene pass
  // (eligible once per local date, all-day catch-up; the CLI decides).
  if (options.hygieneEnabled !== false) {
    for (const outcome of outcomes) {
      const hygiene = await runHygieneTail(options.run, outcome.slug)
      outcome.hygieneRan = hygiene.ran
      if (hygiene.error) outcome.hygieneError = hygiene.error
      else if (hygiene.skipped) outcome.hygieneSkipped = hygiene.skipped
    }
  }
  return outcomes
}

/** Surface one tick's outcomes on the host logger (silent by default otherwise). */
export function reportDreamSchedulerOutcomes(ctx: HostContext, outcomes: DreamBotOutcome[]): void {
  for (const outcome of outcomes) {
    if (outcome.error) {
      ctx.logger?.warn?.(`[oac-dsh] dream scheduler: ${outcome.slug}: ${outcome.error}`)
    } else if (outcome.skipped) {
      ctx.logger?.info?.(`[oac-dsh] dream scheduler: ${outcome.slug} skipped: ${outcome.skipped}`)
    } else if (outcome.dreamed.length > 0) {
      ctx.logger?.info?.(`[oac-dsh] dream scheduler: ${outcome.slug} dreamed ${outcome.dreamed.join(', ')}`)
    }
    if (outcome.hygieneRan) {
      ctx.logger?.info?.(`[oac-dsh] dream scheduler: ${outcome.slug} hygiene ran`)
    } else if (outcome.hygieneError) {
      ctx.logger?.warn?.(`[oac-dsh] dream scheduler: ${outcome.slug} hygiene: ${outcome.hygieneError}`)
    }
  }
}

/**
 * Memory-hygiene tail: `memory hygiene due` → `memory hygiene run` for one
 * Bot, serial with the dream pass. The CLI owns eligibility (>=04:00 local,
 * once per date, per-Bot `hygieneEnabled` policy) and deep consolidation is
 * skipped, not failed, when no LLM runtime is bound. Errors are returned, not
 * thrown, so one Bot's hygiene failure never breaks the tick.
 */
export async function runHygieneTail(run: RunFn, slug: string): Promise<{ ran: boolean; error?: string; skipped?: string }> {
  try {
    const due = await run(['memory', 'hygiene', 'due', '--from', slug], { timeoutMs: LIST_TIMEOUT_MS })
    if (!due.ok) {
      return { ran: false, error: due.message ?? due.code ?? 'memory hygiene due failed' }
    }
    const dueData = (due.data && typeof due.data === 'object' ? due.data : {}) as { due?: unknown }
    if (dueData.due !== true) {
      return { ran: false, skipped: 'not due' }
    }
    const result = await run(['memory', 'hygiene', 'run', '--from', slug], { timeoutMs: HYGIENE_RUN_TIMEOUT_MS })
    if (!result.ok) {
      return { ran: false, error: result.message ?? result.code ?? 'memory hygiene run failed' }
    }
    return { ran: true }
  } catch (error) {
    return { ran: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Mount the scheduler; disposed with the plugin effect. */
export function applyDreamScheduler(ctx: HostContext, options: DreamSchedulerOptions = {}): void {
  const dreamEnabled = options.dreamEnabled !== false
  const hygieneEnabled = options.hygieneEnabled !== false
  if (!dreamEnabled && !hygieneEnabled) return
  const run = options.run ?? runMetabot
  const llm = options.llm ?? (ctx.llm as unknown as LlmStreamLike | undefined)
  if (dreamEnabled && !llm) return
  const tickMs = Math.max(1, options.tickMinutes ?? DEFAULT_TICK_MINUTES) * 60_000
  let running = false

  const tick = (): void => {
    if (running) return
    running = true
    void runDreamSchedulerTick({ run, llm, dreamEnabled, hygieneEnabled })
      .then((outcomes) => {
        reportDreamSchedulerOutcomes(ctx, outcomes)
        options.onTick?.(outcomes)
      })
      .catch((error) => {
        ctx.logger?.warn?.(`[oac-dsh] dream scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => { running = false })
  }

  ctx.effect(() => {
    const timer = setInterval(tick, tickMs)
    // One immediate pass on mount: missed nights catch up as soon as the host
    // is alive, instead of waiting for the first interval.
    const boot = setTimeout(tick, 15_000)
    return () => {
      clearInterval(timer)
      clearTimeout(boot)
    }
  }, 'oac-dsh: dream scheduler')
}
