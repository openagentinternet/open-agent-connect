/**
 * Chain history summary drain. The CLI owns the ledger bookkeeping
 * (`metabot chainhistory summary pending|apply`); this module ticks on a
 * timer while the DSH host is alive, asks each Bot with a configured DSH LLM
 * for its pending summary candidates, and drives one bounded summarization
 * per item through `ctx.llm`. Serial by design: one summary at a time, per
 * process. Cost gates: a global per-tick item budget plus a per-Bot daily cap
 * (counted by the CLI from local midnight) so a backlog can never stampede
 * the LLM.
 *
 * The summarizer LLM sits behind the SummarizerProvider seam: the default
 * provider routes through `generateLlmText` with the Bot's DSH brain pair
 * (fallback pair retried once on failure, mirroring the dream runner), but a
 * future local small-parameter model only needs a new provider implementation
 * — the scheduler and the CLI bookkeeping stay untouched.
 */
import { runMetabot } from './cli-bridge.js'
import { runMetabotWithPayloadFile, type RunFn } from './cli-payload.js'
import type { HostContext } from './context-types.js'
import { generateLlmText, type LlmStreamLike } from './llm-generate.js'

const DEFAULT_TICK_MINUTES = 30
const DEFAULT_DAILY_CAP = 40
const DEFAULT_PER_TICK = 10
const LIST_TIMEOUT_MS = 30_000
const BOOT_DELAY_MS = 20_000
/** Summaries are short; a 60s idle budget is generous even for a slow provider. */
const SUMMARY_LLM_IDLE_TIMEOUT_MS = 60_000
const SUMMARY_MAX_TOKENS = 512
/** Stored summaries are capped so a chatty model cannot bloat the ledger. */
const SUMMARY_MAX_CHARS = 500

export interface SummarizerInput {
  kind: 'write' | 'read'
  /** Read records carry the pin title; write records pass null. */
  title: string | null
  path: string | null
  /** Truncated stored text: contentText for writes, contentExcerpt for reads. */
  content: string
}

/**
 * The swappable summarizer seam. Implementations must resolve with the plain
 * summary text (no prefixes); throwing marks the record's attempt as failed.
 */
export interface SummarizerProvider {
  summarize(input: SummarizerInput): Promise<string>
}

/** The Bot's DSH brain pair plus optional fallback pair for one retry. */
export interface SummarizerBrains {
  provider: string
  model: string
  fallbackProvider?: string
  fallbackModel?: string
}

function buildSummaryPrompt(input: SummarizerInput): { system: string; user: string } {
  const system = [
    'You write compact memory notes for a MetaBot about its own on-chain activity.',
    'Summarize the central idea in 2-4 sentences, in the SAME language as the content.',
    'Output only the summary text: no commentary, no evaluation, no prefix like "Summary:".',
  ].join('\n')
  const context = [
    input.title ? `title: ${input.title}` : null,
    input.path ? `path: ${input.path}` : null,
  ].filter(Boolean).join(', ')
  const lead = input.kind === 'write'
    ? `You published the following content on-chain${context ? ` (${context})` : ''}:`
    : `You read the following on-chain content${context ? ` (${context})` : ''}:`
  const closing = input.kind === 'write'
    ? 'Summarize what you published.'
    : 'Summarize the central idea of what you read.'
  const user = `${lead}\n\n<content>\n${input.content}\n</content>\n\n${closing}`
  return { system, user }
}

/**
 * Default provider: one bounded `generateLlmText` call per item. On throw or
 * empty output (generateLlmText rejects on empty content) the whole call is
 * retried once on the fallback brain pair when configured.
 */
export function createDshLlmSummarizerProvider(llm: LlmStreamLike, brains: SummarizerBrains): SummarizerProvider {
  const call = (provider: string, model: string, system: string, user: string): Promise<string> =>
    generateLlmText(llm, {
      provider,
      model,
      system,
      user,
      maxTokens: SUMMARY_MAX_TOKENS,
      timeoutMs: SUMMARY_LLM_IDLE_TIMEOUT_MS,
    })
  return {
    async summarize(input) {
      const { system, user } = buildSummaryPrompt(input)
      let raw: string
      try {
        raw = await call(brains.provider, brains.model, system, user)
      } catch (primaryError) {
        const fallbackProvider = brains.fallbackProvider?.trim() ?? ''
        const fallbackModel = brains.fallbackModel?.trim() ?? ''
        if (!fallbackProvider || !fallbackModel
          || (fallbackProvider === brains.provider && fallbackModel === brains.model)) {
          throw primaryError
        }
        raw = await call(fallbackProvider, fallbackModel, system, user)
      }
      const summary = raw.trim().slice(0, SUMMARY_MAX_CHARS)
      if (!summary) throw new Error('LLM returned an empty summary')
      return summary
    },
  }
}

