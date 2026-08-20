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

export interface DreamSchedulerOptions {
  run?: RunFn
  llm?: LlmStreamLike
  tickMinutes?: number
  /** Test hook: called after each tick with per-bot outcomes. */
  onTick?: (outcomes: Array<{ slug: string; dreamed: string[]; error?: string }>) => void
}

function readPolicyEnabled(data: unknown): boolean {
  if (!data || typeof data !== 'object') return true
  const effective = (data as { effective?: { dreamEnabled?: unknown } }).effective
  return effective?.dreamEnabled !== false
}

/** One scheduler pass over every dream-enabled Bot with a configured DSH LLM. */
export async function runDreamSchedulerTick(
  options: DreamSchedulerOptions & { run: RunFn; llm: LlmStreamLike },
): Promise<Array<{ slug: string; dreamed: string[]; error?: string }>> {
  const outcomes: Array<{ slug: string; dreamed: string[]; error?: string }> = []
  const list = await options.run(['bot', 'list'], { timeoutMs: LIST_TIMEOUT_MS })
  const profiles = list.ok && list.data && typeof list.data === 'object'
    ? ((list.data as { profiles?: Array<Record<string, unknown>> }).profiles ?? [])
    : []
  for (const profile of profiles) {
    const slug = typeof profile.slug === 'string' ? profile.slug : ''
    if (!slug) continue
    const outcome: { slug: string; dreamed: string[]; error?: string } = { slug, dreamed: [] }
    outcomes.push(outcome)
    try {
      const policy = await options.run(['memory', 'policy', 'get', '--from', slug], { timeoutMs: LIST_TIMEOUT_MS })
      if (policy.ok && !readPolicyEnabled(policy.data)) continue
      const provider = typeof profile.dshLlmProvider === 'string' ? profile.dshLlmProvider.trim() : ''
      const model = typeof profile.dshLlmModel === 'string' ? profile.dshLlmModel.trim() : ''
      if (!provider || !model) continue
      const due = await options.run(['dream', 'due', '--from', slug], { timeoutMs: LIST_TIMEOUT_MS })
      if (!due.ok) continue
      const dueData = due.data as { dueDates?: string[]; repairDates?: string[] }
      const dueDates = Array.isArray(dueData.dueDates) ? dueData.dueDates : []
      const repairDates = Array.isArray(dueData.repairDates) ? dueData.repairDates : []
      for (const date of dueDates) {
        const result = await runDreamWithLlm({ from: slug, date, provider, model }, options.run, options.llm)
        if (result.ok) outcome.dreamed.push(date)
        else outcome.error = result.message ?? result.code
      }
      // At most one version-repair per pass (IDBots nightly cap).
      const repairDate = repairDates[0]
      if (repairDate) {
        const result = await runDreamWithLlm(
          { from: slug, date: repairDate, provider, model, isRepair: true },
          options.run,
          options.llm,
        )
        if (result.ok) outcome.dreamed.push(repairDate)
        else outcome.error = result.message ?? result.code
      }
    } catch (error) {
      outcome.error = error instanceof Error ? error.message : String(error)
    }
  }
  return outcomes
}

/** Mount the scheduler; disposed with the plugin effect. */
export function applyDreamScheduler(ctx: HostContext, options: DreamSchedulerOptions = {}): void {
  if (!ctx.llm) return
  const run = options.run ?? runMetabot
  const llm = options.llm ?? (ctx.llm as unknown as LlmStreamLike)
  const tickMs = Math.max(1, options.tickMinutes ?? DEFAULT_TICK_MINUTES) * 60_000
  let running = false

  const tick = (): void => {
    if (running) return
    running = true
    void runDreamSchedulerTick({ run, llm })
      .then((outcomes) => options.onTick?.(outcomes))
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
