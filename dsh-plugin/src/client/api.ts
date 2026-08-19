import type { MetaAppListPayload, MetaAppRecord } from '../apps.ts'

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
  isActive?: boolean
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

export type ChatSkillOption = {
  skillName: string
  title: string
  description: string
}

/** Skill catalog for one Bot plus the last resolution's skipped names. */
export type ChatSkillsPayload = {
  skills: ChatSkillOption[]
  skipped: string[]
}

export type AutoReplyConfig = {
  enabled: boolean
  maxTurns: number
  cooldownMs: number
}

/** Same option sets the OAC chat settings tab offers. */
export const AUTO_REPLY_MAX_TURNS_OPTIONS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50] as const
export const AUTO_REPLY_COOLDOWN_MS_OPTIONS = [60_000, 300_000, 600_000, 1_800_000, 3_600_000] as const
export const DEFAULT_AUTO_REPLY_MAX_TURNS = 10
export const DEFAULT_AUTO_REPLY_COOLDOWN_MS = 60_000

export type ConversationActor = {
  name?: string | null
  globalMetaId?: string
  avatar?: string | null
}

export type ConversationSummary = {
  conversationId: string
  localGlobalMetaId: string
  localName?: string | null
  localAvatar?: string | null
  peerGlobalMetaId: string
  peerName?: string | null
  peerAvatar?: string | null
  peerLlmPrimaryProvider?: string | null
  latestText: string
  latestAt: number
  messageCount: number
  kinds: string[]
  state: string
}

export type ConversationMessage = {
  messageId: string
  direction: string
  kind: string
  contentType?: string | null
  content: string
  txid?: string | null
  timestamp: number
  sender: ConversationActor
}

export type ConversationThread = {
  localBot: ConversationActor
  peerBot: ConversationActor
  messages: ConversationMessage[]
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
  chatSkills: async (from: string): Promise<ChatSkillsPayload> => {
    const data = await post<{
      skills?: Array<{ skillName?: unknown; title?: unknown; description?: unknown }>
      chatSkillResolution?: { skipped?: unknown }
    }>('chat/skills', { from })
    const skills = (data.skills ?? [])
      .map((row) => ({
        skillName: typeof row.skillName === 'string' ? row.skillName.trim() : '',
        title: typeof row.title === 'string' ? row.title : '',
        description: typeof row.description === 'string' ? row.description : '',
      }))
      .filter((row) => row.skillName !== '')
    const skippedRaw = data.chatSkillResolution?.skipped
    const skipped = Array.isArray(skippedRaw)
      ? skippedRaw.map((name) => typeof name === 'string' ? name : '').filter(Boolean)
      : []
    return { skills, skipped }
  },
  autoReplyStatus: async (from: string): Promise<AutoReplyConfig> => {
    const data = await post<{
      enabled?: unknown
      maxTurns?: unknown
      cooldownMs?: unknown
    }>('chat/auto-reply/status', { from })
    return {
      enabled: data.enabled === true,
      maxTurns: typeof data.maxTurns === 'number' ? data.maxTurns : DEFAULT_AUTO_REPLY_MAX_TURNS,
      cooldownMs: typeof data.cooldownMs === 'number' ? data.cooldownMs : DEFAULT_AUTO_REPLY_COOLDOWN_MS,
    }
  },
  autoReplyConfig: async (
    from: string,
    patch: { enabled?: boolean; maxTurns?: number; cooldownMs?: number },
  ): Promise<AutoReplyConfig> => {
    const data = await post<{
      enabled?: unknown
      maxTurns?: unknown
      cooldownMs?: unknown
    }>('chat/auto-reply/config', { from, ...patch })
    return {
      enabled: data.enabled === true,
      maxTurns: typeof data.maxTurns === 'number' ? data.maxTurns : DEFAULT_AUTO_REPLY_MAX_TURNS,
      cooldownMs: typeof data.cooldownMs === 'number' ? data.cooldownMs : DEFAULT_AUTO_REPLY_COOLDOWN_MS,
    }
  },
  /** A2A conversation summaries, sorted newest first (OAC /ui/conversations source). */
  conversations: async (from: string): Promise<ConversationSummary[]> => {
    const data = await post<{ conversations?: unknown }>('conversations/list', { from })
    const rows = Array.isArray(data.conversations) ? data.conversations : []
    return rows
      .map((row) => normalizeSummary(row))
      .filter((row) => row.peerGlobalMetaId !== '')
      .sort((left, right) => right.latestAt - left.latestAt)
  },
  conversationThread: async (from: string, peer: string): Promise<ConversationThread> => {
    const data = await post<{
      localBot?: unknown
      peerBot?: unknown
      messages?: unknown
    }>('conversations/messages', { from, peer })
    const rows = Array.isArray(data.messages) ? data.messages : []
    const messages = collapseOrderProgress(rows)
      .map((row) => normalizeMessage(row))
      .sort((left, right) => left.timestamp - right.timestamp)
    return {
      localBot: normalizeActor(data.localBot),
      peerBot: normalizeActor(data.peerBot),
      messages,
    }
  },
  conversationGuidance: async (from: string, peer: string, guidance: string): Promise<CommandEnvelope> =>
    postEnvelope('conversations/guidance', { from, peer, guidance }),
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
  metaappList: async (from: string, size = 12, cursor = ''): Promise<MetaAppListPayload> => {
    const data = await post<{ records?: unknown; nextCursor?: unknown; total?: unknown }>(
      'metaapp/list',
      { from, size, cursor },
    )
    const records = Array.isArray(data.records)
      ? data.records.map((row) => normalizeMetaAppRecord(row))
      : []
    return {
      records,
      nextCursor: typeof data.nextCursor === 'string' ? data.nextCursor.trim() : '',
      total: typeof data.total === 'number' ? data.total : records.length,
    }
  },
  metaappPublish: async (from: string, payload: Record<string, unknown>): Promise<CommandEnvelope> =>
    postEnvelope('metaapp/publish', { from, payload, confirm: true }),
  metaappUpdate: async (
    from: string,
    targetPinId: string,
    payload: Record<string, unknown>,
  ): Promise<CommandEnvelope> =>
    postEnvelope('metaapp/update', { from, targetPinId, payload, confirm: true }),
  metaappDelete: async (from: string, targetPinId: string): Promise<CommandEnvelope> =>
    postEnvelope('metaapp/delete', { from, targetPinId, confirm: true }),
  /** Raw file upload → metafile reference. The browser sends the file bytes directly. */
  metaappUpload: async (from: string, file: File): Promise<{ metafileUri?: string; pinId?: string }> => {
    const response = await fetch('/oac/api/file/upload', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: file,
    })
    const envelope = await response.json() as Envelope
    if (envelope.ok === false || envelope.state === 'failed') {
      throw new OacApiError(envelope.code ?? 'upload_failed', envelope.message ?? envelope.error ?? 'upload failed')
    }
    const data = envelope.data as { metafileUri?: unknown; pinId?: unknown }
    return {
      ...(typeof data?.metafileUri === 'string' && data.metafileUri !== '' ? { metafileUri: data.metafileUri } : {}),
      ...(typeof data?.pinId === 'string' && data.pinId !== '' ? { pinId: data.pinId } : {}),
    }
  },
  /**
   * Open the right-sidebar Bot Browser on a resource URI (or the Browser
   * home when `uri` is null/empty); resolves to the iframe `localUiUrl`.
   */
  browserOpen: async (uri?: string | null): Promise<string> => {
    const data = await post<{ localUiUrl?: unknown }>('browser/open', { uri: uri ?? '' })
    const url = typeof data.localUiUrl === 'string' ? data.localUiUrl : ''
    if (url === '') {
      throw new OacApiError('no_local_ui_url', 'OAC daemon returned no Browser URL')
    }
    return url
  },
  health: async (): Promise<{ ok: boolean; error?: string }> => {
    const response = await fetch('/oac/api/health', { credentials: 'same-origin' })
    return await response.json() as { ok: boolean; error?: string }
  },
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

