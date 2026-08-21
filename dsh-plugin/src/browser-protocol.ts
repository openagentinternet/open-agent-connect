/**
 * Shared Bot Browser protocol types (host + client). No Node APIs.
 *
 * The DSH sidebar embeds the OAC Browser as a cross-origin iframe. ABC
 * already postMessages tab events to window.parent and accepts tab commands
 * from it; this file is the DSH-side envelope for snapshot + command roundtrip.
 */

export const METAAPP_PIN_ID_PATTERN = /^[0-9a-f]{64}i0$/iu

/** One ABC tab as the host/client snapshot sees it. */
export type BrowserTabInfo = {
  id: number
  uri: string | null
  title: string | null
  isActive: boolean
}

/** Last-known Bot Browser surface, posted by the DSH web client. */
export type BrowserSnapshot = {
  open: boolean
  tabs: BrowserTabInfo[]
  /** Renderer type of the active tab (e.g. html-iframe), when known. */
  rendererType?: string | null
}

/** Who initiated a sidebar open: daemon fan-out (ABC already got it) vs host/UI. */
export type BrowserOpenSource = 'daemon' | 'host'

export type BrowserCommandAction =
  | 'list'
  | 'open-tab'
  | 'close-tab'
  | 'switch-tab'
  | 'get-content'
  | 'get-tab-info'

export type BrowserCommandRequest = {
  requestId: string
  action: BrowserCommandAction
  uri?: string
  tabId?: number
}

export type BrowserTabContent = {
  tabId: number
  uri: string | null
  title: string | null
  contentType: string
  text: string
  html: string
  truncated: boolean
}

export type BrowserTabEnvelope = BrowserTabInfo & {
  current: unknown | null
}

export type BrowserCommandResult = {
  requestId: string
  ok: boolean
  error?: string
  action?: BrowserCommandAction
  tabs?: BrowserTabInfo[]
  activeTab?: BrowserTabInfo | null
  content?: BrowserTabContent | null
  info?: BrowserTabEnvelope | null
}

export type BrowserTabState = {
  tabs: BrowserTabInfo[]
  activeTabId: number | null
}