/** One normalized pending item from `chainhistory summary pending`. */
interface PendingSummaryItem {
  kind: 'write' | 'read'
  pinId: string
  title: string | null
  path: string | null
  contentText: string | null
}

function parsePendingItems(value: unknown): PendingSummaryItem[] {
  if (!Array.isArray(value)) return []
  const items: PendingSummaryItem[] = []
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const raw = entry as Record<string, unknown>
    const kind = raw.kind === 'write' || raw.kind === 'read' ? raw.kind : null
    const pinId = typeof raw.pinId === 'string' ? raw.pinId.trim() : ''
    if (!kind || !pinId) continue
    items.push({
      kind,
      pinId,
      title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : null,
      path: typeof raw.path === 'string' && raw.path.trim() ? raw.path : null,
      contentText: typeof raw.contentText === 'string' ? raw.contentText : null,
    })
  }
  return items
}

/** Best-effort outcome application; false when the CLI call itself failed. */
async function applyOutcome(
  run: RunFn,
  from: string,
  payload: { kind: 'write' | 'read'; pinId: string; outcome: 'done' | 'failed'; summary?: string },
): Promise<boolean> {
  try {
    const result = await runMetabotWithPayloadFile(
      ['chainhistory', 'summary', 'apply', '--from', from],
      payload,
      '--payload-file',
      [],
      run,
      { timeoutMs: LIST_TIMEOUT_MS },
    )
    return result.ok === true
  } catch {
    return false
  }
}

/** Per-Bot result of one scheduler pass: applied counts, a failure, or a skip reason. */
export interface ChainHistorySummaryBotOutcome {
  slug: string
  done: number
  failed: number
  error?: string
  /** Set when the Bot was passed over without attempting a summary. */
  skipped?: string
}

export interface ChainHistorySummaryTickOptions {
  run: RunFn
  llm: LlmStreamLike
  /** Global per-tick summary budget across all Bots (default 10). */
  perTick?: number
  /** Per-Bot daily summary budget, both kinds combined (default 40). */
  dailyCap?: number
}

/**
 * One scheduler pass over every Bot with a configured DSH LLM: fetch pending
 * candidates, then summarize + apply serially until the global per-tick
 * budget or the Bot's remaining daily budget runs out. One item's failure is
 * recorded on that record (outcome failed) and never interrupts the batch.
 */
export async function runChainHistorySummaryTick(
  options: ChainHistorySummaryTickOptions,
): Promise<ChainHistorySummaryBotOutcome[]> {
  const perTick = Math.max(1, Math.floor(options.perTick ?? DEFAULT_PER_TICK))
  const dailyCap = Math.max(1, Math.floor(options.dailyCap ?? DEFAULT_DAILY_CAP))
  const outcomes: ChainHistorySummaryBotOutcome[] = []
  const list = await options.run(['bot', 'list'], { timeoutMs: LIST_TIMEOUT_MS })
  const profiles = list.ok && list.data && typeof list.data === 'object'
    ? ((list.data as { profiles?: Array<Record<string, unknown>> }).profiles ?? [])
    : []
  let tickRemaining = perTick
  for (const profile of profiles) {
    const slug = typeof profile.slug === 'string' ? profile.slug.trim() : ''
    if (!slug) continue
    const outcome: ChainHistorySummaryBotOutcome = { slug, done: 0, failed: 0 }
    outcomes.push(outcome)
    try {
      const provider = typeof profile.dshLlmProvider === 'string' ? profile.dshLlmProvider.trim() : ''
      const model = typeof profile.dshLlmModel === 'string' ? profile.dshLlmModel.trim() : ''
      if (!provider || !model) {
        outcome.skipped = 'no DSH LLM configured on Bot'
        continue
      }
      if (tickRemaining <= 0) {
        outcome.skipped = 'per-tick summary budget exhausted'
        continue
      }
      const pending = await options.run(
        ['chainhistory', 'summary', 'pending', '--from', slug, '--limit', String(perTick)],
        { timeoutMs: LIST_TIMEOUT_MS },
      )
      if (!pending.ok) {
        outcome.skipped = pending.message ?? pending.code ?? 'chainhistory summary pending failed'
        continue
      }
      const data = (pending.data && typeof pending.data === 'object' ? pending.data : {}) as {
        items?: unknown
        summarizedToday?: unknown
      }
      const items = parsePendingItems(data.items)
      if (items.length === 0) {
        outcome.skipped = 'no pending summaries'
        continue
      }
      const summarizedToday = typeof data.summarizedToday === 'number' && Number.isFinite(data.summarizedToday)
        ? Math.max(0, Math.floor(data.summarizedToday))
        : 0
      let dailyRemaining = Math.max(0, dailyCap - summarizedToday)
      if (dailyRemaining <= 0) {
        outcome.skipped = 'daily summary cap reached'
        continue
      }
      const fallbackProvider = typeof profile.dshLlmFallbackProvider === 'string' ? profile.dshLlmFallbackProvider.trim() : ''
      const fallbackModel = typeof profile.dshLlmFallbackModel === 'string' ? profile.dshLlmFallbackModel.trim() : ''
      const summarizer = createDshLlmSummarizerProvider(options.llm, {
        provider,
        model,
        ...(fallbackProvider && fallbackModel ? { fallbackProvider, fallbackModel } : {}),
      })
      for (const item of items) {
        if (tickRemaining <= 0 || dailyRemaining <= 0) break
        const content = (item.contentText ?? '').trim()
        if (!content) {
          // Pending records always carry content by construction; a blank one
          // is a store anomaly — leave it alone rather than burning an attempt.
          continue
        }
        try {
          const summary = await summarizer.summarize({
            kind: item.kind,
            title: item.title,
            path: item.path,
            content,
          })
          if (await applyOutcome(options.run, slug, { kind: item.kind, pinId: item.pinId, outcome: 'done', summary })) {
            outcome.done += 1
            // Only completed summaries count against the daily cap (the CLI
            // counts records with summarizedAtMs set, i.e. done only).
            dailyRemaining -= 1
          } else {
            // The summary was generated but not persisted; the record stays
            // pending for a later tick, so do not burn a summary attempt.
            outcome.failed += 1
          }
        } catch {
          await applyOutcome(options.run, slug, { kind: item.kind, pinId: item.pinId, outcome: 'failed' })
          outcome.failed += 1
        }
        tickRemaining -= 1
      }
    } catch (error) {
      outcome.error = error instanceof Error ? error.message : String(error)
    }
  }
  return outcomes
}

