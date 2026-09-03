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

export interface LlmStreamLike {
  stream(options: {
    provider: string
    model: string
    messages: Array<{ role: 'system' | 'user'; content: Array<{ type: 'text'; text: string }> }>
    maxTokens?: number
    purpose?: string
  }): AsyncIterable<LlmStreamChunkLike>
}

export interface GenerateTextOptions {
  provider: string
  model: string
  system: string
  user: string
  maxTokens?: number
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
    purpose: 'oac-dream',
  })
  const iterator = iterable[Symbol.asyncIterator]()
  let text = ''
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
        } else if (chunk.type === 'finish' && chunk.reason) {
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
    throw new Error('llm stream returned empty content')
  }
  return text
}
