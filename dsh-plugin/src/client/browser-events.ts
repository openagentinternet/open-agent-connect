/**
 * Browser-open wiring (client half).
 *
 * Two paths land on the same right-Sidebar `bot-browser` tab:
 *
 * - daemon-driven: `metabot browser tab open` fans out over the daemon SSE;
 *   ABC inside an already-loaded iframe opens the tab itself, so the client
 *   only reveals the tab (no iframe reload);
 * - host/UI-driven: Settings buttons and bot_browser_open_uri. If the iframe
 *   is already loaded, navigate via ABC postMessage; otherwise the tab body
 *   sets its iframe src from the navigation params.
 *
 * The reveal itself — select Conversation, then `openTab('bot-browser')`
 * with its no-mounted-surface retry — lives in `browser-open-flow.ts`.
 */
import { api } from './api.ts'
import type { BotBrowserIframeBridge } from './browser-iframe.ts'
import { decideBrowserOpenAction, type BrowserCatalogEntry, type BrowserCommandRequest, type BrowserOpenSource } from '../browser-protocol.ts'
import {
  openBotBrowser,
  type BotBrowserOpenFace,
  type BotBrowserTabParams,
} from '../browser-open-flow.ts'
import { rememberCatalog } from './browser-links.ts'

/** How the daemon-event listener reaches the right-Sidebar tab. */
export interface BrowserPanelFace {
  /** The URL the live iframe loaded (null = no live tab body). */
  liveUrl: () => string | null
  /** Reveal the bot-browser tab with these navigation params. */
  reveal: (params: BotBrowserTabParams) => Promise<void>
}

/** Subscribe to host-half browser-open + command events; returns an unsubscribe. */
export function startBrowserEventSource(
  bridge: BotBrowserIframeBridge,
  panel: BrowserPanelFace,
): () => void {
  let source: EventSource | null = null
  try {
    source = new EventSource('/oac/api/browser/events')
  } catch {
    return () => {}
  }
  const onOpen = (event: MessageEvent<string>): void => {
    try {
      const data = JSON.parse(event.data) as {
        localUiUrl?: unknown
        uri?: unknown
        source?: unknown
      }
      const url = typeof data.localUiUrl === 'string' ? data.localUiUrl : ''
      if (!url) return
      const origin: BrowserOpenSource = data.source === 'daemon' ? 'daemon' : 'host'
      const liveUrl = panel.liveUrl()
      const decision = decideBrowserOpenAction({
        source: origin,
        uri: typeof data.uri === 'string' ? data.uri : null,
        localUiUrl: url,
        hasIframeUrl: liveUrl !== null,
      })
      if (decision.kind === 'ensure-open') {
        // ABC already navigated inside the live iframe: reveal the tab on the
        // SAME url so the body never resets the iframe src.
        void panel.reveal({ url: liveUrl ?? url })
        bridge.reportNow()
        return
      }
      if (decision.kind === 'open-tab') {
        void bridge.runCommand({ requestId: 'ui-open', action: 'open-tab', uri: decision.uri })
        if (liveUrl !== null) void panel.reveal({ url: liveUrl })
        return
      }
      void panel.reveal({ url: decision.url })
      bridge.reportNow()
    } catch {
      // a malformed frame is not fatal; keep listening
    }
  }
  const onCommand = (event: MessageEvent<string>): void => {
    try {
      const command = JSON.parse(event.data) as BrowserCommandRequest
      if (!command || typeof command.requestId !== 'string' || typeof command.action !== 'string') return
      void bridge.runCommand(command).then((result) => api.browserCommandResult(result))
    } catch {
      // keep listening
    }
  }
  source.addEventListener('browser-open', onOpen)
  source.addEventListener('browser-command', onCommand)
  const onCatalog = (event: MessageEvent<string>): void => {
    try {
      const data = JSON.parse(event.data) as { apps?: BrowserCatalogEntry[] }
      if (Array.isArray(data.apps)) rememberCatalog(data.apps)
    } catch {
      // keep listening
    }
  }
  source.addEventListener('browser-catalog', onCatalog)
  return () => source?.close()
}

/**
 * Resolve a URI (or the Browser home) and reveal the right-Sidebar tab on it.
 * Resolves once the reveal finished (or the failure was reported) and never
 * rejects, so callers can hook the resolution to sync follow-up UI (e.g.
 * closing Settings) with the moment the Browser appears.
 */
export function openBrowser(face: BotBrowserOpenFace, bridge: BotBrowserIframeBridge, uri: string | null): Promise<void> {
  return openBotBrowser(face, uri, bridge.liveUrl())
}
