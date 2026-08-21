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
  botType?: 'twin' | 'worker' | null
  ownerGlobalMetaId?: string | null
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

export type MemoryEntryRow = {
  id: string
  text: string
  confidence: number
  isExplicit: boolean
  status: 'created' | 'stale' | 'deleted'
  scopeKind: string
  scopeKey: string
  usageClass: string
  visibility: string
  origin: string
  updatedAt: number
}

export type MemoryEntriesPayload = {
  entries: MemoryEntryRow[]
}

export type MemoryPolicyPayload = {
  effective: {
    memoryEnabled: boolean
    memoryImplicitUpdateEnabled: boolean
    memoryLlmJudgeEnabled: boolean
    memoryGuardLevel: 'strict' | 'standard' | 'relaxed'
    memoryUserMemoriesMaxItems: number
    memoryPromptMaxChars: number
    dreamEnabled: boolean
    source: string
  }
  override: Record<string, unknown>
}

export type KnowledgeRow = {
  id: string
  topic: string
  summary: string
  kind: 'know_how' | 'pitfall' | 'principle'
  category?: string | null
  status: string
  origin: string
  version: number
  updatedAt: number
}

export type ImpressionSnapshotRow = {
  subjectGlobalMetaId: string
  summaryText: string
  styleDescriptors: string[]
  cooperationContext?: string | null
  relationshipTemperature?: string | null
  communicationGuidance?: string | null
  uncertaintyText?: string | null
  interactionCount: number
  directInteractionCount: number
  updatedAt: number
}

export type ImpressionObservationRow = {
  id: string
  observationText: string
  interpretationText: string
  dreamDate: string
  status: string
  createdAt: number
}

export type DreamSummaryRow = {
  summaryDate: string
  summaryText: string
  sections: Record<string, string>
  stats: Record<string, number>
  sessionRefs: Array<{ sessionId: string; title: string }>
}

export type DreamRunRow = {
  dreamDate: string
  status: string
  attemptCount: number
  error?: string | null
  startedAt: number
  completedAt?: number | null
}

export type OwnerIdentityRow = {
  name: string
  path?: string
  publicKey?: string
  chatPublicKey?: string
  mvcAddress?: string
  metaId?: string
  globalMetaId?: string
  createdAt?: string
  updatedAt?: string
}

export type OwnerWhoPayload = {
  identity: OwnerIdentityRow | null
}

