/**
 * Minimal text-generation helper over the DSH host `llm` service
 * (`ctx.llm.stream`). Used by the dream runner; collects text-delta chunks
 * and surfaces provider failures as thrown errors.
 */
export interface LlmStreamChunkLike {
  type: string
  text?: string
  reason?: { kind: string; failure?: { message?: string } }
}

/** Subset of the DSH runtime's `LlmResolvedModelInfo` the dream path consumes. */
export interface LlmModelInfoLike {
  context?: { contextWindow?: unknown }
  defaultMaxTokens?: unknown
  reasoning?: { efforts?: Array<{ id?: unknown }>; defaultEffort?: unknown }
}

export interface LlmStreamLike {
  stream(options: {
    provider: string
    model: string
    messages: Array<{ role: 'system' | 'user'; content: Array<{ type: 'text'; text: string }> }>
    maxTokens?: number
    purpose?: string
    reasoningEffort?: string
  }): AsyncIterable<LlmStreamChunkLike>
  /** Exact-model metadata (context window, output cap, reasoning efforts). */
  resolveModelInfo?(provider: string, model: string): Promise<LlmModelInfoLike>
}

export interface GenerateTextOptions {
  provider: string
  model: string
  system: string
  user: string
  maxTokens?: number
  /** Optional reasoning effort (DSH adapter vocabulary: off/low/high/max). */
  reasoningEffort?: string
  /** Billing/diagnostics purpose tag forwarded to the host llm service. */
  purpose?: string
  /**
   * Idle timeout per stream chunk in milliseconds. When a provider silently
   * stalls (no chunk ever arrives, or the socket stays half-open), the plain
   * for-await loop would hang forever and the dream run would sit in
   * `running` until the stale-run sweeper kills it 30 minutes later. The
   * timeout aborts the iterator and rejects with a descriptive error
   * instead. Chunks that keep flowing reset the budget, so long legitimate
   * generations are not cut off.
   */
  timeoutMs?: number
}

/** Run one system+user completion and return the assembled text. */
export async function generateLlmText(llm: LlmStreamLike, options: GenerateTextOptions): Promise<string> {
  const messages: Array<{ role: 'system' | 'user'; content: Array<{ type: 'text'; text: string }> }> = [
    { role: 'system', content: [{ type: 'text', text: options.system }] },
    { role: 'user', content: [{ type: 'text', text: options.user }] },
  ]
  const timeoutMs = options.timeoutMs !== undefined && options.timeoutMs > 0 ? options.timeoutMs : null
  const iterable = llm.stream({
    provider: options.provider,
    model: options.model,
    messages,
    ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
    purpose: options.purpose ?? 'oac-dream',
  })
  const iterator = iterable[Symbol.asyncIterator]()
  let text = ''
  let reasoningChars = 0
  let finishKind: string | null = null
  let failure: string | null = null
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | null = null
      try {
        const next = timeoutMs === null
          ? await iterator.next()
          : await Promise.race([
              iterator.next(),
              new Promise<never>((_resolve, reject) => {
                timer = setTimeout(
                  () => reject(new Error(`llm stream produced no chunk for ${timeoutMs}ms (idle timeout)`)),
                  timeoutMs,
                )
              }),
            ])
        if (next.done) break
        const chunk = next.value
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          text += chunk.text
        } else if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
          reasoningChars += chunk.text.length
        } else if (chunk.type === 'finish' && chunk.reason) {
          finishKind = chunk.reason.kind
          if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
            failure = chunk.reason.failure?.message ?? `llm stream ${chunk.reason.kind}`
          }
        }
      } finally {
        if (timer) clearTimeout(timer)
      }
    }
  } catch (error) {
    // Best effort: ask the stream to shut down so the provider call is
    // released instead of lingering after we gave up on it.
    try {
      await iterator.return?.()
    } catch {
      // ignore cleanup failures
    }
    throw error
  }
  if (failure) {
    throw new Error(failure)
  }
  if (!text.trim()) {
    if (reasoningChars > 0) {
      // A thinking model spent its whole output budget on reasoning chunks
      // and finished before emitting any text — the persistent nightly-dream
      // failure on reasoning-default models. Name the cause so the run row
      // (and the fallback-pair retry decision) carries something actionable.
      throw new Error(
        `llm stream returned empty content (reasoning-only output: ${reasoningChars} chars of thinking, finish ${finishKind ?? 'unknown'} — disable reasoning or raise maxTokens)`,
      )
    }
    throw new Error('llm stream returned empty content')
  }
  return text
}

/** Model limits forwarded to `dream plan` so budgets size to the declared model. */
export interface DreamLlmLimits {
  contextWindow?: number
  maxOutputTokens?: number
}

/** Per-pair dream generation profile resolved from exact-model metadata. */
export interface DreamLlmProfile {
  /** Effort to pass on every dream generation when the model declares 'off'. */
  reasoningEffort?: string
  limits?: DreamLlmLimits
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

/**
 * Best-effort per-model dream profile (IDBots `thinking: 'disabled'` parity).
 * Dreams want reasoning OFF: a reasoning-default model can burn the entire
 * output budget on `reasoning-delta` chunks and finish with zero text — the
 * recurring `llm stream returned empty content` dream failures. The effort is
 * passed ONLY when the model's declared efforts include 'off': the pi-ai
 * adapter rejects unsupported efforts outright (UNSUPPORTED_REASONING_EFFORT),
 * and for it 'off' merely omits the knob anyway. Declared limits feed the
 * plan's budget math (DeepSeek V4 declares a 32k output cap; the plan's
 * default assumption is 8192). Never throws; missing/failing metadata
 * degrades to today's behavior.
 */
export async function resolveDreamLlmProfile(
  llm: LlmStreamLike,
  provider: string,
  model: string,
): Promise<DreamLlmProfile> {
  if (typeof llm.resolveModelInfo !== 'function') return {}
  let info: LlmModelInfoLike
  try {
    info = await llm.resolveModelInfo(provider, model)
  } catch {
    return {}
  }
  if (!info || typeof info !== 'object') return {}
  const efforts = info.reasoning?.efforts
  const reasoningEffort = Array.isArray(efforts)
    && efforts.some((effort) => effort && typeof effort === 'object' && effort.id === 'off')
    ? 'off'
    : undefined
  const contextWindow = positiveInt(info.context?.contextWindow)
  const maxOutputTokens = positiveInt(info.defaultMaxTokens)
  const limits: DreamLlmLimits = {
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
  }
  return {
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    ...(Object.keys(limits).length > 0 ? { limits } : {}),
  }
}