/** Accepts metaapp://<pinId> or a bare pinId; returns normalized pinId or ''. */
export function parseMetaAppPinIdFromUri(uri: string | null | undefined): string {
  const trimmed = (uri ?? '').trim()
  if (!trimmed) return ''
  const match = /^metaapp:\/\/(.+)$/iu.exec(trimmed)
  const candidate = (match ? match[1] : trimmed).replace(/\/+$/u, '').trim()
  return METAAPP_PIN_ID_PATTERN.test(candidate) ? candidate.toLowerCase() : ''
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function emptyTabState(): BrowserTabState {
  return { tabs: [], activeTabId: null }
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function upsertTab(tabs: BrowserTabInfo[], next: BrowserTabInfo): BrowserTabInfo[] {
  const index = tabs.findIndex((tab) => tab.id === next.id)
  if (index < 0) return [...tabs, next]
  const copy = tabs.slice()
  copy[index] = { ...tabs[index], ...next }
  return copy
}

function markActive(tabs: BrowserTabInfo[], activeId: number): BrowserTabInfo[] {
  return tabs.map((tab) => ({ ...tab, isActive: tab.id === activeId }))
}

/**
 * Fold one ABC `agent-browser:event` into the client-side tab list.
 * Event names match ABC's emitHostEvent payload.
 */
export function reduceBrowserTabs(
  state: BrowserTabState,
  event: string,
  payload: Record<string, unknown>,
): BrowserTabState {
  const tabId = asNumber(payload.tabId)
  if (tabId === null && event !== 'tab-closed') return state

  if (event === 'tab-closed') {
    if (tabId === null) return state
    const tabs = state.tabs.filter((tab) => tab.id !== tabId)
    const activeTabId = state.activeTabId === tabId
      ? (tabs.find((tab) => tab.isActive)?.id ?? tabs[0]?.id ?? null)
      : state.activeTabId
    return {
      tabs: activeTabId === null ? tabs : markActive(tabs, activeTabId),
      activeTabId,
    }
  }

  if (tabId === null) return state
  const uri = asString(payload.uri)
  const title = asString(payload.title)
  const existing = state.tabs.find((tab) => tab.id === tabId)

  if (event === 'tab-opened') {
    const tabs = upsertTab(state.tabs, {
      id: tabId,
      uri: uri ?? existing?.uri ?? null,
      title: title ?? existing?.title ?? null,
      isActive: existing?.isActive ?? false,
    })
    return { tabs, activeTabId: state.activeTabId }
  }

  if (event === 'tab-activated') {
    const tabs = markActive(
      upsertTab(state.tabs, {
        id: tabId,
        uri: uri ?? existing?.uri ?? null,
        title: title ?? existing?.title ?? null,
        isActive: true,
      }),
      tabId,
    )
    return { tabs, activeTabId: tabId }
  }

  if (event === 'title-updated' || event === 'navigation-committed') {
    const tabs = upsertTab(state.tabs, {
      id: tabId,
      uri: event === 'navigation-committed' ? (uri ?? existing?.uri ?? null) : (existing?.uri ?? uri),
      title: title ?? existing?.title ?? null,
      isActive: existing?.isActive ?? state.activeTabId === tabId,
    })
    return { tabs, activeTabId: state.activeTabId }
  }

  return state
}

export function activeTabOf(state: BrowserTabState): BrowserTabInfo | null {
  if (state.activeTabId === null) return state.tabs.find((tab) => tab.isActive) ?? null
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null
}

/** Fold one get-tab-info / get-content tab into the live list. */
export function applyTabInfo(state: BrowserTabState, tab: BrowserTabInfo): BrowserTabState {
  const tabs = upsertTab(state.tabs, tab)
  if (tab.isActive) {
    return { tabs: markActive(tabs, tab.id), activeTabId: tab.id }
  }
  return { tabs, activeTabId: state.activeTabId }
}

export type BrowserOpenDecision =
  | { kind: 'load'; url: string }
  | { kind: 'open-tab'; uri: string }
  | { kind: 'ensure-open' }

/**
 * How the DSH web client should apply one browser-open SSE frame.
 * Host home (empty URI) always loads `/browser` so the right sidebar opens
 * on the Bot Browser homepage. Daemon frames do not reload an existing iframe
 * (ABC already received the tab).
 */
export function decideBrowserOpenAction(input: {
  source: BrowserOpenSource
  uri: string | null
  localUiUrl: string
  hasIframeUrl: boolean
}): BrowserOpenDecision {
  const uri = (input.uri ?? '').trim()
  if (input.source === 'daemon') {
    return input.hasIframeUrl ? { kind: 'ensure-open' } : { kind: 'load', url: input.localUiUrl }
  }
  if (!uri) return { kind: 'load', url: input.localUiUrl }
  if (input.hasIframeUrl) return { kind: 'open-tab', uri }
  return { kind: 'load', url: input.localUiUrl }
}

export function formatBotBrowserTabs(tabs: readonly BrowserTabInfo[]): string {
  if (tabs.length === 0) return 'No open tabs.'
  return tabs
    .map((tab) => `${tab.isActive ? '* ' : '  '}[${tab.id}] ${tab.title || '(untitled)'} — ${tab.uri || '(no uri)'}`)
    .join('\n')
}

export type MetaAppSearchCandidate = {
  pinId: string
  title?: string
  appName?: string
  intro?: string
  publisherName?: string
  publisherGlobalMetaId?: string
  isOwn?: boolean
  tags?: string[]
  updatedAt?: number
}

/** Ready-to-quote markdown bullets: titles and authors stay links. */
export function formatMetaAppCandidates(items: readonly MetaAppSearchCandidate[]): string {
  return items.map((item) => {
    const title = item.title || item.appName || item.pinId
    const linkTitle = title.replace(/[[\]]/g, '')
    const intro = item.intro
      ? ` — ${item.intro.length > 120 ? `${item.intro.slice(0, 120)}…` : item.intro}`
      : ''
    const publisherLabel = (item.publisherName || item.publisherGlobalMetaId || 'unknown').replace(/[[\]]/g, '')
    const publisher = item.publisherGlobalMetaId
      ? `by [${publisherLabel}](metaid://${item.publisherGlobalMetaId})${item.isOwn ? ' (your MetaBot)' : ''}`
      : ''
    const tags = Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === 'string' && tag.trim()) : []
    const meta = [
      publisher,
      tags.length ? `tags: ${tags.join(', ')}` : '',
      item.updatedAt ? `updated: ${new Date(item.updatedAt * 1000).toISOString().slice(0, 10)}` : '',
    ].filter(Boolean).join(' | ')
    return `- [${linkTitle}](metaapp://${item.pinId})${intro}\n  ${meta}`
  }).join('\n')
}

export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug || 'metaapp'
}

