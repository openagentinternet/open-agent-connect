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
}

/** Run one system+user completion and return the assembled text. */
export async function generateLlmText(llm: LlmStreamLike, options: GenerateTextOptions): Promise<string> {
  const messages: Array<{ role: 'system' | 'user'; content: Array<{ type: 'text'; text: string }> }> = [
    { role: 'system', content: [{ type: 'text', text: options.system }] },
    { role: 'user', content: [{ type: 'text', text: options.user }] },
  ]
  let text = ''
  let failure: string | null = null
  for await (const chunk of llm.stream({
    provider: options.provider,
    model: options.model,
    messages,
    ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    purpose: 'oac-dream',
  })) {
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      text += chunk.text
    } else if (chunk.type === 'finish' && chunk.reason) {
      if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
        failure = chunk.reason.failure?.message ?? `llm stream ${chunk.reason.kind}`
      }
    }
  }
  if (failure) {
    throw new Error(failure)
  }
  if (!text.trim()) {
    throw new Error('llm stream returned empty content')
  }
  return text
}
