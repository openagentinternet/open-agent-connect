/**
 * ABC iframe bridge (client half).
 *
 * Listens for `agent-browser:event` / command responses from the cross-origin
 * Browser iframe, keeps a live tab list, reports snapshots to the host, and
 * executes host SSE tab commands via postMessage.
 *
 * The Browser renders inside the right Sidebar's `bot-browser` tab body,
 * which unmounts and remounts as the user switches tabs — so iframes attach
 * and detach here over time. Every live iframe is tracked with the URL it
 * loaded; commands and message routing target the most recently attached
 * one (the visible tab's in practice — a remount re-attaches). Two tab
 * bodies alive at once (a split pane showing the same kind) is a tolerated
 * edge, not a supported mode: the older iframe keeps receiving nothing and
 * the snapshot follows the newer.
 */
import {
  activeTabOf,
  applyTabInfo,
  emptyTabState,
  readRendererFromEnvelope,
  reduceBrowserTabs,
  type BrowserCommandRequest,
  type BrowserCommandResult,
  type BrowserSnapshot,
  type BrowserTabContent,
  type BrowserTabEnvelope,
  type BrowserTabState,
} from '../browser-protocol.ts'
import type { BotBrowserStore } from './browser-store.ts'

const COMMAND_TIMEOUT_MS = 8_000