export function readRendererFromEnvelope(current: unknown): { type?: string; url?: string } {
  if (!current || typeof current !== 'object') return {}
  const renderer = (current as { renderer?: unknown }).renderer
  if (!renderer || typeof renderer !== 'object') return {}
  const record = renderer as Record<string, unknown>
  return {
    ...(typeof record.type === 'string' ? { type: record.type } : {}),
    ...(typeof record.url === 'string' ? { url: record.url } : {}),
  }
}

function parseTab(value: unknown): BrowserTabInfo | null {
  if (!value || typeof value !== 'object') return null
  const rec = value as Record<string, unknown>
  if (typeof rec.id !== 'number' || !Number.isFinite(rec.id)) return null
  return {
    id: rec.id,
    uri: typeof rec.uri === 'string' ? rec.uri : null,
    title: typeof rec.title === 'string' ? rec.title : null,
    isActive: rec.isActive === true,
  }
}

export function parseBrowserSnapshot(value: unknown): BrowserSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const rec = value as Record<string, unknown>
  if (typeof rec.open !== 'boolean') return null
  const tabs = Array.isArray(rec.tabs)
    ? rec.tabs.map(parseTab).filter((tab): tab is BrowserTabInfo => tab !== null)
    : []
  return {
    open: rec.open,
    tabs,
    rendererType: typeof rec.rendererType === 'string' ? rec.rendererType : rec.rendererType === null ? null : undefined,
  }
}

export function parseBrowserCommandResult(value: unknown): BrowserCommandResult | null {
  if (!value || typeof value !== 'object') return null
  const rec = value as Record<string, unknown>
  if (typeof rec.requestId !== 'string' || rec.requestId.trim() === '') return null
  if (typeof rec.ok !== 'boolean') return null
  const tabs = Array.isArray(rec.tabs)
    ? rec.tabs.map(parseTab).filter((tab): tab is BrowserTabInfo => tab !== null)
    : undefined
  return {
    requestId: rec.requestId,
    ok: rec.ok,
    ...(typeof rec.error === 'string' ? { error: rec.error } : {}),
    ...(typeof rec.action === 'string' ? { action: rec.action as BrowserCommandResult['action'] } : {}),
    ...(tabs ? { tabs } : {}),
    ...(rec.activeTab === null ? { activeTab: null } : parseTab(rec.activeTab) ? { activeTab: parseTab(rec.activeTab)! } : {}),
    ...(rec.content && typeof rec.content === 'object' ? { content: rec.content as BrowserTabContent } : {}),
    ...(rec.info && typeof rec.info === 'object' ? { info: rec.info as BrowserTabEnvelope } : {}),
  }
}
