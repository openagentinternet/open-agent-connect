export type CreateBotPayload = {
  name: string
  dshLlmProvider: string
  dshLlmModel: string
  dshLlmReasoningEffort?: string
  dshLlmFallbackProvider?: string
  dshLlmFallbackModel?: string
  dshLlmFallbackReasoningEffort?: string
}

export type CreateBotValidation =
  | { ok: true; value: CreateBotPayload }
  | { ok: false; code: string; message: string }

/** Reasoning efforts the DSH adapters own (off/low/high/max); blank keeps the provider default. */
export const DSH_REASONING_EFFORTS = ['off', 'low', 'high', 'max'] as const

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readReasoningEffort(value: unknown): { ok: true; effort: string } | { ok: false } {
  const effort = readString(value)
  if (!effort) return { ok: true, effort: '' }
  return (DSH_REASONING_EFFORTS as readonly string[]).includes(effort)
    ? { ok: true, effort }
    : { ok: false }
}

/** Create requires name + primary DSH provider/model. Fallback is both-or-neither; efforts ride with their model. */
export function validateCreatePayload(payload: unknown): CreateBotValidation {
  if (!isRecord(payload)) {
    return { ok: false, code: 'bad-request', message: 'create payload must be an object' }
  }
  const name = readString(payload.name)
  const dshLlmProvider = readString(payload.dshLlmProvider)
  const dshLlmModel = readString(payload.dshLlmModel)
  const dshLlmFallbackProvider = readString(payload.dshLlmFallbackProvider)
  const dshLlmFallbackModel = readString(payload.dshLlmFallbackModel)
  if (!name) {
    return { ok: false, code: 'missing_name', message: 'Bot name is required' }
  }
  if (!dshLlmProvider || !dshLlmModel) {
    return { ok: false, code: 'missing_dsh_llm', message: 'DSH provider and model are required' }
  }
  if (Boolean(dshLlmFallbackProvider) !== Boolean(dshLlmFallbackModel)) {
    return {
      ok: false,
      code: 'invalid_dsh_llm_fallback',
      message: 'Fallback DSH provider and model must be set together',
    }
  }
  const reasoningEffort = readReasoningEffort(payload.dshLlmReasoningEffort)
  if (!reasoningEffort.ok) {
    return {
      ok: false,
      code: 'invalid_dsh_llm_reasoning_effort',
      message: `DSH reasoning effort must be one of: ${DSH_REASONING_EFFORTS.join(', ')}`,
    }
  }
  const fallbackReasoningEffort = readReasoningEffort(payload.dshLlmFallbackReasoningEffort)
  if (!fallbackReasoningEffort.ok) {
    return {
      ok: false,
      code: 'invalid_dsh_llm_reasoning_effort',
      message: `DSH fallback reasoning effort must be one of: ${DSH_REASONING_EFFORTS.join(', ')}`,
    }
  }
  if (fallbackReasoningEffort.effort && !dshLlmFallbackProvider) {
    return {
      ok: false,
      code: 'invalid_dsh_llm_fallback',
      message: 'Fallback reasoning effort requires a fallback DSH provider and model',
    }
  }
  return {
    ok: true,
    value: {
      name,
      dshLlmProvider,
      dshLlmModel,
      ...(reasoningEffort.effort ? { dshLlmReasoningEffort: reasoningEffort.effort } : {}),
      ...(dshLlmFallbackProvider
        ? {
          dshLlmFallbackProvider,
          dshLlmFallbackModel,
          ...(fallbackReasoningEffort.effort
            ? { dshLlmFallbackReasoningEffort: fallbackReasoningEffort.effort }
            : {}),
        }
        : {}),
    },
  }
}
