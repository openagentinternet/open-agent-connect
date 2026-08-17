export class OacApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'OacApiError'
  }
}

export type BotRow = {
  name: string
  slug: string
  globalMetaId?: string
  mvcAddress?: string
  role?: string
  soul?: string
  goal?: string
  bio?: string
  avatarDataUrl?: string
  allowChatSkills?: string[]
  dshLlmProvider?: string | null
  dshLlmModel?: string | null
  dshLlmFallbackProvider?: string | null
  dshLlmFallbackModel?: string | null
}

export type LlmDirectory = {
  providers: Array<{ id: string; name: string }>
  modelsByProvider: Record<string, Array<{ id: string; name: string }>>
}

type Envelope = {
  ok?: boolean
  state?: string
  code?: string
  message?: string
  data?: unknown
  error?: string
}

async function post<T>(method: string, body: unknown = {}): Promise<T> {
  const response = await fetch(`/oac/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })
  const json = await response.json() as Envelope
  if (json.ok === false || json.state === 'failed') {
    throw new OacApiError(json.code ?? 'failed', json.message ?? json.error ?? 'request failed')
  }
  return json.data as T
}

function profilesOf(data: unknown): BotRow[] {
  if (data && typeof data === 'object' && Array.isArray((data as { profiles?: unknown }).profiles)) {
    return (data as { profiles: BotRow[] }).profiles
  }
  return []
}

function profileOf(data: unknown): BotRow {
  if (data && typeof data === 'object' && 'profile' in data) {
    return (data as { profile: BotRow }).profile
  }
  return data as BotRow
}

export const api = {
  list: async (): Promise<BotRow[]> => profilesOf(await post('bots/list')),
  show: async (slug: string): Promise<BotRow> => profileOf(await post('bots/show', { slug })),
  create: async (input: {
    name: string
    dshLlmProvider: string
    dshLlmModel: string
    dshLlmFallbackProvider?: string
    dshLlmFallbackModel?: string
  }): Promise<BotRow> => profileOf(await post('bots/create', input)),
  update: async (slug: string, patch: Record<string, unknown>): Promise<BotRow> =>
    profileOf(await post('bots/update', { slug, patch })),
  remove: async (slug: string): Promise<void> => {
    await post('bots/delete', { slug })
  },
  llmDirectory: async (): Promise<LlmDirectory> => post('llm/directory'),
  health: async (): Promise<{ ok: boolean; error?: string }> => {
    const response = await fetch('/oac/api/health', { credentials: 'same-origin' })
    return await response.json() as { ok: boolean; error?: string }
  },
}