/** Accept seconds or milliseconds; normalize to milliseconds. */
function toTimestampMs(value: unknown): number {
  const parsed = toNumber(value)
  if (parsed <= 0) return 0
  return parsed < 1_000_000_000_000 ? parsed * 1000 : parsed
}

function txidOf(record: Record<string, unknown>): string {
  const txids = Array.isArray(record.txids)
    ? record.txids.map((item) => textOf(item).toLowerCase()).filter((item) => /^[0-9a-f]{64}$/u.test(item))
    : []
  if (txids.length > 0) return txids[0] ?? ''
  for (const key of ['txid', 'txId']) {
    const raw = textOf(record[key]).toLowerCase()
    if (/^[0-9a-f]{64}$/u.test(raw)) return raw
  }
  for (const key of ['pinId', 'messagePinId']) {
    const raw = textOf(record[key]).toLowerCase()
    const match = raw.match(/^([0-9a-f]{64})i\d+$/u)
    if (match) return match[1] ?? ''
  }
  return ''
}

/** Short display form, e.g. `4e684131...b2a9a`. */
export function txidPreview(txid: string): string {
  return txid.length > 14 ? `${txid.slice(0, 8)}...${txid.slice(-6)}` : txid
}

/** Local-time label, e.g. `2026-08-17 14:30` (same shape as the OAC page). */
export function timestampLabel(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  const pad = (part: number): string => String(part).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + ' ' + [pad(date.getHours()), pad(date.getMinutes())].join(':')
}

