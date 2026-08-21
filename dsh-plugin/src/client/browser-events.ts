/**
 * Browser-open wiring (client half).
 *
 * Two paths land on the same sidebar:
 *
 * - daemon-driven: `metabot browser tab open` fans out over the daemon SSE;
 *   ABC inside an already-loaded iframe opens the tab itself, so the client
 *   only ensures the sidebar is visible (no iframe reload);
 * - host/UI-driven: Settings buttons and bot_browser_open_uri. If the iframe
 *   is already loaded, navigate via ABC postMessage; otherwise set iframe src.
 */
import { api } from './api.ts'
import type { BotBrowserIframeBridge } from './browser-iframe.ts'
import type { BotBrowserStore } from './browser-store.ts'
import type { BrowserCommandRequest, BrowserOpenSource } from '../browser-protocol.ts'

/** Subscribe to host-half browser-open + command events; returns an unsubscribe. */
export function startBrowserEventSource(
  store: BotBrowserStore,
  iframe: BotBrowserIframeBridge,
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
      const snap = store.getSnapshot()
      if (origin === 'daemon') {
        if (snap.url) store.ensureOpen()
        else store.open(url)
        iframe.reportNow()
        return
      }
      if (snap.open && snap.url) {
        const uri = typeof data.uri === 'string' ? data.uri.trim() : ''
        if (uri) {
          void iframe.runCommand({ requestId: 'ui-open', action: 'open-tab', uri })
        }
        store.ensureOpen()
        return
      }
      store.open(url)
    } catch {
      // a malformed frame is not fatal; keep listening
    }
  }
  const onCommand = (event: MessageEvent<string>): void => {
    try {
      const command = JSON.parse(event.data) as BrowserCommandRequest
      if (!command || typeof command.requestId !== 'string' || typeof command.action !== 'string') return
      void iframe.runCommand(command).then((result) => api.browserCommandResult(result))
    } catch {
      // keep listening
    }
  }
  source.addEventListener('browser-open', onOpen)
  source.addEventListener('browser-command', onCommand)
  return () => source?.close()
}

/** Resolve a URI (or the Browser home) and open the sidebar on it. */
export function openBrowser(store: BotBrowserStore, uri: string | null): void {
  const snap = store.getSnapshot()
  if (snap.open && snap.url && uri) {
    void api.browserOpen(uri).catch((cause: unknown) => {
      store.fail(cause instanceof Error ? cause.message : String(cause))
    })
    return
  }
  void api.browserOpen(uri).then(
    (url) => store.open(url),
    (cause: unknown) => store.fail(cause instanceof Error ? cause.message : String(cause)),
  )
}
