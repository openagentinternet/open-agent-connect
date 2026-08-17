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
  createdAt?: number
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

export type CommandEnvelope<T = unknown> = {
  ok: boolean
  state: string
  code?: string
  message?: string
  data?: T
}

async function postEnvelope<T>(method: string, body: unknown = {}): Promise<CommandEnvelope<T>> {
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
  return json as CommandEnvelope<T>
}

async function post<T>(method: string, body: unknown = {}): Promise<T> {
  const envelope = await postEnvelope<T>(method, body)
  return envelope.data as T
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
  chatConversations: async (from: string): Promise<unknown> => post('chat/conversations', { from }),
  chatMessages: async (from: string, conversationId: string): Promise<unknown> =>
    post('chat/messages', { from, conversationId }),
  chatPrivate: async (from: string, to: string, content: string): Promise<CommandEnvelope> =>
    postEnvelope('chat/private', { from, to, content }),
  servicesOwned: async (from: string): Promise<unknown> => post('services/owned/list', { from }),
  servicesOrders: async (from: string, serviceId: string): Promise<unknown> =>
    post('services/owned/orders', { from, serviceId }),
  servicesPublish: async (from: string, payload: Record<string, unknown>): Promise<CommandEnvelope> =>
    postEnvelope('services/publish', { from, payload, confirm: true }),
  servicesRevoke: async (from: string, serviceId: string): Promise<CommandEnvelope> =>
    postEnvelope('services/owned/revoke', { from, serviceId, confirm: true }),
  servicesCall: async (
    from: string,
    request: Record<string, unknown>,
    confirm = false,
  ): Promise<CommandEnvelope> =>
    postEnvelope('services/call', { from, request, confirm }),
  metaappList: async (from: string): Promise<unknown> => post('metaapp/list', { from }),
  metaappPublish: async (from: string, payload: Record<string, unknown>): Promise<CommandEnvelope> =>
    postEnvelope('metaapp/publish', { from, payload, confirm: true }),
  metaappDelete: async (from: string, targetPinId: string): Promise<CommandEnvelope> =>
    postEnvelope('metaapp/delete', { from, targetPinId, confirm: true }),
  health: async (): Promise<{ ok: boolean; error?: string }> => {
    const response = await fetch('/oac/api/health', { credentials: 'same-origin' })
    return await response.json() as { ok: boolean; error?: string }
  },
}