function normalizeMetaAppRecord(value: unknown): MetaAppRecord {
  const record = recordOf(value)
  const stringList = (raw: unknown): string[] | undefined => {
    if (!Array.isArray(raw)) return undefined
    return raw.map((item) => textOf(item)).filter(Boolean)
  }
  const metadata = record.metadata
  return {
    pinId: textOf(record.pinId) || textOf(record.id),
    firstPinId: textOf(record.firstPinId) || undefined,
    operation: textOf(record.operation) || undefined,
    title: textOf(record.title) || undefined,
    appName: textOf(record.appName) || undefined,
    prompt: textOf(record.prompt) || undefined,
    icon: textOf(record.icon) || undefined,
    coverImg: textOf(record.coverImg) || undefined,
    introImgs: stringList(record.introImgs),
    intro: textOf(record.intro) || undefined,
    runtime: textOf(record.runtime) || undefined,
    version: textOf(record.version) || undefined,
    contentType: textOf(record.contentType) || undefined,
    content: textOf(record.content) || undefined,
    indexFile: textOf(record.indexFile) || undefined,
    code: textOf(record.code) || undefined,
    contentHash: textOf(record.contentHash) || undefined,
    codeType: textOf(record.codeType) || undefined,
    metadata: metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata as Record<string, unknown>
      : undefined,
    tags: stringList(record.tags),
    disabled: record.disabled === true,
    ownerAddress: textOf(record.ownerAddress) || undefined,
    timestamp: typeof record.timestamp === 'number' ? record.timestamp : null,
    txid: textOf(record.txid) || undefined,
    txids: stringList(record.txids),
    metaappUri: textOf(record.metaappUri) || undefined,
    metawebUrl: textOf(record.metawebUrl) || undefined,
    runUrl: textOf(record.runUrl) || undefined,
    raw: record.raw !== null && typeof record.raw === 'object' && !Array.isArray(record.raw)
      ? record.raw as Record<string, unknown>
      : undefined,
  }
}

function normalizeActor(value: unknown): ConversationActor {
  const record = recordOf(value)
  return {
    name: textOf(record.name) || textOf(record.displayName) || undefined,
    globalMetaId: textOf(record.globalMetaId) || undefined,
    avatar: textOf(record.avatar) || textOf(record.avatarDataUrl) || undefined,
  }
}

function normalizeSummary(value: unknown): ConversationSummary {
  const record = recordOf(value)
  return {
    conversationId: textOf(record.conversationId) || textOf(record.id),
    localGlobalMetaId: textOf(record.localGlobalMetaId) || textOf(record.localBotGlobalMetaId),
    localName: textOf(record.localName) || textOf(record.localBotName) || null,
    localAvatar: textOf(record.localAvatar) || textOf(record.localBotAvatar) || null,
    peerGlobalMetaId: textOf(record.peerGlobalMetaId) || textOf(record.peer),
    peerName: textOf(record.peerName) || textOf(record.peerDisplayName) || null,
    peerAvatar: textOf(record.peerAvatar) || null,
    peerLlmPrimaryProvider: textOf(record.peerLlmPrimaryProvider) || null,
    latestText: textOf(record.latestText) || textOf(record.lastMessage) || textOf(record.preview),
    latestAt: toTimestampMs(record.latestAt || record.updatedAt || record.lastMessageAt || record.createdAt),
    messageCount: Math.max(0, Math.trunc(toNumber(record.messageCount ?? record.turnCount))),
    kinds: Array.isArray(record.kinds)
      ? record.kinds.map((item) => textOf(item)).filter(Boolean)
      : [],
    state: textOf(record.state) || 'active',
  }
}

const ORDER_STATUS_TAG = /^\[ORDER_STATUS(?::([0-9a-fA-F]{64}))?\]\s*/u

function orderProgressKey(record: Record<string, unknown>): string {
  const protocolTag = textOf(record.protocolTag).toUpperCase()
  const content = textOf(record.content) || textOf(record.text) || textOf(record.body)
  const match = content.match(ORDER_STATUS_TAG)
  if (protocolTag !== 'ORDER_STATUS' && !match) return ''
  return textOf(record.orderTxid).toLowerCase() || (match?.[1] ?? '').toLowerCase() || 'order-status'
}

/** Collapse consecutive ORDER_STATUS notices per order into their latest. */
function collapseOrderProgress(rows: unknown[]): unknown[] {
  const collapsed: unknown[] = []
  for (const row of rows) {
    const record = recordOf(row)
    const key = orderProgressKey(record)
    const previousIndex = collapsed.length - 1
    if (key && previousIndex >= 0 && orderProgressKey(recordOf(collapsed[previousIndex])) === key) {
      collapsed[previousIndex] = row
      continue
    }
    collapsed.push(row)
  }
  return collapsed
}

function normalizeMessage(value: unknown): ConversationMessage {
  const record = recordOf(value)
  const rawContent = textOf(record.content) || textOf(record.text) || textOf(record.body)
  const key = orderProgressKey(record)
  const content = key ? rawContent.replace(ORDER_STATUS_TAG, '').trim() || rawContent : rawContent
  return {
    messageId: textOf(record.messageId) || textOf(record.id) || textOf(record.pinId) || textOf(record.messagePinId),
    direction: textOf(record.direction).toLowerCase(),
    kind: textOf(record.kind) || textOf(record.protocolTag) || 'private_chat',
    contentType: textOf(record.contentType) || undefined,
    content,
    txid: txidOf(record) || null,
    timestamp: toTimestampMs(record.timestamp || record.createdAt),
    sender: normalizeActor(record.sender),
  }
}