type Pending = {
  resolve: (result: Record<string, unknown>) => void
  reject: (error: Error) => void
  timeout: number
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export class BotBrowserIframeBridge {
  /** Every live tab-body iframe with the URL it loaded, in attach order. */
  private readonly frames = new Map<HTMLIFrameElement, string | null>()
  /** The iframe commands and message routing target: the most recently attached. */
  private active: HTMLIFrameElement | null = null
  private readonly listened = new WeakSet<HTMLIFrameElement>()
  private tabs: BrowserTabState = emptyTabState()
  private rendererType: string | null = null
  private seq = 0
  private readonly pending = new Map<string, Pending>()
  private reportTimer: number | null = null
  private stopped = false

  constructor(
    private readonly store: BotBrowserStore,
    private readonly postState: (snapshot: BrowserSnapshot) => Promise<void>,
  ) {}

  start(): () => void {
    const onMessage = (event: MessageEvent): void => this.onMessage(event)
    window.addEventListener('message', onMessage)
    this.stopped = false
    return () => {
      this.stopped = true
      window.removeEventListener('message', onMessage)
      if (this.reportTimer !== null) window.clearTimeout(this.reportTimer)
      for (const pending of this.pending.values()) {
        window.clearTimeout(pending.timeout)
        pending.reject(new Error('Bot Browser iframe bridge stopped'))
      }
      this.pending.clear()
    }
  }

  /**
   * Attach/detach a tab body's iframe. React fires the ref callback with the
   * element on mount and `null` on unmount, so detach arrives carrying only
   * the URL the body had loaded — the oldest frame with that URL is removed.
   */
  setIframe(iframe: HTMLIFrameElement | null, url: string | null = null): void {
    if (iframe !== null) {
      // Re-insert at the map's tail: the most recently attached frame is the
      // command target. A re-attach of the same element keeps its tab state.
      const known = this.frames.has(iframe)
      this.frames.delete(iframe)
      this.frames.set(iframe, url)
      this.active = iframe
      if (!this.listened.has(iframe)) {
        this.listened.add(iframe)
        iframe.addEventListener('load', () => {
          void this.hydrateFromIframe()
        })
      }
      if (!known) {
        this.tabs = emptyTabState()
        this.rendererType = null
        this.store.setActiveUri(null)
      }
      this.scheduleReport()
      return
    }
    for (const [frame, frameUrl] of this.frames) {
      if (frameUrl !== url) continue
      this.frames.delete(frame)
      if (this.active === frame) {
        this.active = [...this.frames.keys()].pop() ?? null
        this.tabs = emptyTabState()
        this.rendererType = null
        this.store.setActiveUri(null)
      }
      break
    }
    this.scheduleReport()
  }

  /** The URL the active (most recently attached) iframe loaded, or null when no tab body is live. */
  liveUrl(): string | null {
    if (this.active === null) return null
    return this.frames.get(this.active) ?? null
  }

  private onMessage(event: MessageEvent): void {
    if (this.active === null || event.source !== this.active.contentWindow) return
    const data = recordOf(event.data)
    if (!data || typeof data.type !== 'string') return
    if (data.type === 'agent-browser:event' && typeof data.event === 'string') {
      const payload = recordOf(data.payload) ?? {}
      this.tabs = reduceBrowserTabs(this.tabs, data.event, payload)
      const active = activeTabOf(this.tabs)
      this.store.setActiveUri(active?.uri ?? null)
      if (data.event === 'navigation-committed' || data.event === 'tab-activated') {
        void this.refreshRenderer(typeof payload.tabId === 'number' ? payload.tabId : undefined)
      }
      this.scheduleReport()
      return
    }
    if (data.type.endsWith(':response') && (typeof data.requestId === 'string' || typeof data.id === 'string')) {
      const requestId = typeof data.requestId === 'string' ? data.requestId : String(data.id)
      const pending = this.pending.get(requestId)
      if (!pending) return
      this.pending.delete(requestId)
      window.clearTimeout(pending.timeout)
      pending.resolve(data)
    }
  }

  private postToIframe(message: Record<string, unknown>): boolean {
    const target = this.active?.contentWindow
    if (!target) return false
    target.postMessage(message, '*')
    return true
  }

  private askIframe(
    type: string,
    extra: Record<string, unknown> = {},
    timeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    const requestId = `oac-dsh-${Date.now()}-${++this.seq}`
    if (!this.postToIframe({ type, version: 1, requestId, ...extra })) {
      return Promise.reject(new Error('Bot Browser iframe is not loaded'))
    }
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('Bot Browser did not respond in time'))
      }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timeout })
    })
  }

  private async refreshRenderer(tabId?: number, timeoutMs = COMMAND_TIMEOUT_MS): Promise<void> {
    try {
      const data = await this.askIframe(
        'agent-browser:get-tab-info',
        tabId === undefined ? {} : { tabId },
        timeoutMs,
      )
      if (data.ok === false) return
      const result = recordOf(data.result) ?? data
      this.rendererType = readRendererFromEnvelope(result.current).type ?? null
      const uri = typeof result.uri === 'string' ? result.uri : null
      if (uri) this.store.setActiveUri(uri)
      const id = typeof result.id === 'number' ? result.id : (typeof result.tabId === 'number' ? result.tabId : null)
      if (id !== null) {
        this.tabs = applyTabInfo(this.tabs, {
          id,
          uri,
          title: typeof result.title === 'string' ? result.title : null,
          isActive: result.isActive !== false,
        })
      }
    } catch {
      // renderer refresh is best-effort
    }
    this.scheduleReport()
  }

  private async hydrateFromIframe(): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (this.stopped || this.active === null) return
      try {
        await this.refreshRenderer(undefined, 500)
        if (this.tabs.tabs.length > 0) return
      } catch {
        // ABC may still be booting
      }
      await new Promise((resolve) => window.setTimeout(resolve, 200))
    }
  }

  private snapshot(): BrowserSnapshot {
    return {
      // "Open" means a bot-browser tab body is live right now; the host reads
      // this as the <browser_context> sidebar-closed signal.
      open: this.active !== null,
      tabs: this.tabs.tabs,
      rendererType: this.rendererType,
    }
  }

  private scheduleReport(): void {
    if (this.stopped) return
    if (this.reportTimer !== null) window.clearTimeout(this.reportTimer)
    this.reportTimer = window.setTimeout(() => {
      this.reportTimer = null
      void this.postState(this.snapshot()).catch(() => undefined)
    }, 80)
  }

  reportNow(): void {
    this.scheduleReport()
  }

  async runCommand(command: BrowserCommandRequest): Promise<BrowserCommandResult> {
    try {
      if (command.action === 'list') {
        return {
          requestId: command.requestId,
          ok: true,
          action: 'list',
          tabs: this.tabs.tabs,
          activeTab: activeTabOf(this.tabs),
        }
      }
      if (command.action === 'open-tab') {
        const uri = command.uri?.trim()
        if (!uri) {
          return { requestId: command.requestId, ok: false, error: 'open-tab requires a uri' }
        }
        if (!this.postToIframe({ type: 'agent-browser:open-tab', uri })) {
          return { requestId: command.requestId, ok: false, error: 'Bot Browser iframe is not loaded' }
        }
        await new Promise((resolve) => window.setTimeout(resolve, 50))
        return {
          requestId: command.requestId,
          ok: true,
          action: 'open-tab',
          tabs: this.tabs.tabs,
          activeTab: activeTabOf(this.tabs),
        }
      }
      if (command.action === 'close-tab' || command.action === 'switch-tab') {
        if (typeof command.tabId !== 'number') {
          return { requestId: command.requestId, ok: false, error: `${command.action} requires tabId` }
        }
        const type = command.action === 'close-tab' ? 'agent-browser:close-tab' : 'agent-browser:switch-tab'
        if (!this.postToIframe({ type, id: command.tabId })) {
          return { requestId: command.requestId, ok: false, error: 'Bot Browser iframe is not loaded' }
        }
        await new Promise((resolve) => window.setTimeout(resolve, 50))
        return {
          requestId: command.requestId,
          ok: true,
          action: command.action,
          tabs: this.tabs.tabs,
          activeTab: activeTabOf(this.tabs),
        }
      }
      if (command.action === 'get-content' || command.action === 'get-tab-info') {
        const type = command.action === 'get-content' ? 'agent-browser:get-content' : 'agent-browser:get-tab-info'
        const extra = command.tabId === undefined ? {} : { tabId: command.tabId }
        const data = await this.askIframe(type, extra)
        if (data.ok === false) {
          const error = recordOf(data.error)
          return {
            requestId: command.requestId,
            ok: false,
            error: typeof error?.message === 'string' ? error.message : 'tab not found',
          }
        }
        const result = recordOf(data.result) ?? data
        if (command.action === 'get-content') {
          const content: BrowserTabContent = {
            tabId: typeof result.tabId === 'number' ? result.tabId : command.tabId ?? 0,
            uri: typeof result.uri === 'string' ? result.uri : null,
            title: typeof result.title === 'string' ? result.title : null,
            contentType: typeof result.contentType === 'string' ? result.contentType : 'text/html',
            text: typeof result.text === 'string' ? result.text : '',
            html: typeof result.html === 'string' ? result.html : '',
            truncated: result.truncated === true,
          }
          this.rendererType = readRendererFromEnvelope(result.current).type ?? this.rendererType
          if (content.uri || typeof result.id === 'number' || typeof result.tabId === 'number') {
            this.tabs = applyTabInfo(this.tabs, {
              id: content.tabId,
              uri: content.uri,
              title: content.title,
              isActive: true,
            })
            if (content.uri) this.store.setActiveUri(content.uri)
            this.scheduleReport()
          }
          return {
            requestId: command.requestId,
            ok: true,
            action: 'get-content',
            tabs: this.tabs.tabs,
            activeTab: activeTabOf(this.tabs),
            content,
          }
        }
        const info: BrowserTabEnvelope = {
          id: typeof result.id === 'number' ? result.id : command.tabId ?? 0,
          uri: typeof result.uri === 'string' ? result.uri : null,
          title: typeof result.title === 'string' ? result.title : null,
          isActive: result.isActive !== false,
          current: result.current ?? null,
        }
        this.rendererType = readRendererFromEnvelope(info.current).type ?? this.rendererType
        this.tabs = applyTabInfo(this.tabs, {
          id: info.id,
          uri: info.uri,
          title: info.title,
          isActive: info.isActive,
        })
        if (info.uri) this.store.setActiveUri(info.uri)
        this.scheduleReport()
        return {
          requestId: command.requestId,
          ok: true,
          action: 'get-tab-info',
          tabs: this.tabs.tabs,
          activeTab: activeTabOf(this.tabs),
          info,
        }
      }
      return { requestId: command.requestId, ok: false, error: `unsupported action ${command.action}` }
    } catch (error) {
      return {
        requestId: command.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

}