export type OwnerWritePayload = {
  identity: OwnerIdentityRow
  /** Returned once on create/import so the UI can drive the backup view. */
  mnemonic?: string
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

export type GroupTaskStatus = 'planning' | 'executing' | 'review' | 'done' | 'cancelled'
export type GroupTaskListTab = 'active' | 'done' | 'cancelled' | 'all'

export type GroupTaskMemberPreview = {
  name: string
  avatar: string | null
  role: 'chair' | 'worker'
  slug: string | null
  remote: boolean
}

export type GroupTaskSummaryRow = {
  id: number
  chairSlug: string
  groupId: string | null
  title: string
  displayName: string | null
  goal: string
  status: GroupTaskStatus
  pinned: boolean
  archivedAt: number | null
  openTeam: boolean
  memberCount: number
  chairName: string | null
  members: GroupTaskMemberPreview[]
  rating: number | null
  createdAt: number
  updatedAt: number
}

export type GroupTaskMemberRow = {
  id: number
  slug: string | null
  globalMetaId: string | null
  role: 'chair' | 'worker'
  status: string
  displayName: string | null
  avatar: string | null
  removedAt: number | null
  lastSpeakAt: number | null
  workStatus: 'working' | 'idle' | 'timeout' | 'error' | 'unknown'
  inviteStatus: string
}

export type GroupTaskDeliverableRow = {
  id: number
  kind: string | null
  uri: string | null
  status: string
  msgPinId: string | null
  createdAt: number
}

export type GroupTaskMessageRow = {
  index: number
  pinId: string | null
  senderGlobalMetaId: string | null
  senderName: string | null
  senderAvatar: string | null
  content: string
  contentType: string | null
  /** Epoch ms (normalized from the chain's epoch-second field). */
  timestamp: number
  senderSuspect: boolean
}

export type GroupTaskDetailPayload = {
  id: number
  chairSlug: string
  groupId: string | null
  title: string
  displayName: string | null
  goal: string
  acceptanceCriteria: string | null
  status: GroupTaskStatus
  pinned: boolean
  archivedAt: number | null
  openTeam: boolean
  stall: boolean
  rating: number | null
  ratingComment: string | null
  createdAt: number
  updatedAt: number
  closedAt: number | null
  members: GroupTaskMemberRow[]
  deliverables: GroupTaskDeliverableRow[]
  messages: GroupTaskMessageRow[]
  openCheckpointSummary: string | null
}

/** Guest-side OpenTeam membership (a local Bot joined someone else's task). */
export type OpenTeamCollabRow = {
  groupId: string
  slug: string
  botName: string
  inviterGlobalMetaId: string
  inviterName: string | null
  taskTitle: string
  goalSummary: string | null
  status: 'active' | 'left'
  activatedAt: number | null
  leftAt: number | null
  leftCause: string | null
}

export type OpenTeamGuestInviteRow = {
  groupId: string
  inviteId: string
  slug: string
  botName: string
  inviterName: string | null
  taskTitle: string
  goalSummary: string | null
  requiredSkills: string[]
  status: 'invited' | 'accepted' | 'declined' | 'skipped' | 'expired'
  declineReason: string | null
  createdAt: number
}

export type OpenTeamCollabsPayload = {
  memberships: OpenTeamCollabRow[]
  guestInvites: OpenTeamGuestInviteRow[]
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
  /** Memory panel surface (all scoped to one Bot via `from`). */
  memoryList: async (from: string, options: Record<string, unknown> = {}): Promise<MemoryEntriesPayload> =>
    post('memory/list', { from, ...options }),
  memoryAdd: async (from: string, entry: Record<string, unknown>): Promise<unknown> =>
    post('memory/add', { from, ...entry }),
  memoryUpdate: async (from: string, entry: Record<string, unknown>): Promise<unknown> =>
    post('memory/update', { from, ...entry }),
  memoryDelete: async (from: string, id: string): Promise<unknown> =>
    post('memory/delete', { from, id }),
  memoryStats: async (from: string): Promise<{ stats?: { total: number; created: number; stale: number } }> =>
    post('memory/stats', { from }),
  memoryPolicyGet: async (from: string): Promise<MemoryPolicyPayload> => post('memory/policy/get', { from }),
  memoryPolicySet: async (from: string, patch: Record<string, unknown>): Promise<unknown> =>
    post('memory/policy/set', { from, patch }),
  memoryPolicyDelete: async (from: string): Promise<unknown> => post('memory/policy/delete', { from }),
  knowledgeList: async (from: string, options: Record<string, unknown> = {}): Promise<{ entries?: KnowledgeRow[] }> =>
    post('memory/knowledge/list', { from, ...options }),
  knowledgeUpsert: async (from: string, entry: Record<string, unknown>): Promise<unknown> =>
    post('memory/knowledge/upsert', { from, ...entry }),
  knowledgeUpdate: async (from: string, entry: Record<string, unknown>): Promise<unknown> =>
    post('memory/knowledge/update', { from, ...entry }),
  knowledgeArchive: async (from: string, id: string): Promise<unknown> =>
    post('memory/knowledge/archive', { from, id }),
  knowledgeDelete: async (from: string, id: string): Promise<unknown> =>
    post('memory/knowledge/delete', { from, id }),
  impressionsList: async (from: string): Promise<{ snapshots?: ImpressionSnapshotRow[] }> =>
    post('memory/impressions/list', { from }),
  impressionsShow: async (
    from: string,
    subject: string,
  ): Promise<{ snapshot?: ImpressionSnapshotRow | null; observations?: ImpressionObservationRow[] }> =>
    post('memory/impressions/show', { from, subject }),
  dreamStatus: async (from: string): Promise<{ runs?: DreamRunRow[] }> => post('dream/status', { from }),
  dreamSummaries: async (from: string, limit = 30): Promise<{ summaries?: DreamSummaryRow[] }> =>
    post('dream/summaries', { from, limit }),
  dreamSelfIdentity: async (from: string): Promise<{ text?: string }> =>
    post('dream/self-identity', { from }),
  dreamRun: async (from: string, date: string): Promise<unknown> => post('dream/run', { from, date }),
  twinCurrent: async (): Promise<{ twinSlug?: string | null }> => post('twin/current'),
  userWho: async (): Promise<OwnerWhoPayload> => post('user/who'),
  userCreate: async (name: string): Promise<OwnerWritePayload> => post('user/create', { name }),
  userImport: async (input: { name: string; mnemonic: string; path?: string }): Promise<OwnerWritePayload> =>
    post('user/import', input),
  userRename: async (name: string): Promise<OwnerWhoPayload> => post('user/rename', { name }),
  userReveal: async (): Promise<{ mnemonic: string }> => post('user/reveal'),
  userDelete: async (): Promise<{ deleted?: boolean }> => post('user/delete'),
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
  /** Group task surface (chair-addressed; the daemon owns the store). */
  grouptaskList: async (tab: GroupTaskListTab = 'all', includeArchived = false): Promise<GroupTaskSummaryRow[]> => {
    const data = await post<{ tasks?: unknown }>('grouptask/list', { tab, includeArchived })
    const rows = Array.isArray(data.tasks) ? data.tasks : []
    return rows.map((row) => normalizeGroupTaskSummary(row))
  },
  grouptaskDetail: async (chair: string, taskId: number): Promise<GroupTaskDetailPayload> =>
    normalizeGroupTaskDetail(await post('grouptask/detail', { chair, taskId })),
  grouptaskCreate: async (input: {
    title: string
    goal: string
    acceptanceCriteria?: string
    workerSlugs?: string[]
    chairSlug?: string
  }): Promise<{ chairSlug: string; taskId: number }> => {
    const data = await post<{ chairSlug?: unknown; task?: unknown }>('grouptask/create', input)
    const task = recordOf(data.task)
    return {
      chairSlug: textOf(data.chairSlug),
      taskId: Math.trunc(toNumber(task.id)),
    }
  },
  grouptaskPost: async (
    chair: string,
    taskId: number,
    input: { content: string; asSlug?: string; asOwner?: boolean },
  ): Promise<CommandEnvelope> => postEnvelope('grouptask/post', { chair, taskId, ...input }),
  grouptaskClose: async (
    chair: string,
    taskId: number,
    input: { outcome: 'done' | 'cancelled'; rating?: number; ratingComment?: string; reason?: string },
  ): Promise<CommandEnvelope> => postEnvelope('grouptask/close', { chair, taskId, ...input }),
  grouptaskReopen: async (chair: string, taskId: number, reason?: string): Promise<CommandEnvelope> =>
    postEnvelope('grouptask/reopen', { chair, taskId, ...(reason ? { reason } : {}) }),
  grouptaskKick: async (
    chair: string,
    taskId: number,
    member: { slug?: string; globalMetaId?: string },
    reason?: string,
  ): Promise<CommandEnvelope> =>
    postEnvelope('grouptask/kick', { chair, taskId, ...member, ...(reason ? { reason } : {}) }),
  grouptaskRename: async (chair: string, taskId: number, displayName: string): Promise<CommandEnvelope> =>
    postEnvelope('grouptask/rename', { chair, taskId, displayName }),
  grouptaskPin: async (chair: string, taskId: number, pinned: boolean): Promise<CommandEnvelope> =>
    postEnvelope('grouptask/pin', { chair, taskId, pinned }),
  grouptaskArchive: async (chair: string, taskId: number, archived: boolean): Promise<CommandEnvelope> =>
    postEnvelope('grouptask/archive', { chair, taskId, archived }),
  grouptaskInvite: async (
    chair: string,
    taskId: number,
    input: { globalMetaId: string; name?: string; requiredSkills?: string[]; allowReinvite?: boolean },
  ): Promise<CommandEnvelope> => postEnvelope('grouptask/invite', { chair, taskId, ...input }),
  grouptaskCollabs: async (): Promise<OpenTeamCollabsPayload> => {
    const data = await post<{ memberships?: unknown; guestInvites?: unknown }>('grouptask/collabs', {})
    const memberships = Array.isArray(data.memberships) ? data.memberships : []
    const guestInvites = Array.isArray(data.guestInvites) ? data.guestInvites : []
    return {
      memberships: memberships.map((row) => normalizeOpenTeamCollab(row)),
      guestInvites: guestInvites.map((row) => normalizeOpenTeamGuestInvite(row)),
    }
  },
  grouptaskCollabMessages: async (
    slug: string,
    groupId: string,
    limit = 100,
  ): Promise<{ collab: OpenTeamCollabRow; messages: GroupTaskMessageRow[] }> => {
    const data = await post<{ membership?: unknown; messages?: unknown }>(
      'grouptask/collab-messages',
      { slug, groupId, limit },
    )
    const rows = Array.isArray(data.messages) ? data.messages : []
    return {
      collab: normalizeOpenTeamCollab(data.membership),
      messages: rows.map((row) => normalizeGroupTaskMessage(row)),
    }
  },
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

const GROUP_TASK_STATUSES: GroupTaskStatus[] = ['planning', 'executing', 'review', 'done', 'cancelled']

function statusOf(value: unknown): GroupTaskStatus {
  const text = textOf(value) as GroupTaskStatus
  return GROUP_TASK_STATUSES.includes(text) ? text : 'planning'
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null
  const parsed = toNumber(value)
  return parsed > 0 ? parsed : null
}

function normalizeGroupTaskMemberPreview(value: unknown): GroupTaskMemberPreview {
  const record = recordOf(value)
  return {
    name: textOf(record.name),
    avatar: textOf(record.avatar) || null,
    role: textOf(record.role) === 'chair' ? 'chair' : 'worker',
    slug: textOf(record.slug) || null,
    remote: record.remote === true || record.slug == null,
  }
}

function normalizeGroupTaskSummary(value: unknown): GroupTaskSummaryRow {
  const record = recordOf(value)
  return {
    id: Math.trunc(toNumber(record.id)),
    chairSlug: textOf(record.chairSlug),
    groupId: textOf(record.groupId) || null,
    title: textOf(record.title),
    displayName: textOf(record.displayName) || null,
    goal: textOf(record.goal),
    status: statusOf(record.status),
    pinned: record.pinned === true,
    archivedAt: nullableNumber(record.archivedAt),
    openTeam: record.openTeam === true,
    memberCount: Math.max(0, Math.trunc(toNumber(record.memberCount))),
    chairName: textOf(record.chairName) || null,
    members: Array.isArray(record.members) ? record.members.map(normalizeGroupTaskMemberPreview) : [],
    rating: nullableNumber(record.rating),
    createdAt: toNumber(record.createdAt),
    updatedAt: toNumber(record.updatedAt),
  }
}

function normalizeGroupTaskMember(value: unknown): GroupTaskMemberRow {
  const record = recordOf(value)
  const work = textOf(record.workStatus)
  return {
    id: Math.trunc(toNumber(record.id)),
    slug: textOf(record.slug) || null,
    globalMetaId: textOf(record.globalMetaId) || null,
    role: textOf(record.role) === 'chair' ? 'chair' : 'worker',
    status: textOf(record.status) || 'assigned',
    displayName: textOf(record.displayName) || null,
    avatar: textOf(record.avatar) || null,
    removedAt: nullableNumber(record.removedAt),
    lastSpeakAt: nullableNumber(record.lastSpeakAt),
    workStatus: work === 'working' || work === 'idle' || work === 'timeout' || work === 'error' ? work : 'unknown',
    inviteStatus: textOf(record.inviteStatus) || 'none',
  }
}

function normalizeGroupTaskMessage(value: unknown): GroupTaskMessageRow {
  const record = recordOf(value)
  return {
    index: Math.trunc(toNumber(record.index)),
    pinId: textOf(record.pinId) || null,
    senderGlobalMetaId: textOf(record.senderGlobalMetaId) || null,
    senderName: textOf(record.senderName) || null,
    senderAvatar: textOf(record.senderAvatar) || null,
    content: typeof record.content === 'string' ? record.content : '',
    contentType: textOf(record.contentType) || null,
    timestamp: toTimestampMs(record.chainTimestamp ?? record.timestamp),
    senderSuspect: record.senderSuspect === true,
  }
}

function normalizeOpenTeamCollab(value: unknown): OpenTeamCollabRow {
  const record = recordOf(value)
  return {
    groupId: textOf(record.groupId),
    slug: textOf(record.slug),
    botName: textOf(record.botName) || textOf(record.slug),
    inviterGlobalMetaId: textOf(record.inviterGlobalMetaId),
    inviterName: textOf(record.inviterName) || null,
    taskTitle: textOf(record.taskTitle),
    goalSummary: textOf(record.goalSummary) || null,
    status: textOf(record.status) === 'left' ? 'left' : 'active',
    activatedAt: record.activatedAt == null ? null : toNumber(record.activatedAt),
    leftAt: record.leftAt == null ? null : toNumber(record.leftAt),
    leftCause: textOf(record.leftCause) || null,
  }
}

function normalizeOpenTeamGuestInvite(value: unknown): OpenTeamGuestInviteRow {
  const record = recordOf(value)
  const status = textOf(record.status)
  return {
    groupId: textOf(record.groupId),
    inviteId: textOf(record.inviteId),
    slug: textOf(record.slug),
    botName: textOf(record.botName) || textOf(record.slug),
    inviterName: textOf(record.inviterName) || null,
    taskTitle: textOf(record.taskTitle),
    goalSummary: textOf(record.goalSummary) || null,
    requiredSkills: Array.isArray(record.requiredSkills)
      ? record.requiredSkills.filter((entry): entry is string => typeof entry === 'string')
      : [],
    status: status === 'accepted' || status === 'declined' || status === 'skipped' || status === 'expired'
      ? status
      : 'invited',
    declineReason: textOf(record.declineReason) || null,
    createdAt: toNumber(record.createdAt),
  }
}

function normalizeGroupTaskDetail(value: unknown): GroupTaskDetailPayload {
  const record = recordOf(value)
  return {
    id: Math.trunc(toNumber(record.id)),
    chairSlug: textOf(record.chairSlug),
    groupId: textOf(record.groupId) || null,
    title: textOf(record.title),
    displayName: textOf(record.displayName) || null,
    goal: textOf(record.goal),
    acceptanceCriteria: textOf(record.acceptanceCriteria) || null,
    status: statusOf(record.status),
    pinned: record.pinned === true,
    archivedAt: nullableNumber(record.archivedAt),
    openTeam: record.openTeam === true,
    stall: record.stall === true,
    rating: nullableNumber(record.rating),
    ratingComment: textOf(record.ratingComment) || null,
    createdAt: toNumber(record.createdAt),
    updatedAt: toNumber(record.updatedAt),
    closedAt: nullableNumber(record.closedAt),
    members: Array.isArray(record.members)
      ? record.members.map(normalizeGroupTaskMember).filter((member) => member.removedAt == null)
      : [],
    deliverables: Array.isArray(record.deliverables)
      ? record.deliverables.map((row) => {
        const entry = recordOf(row)
        return {
          id: Math.trunc(toNumber(entry.id)),
          kind: textOf(entry.kind) || null,
          uri: textOf(entry.uri) || null,
          status: textOf(entry.status) || 'pending',
          msgPinId: textOf(entry.msgPinId) || null,
          createdAt: toNumber(entry.createdAt),
        }
      })
      : [],
    messages: Array.isArray(record.messages) ? record.messages.map(normalizeGroupTaskMessage) : [],
    openCheckpointSummary: textOf(record.openCheckpointSummary) || null,
  }
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