/** Surface one tick's outcomes on the host logger (silent by default otherwise). */
export function reportChainHistorySummaryOutcomes(ctx: HostContext, outcomes: ChainHistorySummaryBotOutcome[]): void {
  for (const outcome of outcomes) {
    if (outcome.error) {
      ctx.logger?.warn?.(`[oac-dsh] chain-history summary: ${outcome.slug}: ${outcome.error}`)
    } else if (outcome.skipped) {
      ctx.logger?.info?.(`[oac-dsh] chain-history summary: ${outcome.slug} skipped: ${outcome.skipped}`)
    } else if (outcome.done > 0 || outcome.failed > 0) {
      ctx.logger?.info?.(`[oac-dsh] chain-history summary: ${outcome.slug} summarized ${outcome.done}, failed ${outcome.failed}`)
    }
  }
}

export interface ChainHistorySummarySchedulerOptions {
  run?: RunFn
  llm?: LlmStreamLike
  /** Global off switch (default enabled). */
  enabled?: boolean
  /** Scheduler tick period in minutes (default 30). */
  tickMinutes?: number
  /** Per-Bot daily summary budget (default 40). */
  dailyCap?: number
  /** Global per-tick summary budget (default 10). */
  perTick?: number
  /** Test hook: called after each tick with per-bot outcomes. */
  onTick?: (outcomes: ChainHistorySummaryBotOutcome[]) => void
}

/** Mount the scheduler; disposed with the plugin effect. */
export function applyChainHistorySummaryScheduler(ctx: HostContext, options: ChainHistorySummarySchedulerOptions = {}): void {
  if (!ctx.llm) return
  if (options.enabled === false) return
  const run = options.run ?? runMetabot
  const llm = options.llm ?? (ctx.llm as unknown as LlmStreamLike)
  const tickMs = Math.max(1, options.tickMinutes ?? DEFAULT_TICK_MINUTES) * 60_000
  const dailyCap = Math.max(1, options.dailyCap ?? DEFAULT_DAILY_CAP)
  const perTick = Math.max(1, options.perTick ?? DEFAULT_PER_TICK)
  let running = false

  const tick = (): void => {
    if (running) return
    running = true
    void runChainHistorySummaryTick({ run, llm, perTick, dailyCap })
      .then((outcomes) => {
        reportChainHistorySummaryOutcomes(ctx, outcomes)
        options.onTick?.(outcomes)
      })
      .catch((error) => {
        ctx.logger?.warn?.(`[oac-dsh] chain-history summary: tick failed: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => { running = false })
  }

  ctx.effect(() => {
    const timer = setInterval(tick, tickMs)
    // One pass shortly after mount: a fresh backlog drains as soon as the host
    // is alive instead of waiting for the first interval.
    const boot = setTimeout(tick, BOOT_DELAY_MS)
    return () => {
      clearInterval(timer)
      clearTimeout(boot)
    }
  }, 'oac-dsh: chain-history summary scheduler')
}
