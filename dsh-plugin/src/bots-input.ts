export type CreateBotPayload = {
  name: string
  dshLlmProvider: string
  dshLlmModel: string
  dshLlmFallbackProvider?: string
  dshLlmFallbackModel?: string
}

export type CreateBotValidation =
  | { ok: true; value: CreateBotPayload }
  | { ok: false; code: string; message: string }

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Create requires name + primary DSH provider/model. Fallback is both-or-neither. */
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
  return {
    ok: true,
    value: {
      name,
      dshLlmProvider,
      dshLlmModel,
      ...(dshLlmFallbackProvider ? { dshLlmFallbackProvider, dshLlmFallbackModel } : {}),
    },
  }
}
