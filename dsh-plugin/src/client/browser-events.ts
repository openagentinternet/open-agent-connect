/**
 * Browser-open wiring (client half).
 *
 * Two paths land on the same `BotBrowserStore.open`:
 *
 * - agent-driven: the /metabot-browser skill runs `metabot browser tab open`,
 *   the OAC daemon fans the open out over its `/api/browser/events` SSE, the
 *   host half re-emits it as `/oac/api/browser/events`, and the
 *   EventSource listener here opens the right-sidebar Bot Browser on the
 *   resolved `localUiUrl`;
 * - UI-initiated: the Settings > Bots "Bot Browser" / per-card "Bot Page"
 *   buttons call `openBrowser`, which asks the host half for the `localUiUrl`
 *   and opens the sidebar directly (no SSE dependency).
 */
import { api } from './api.ts'
import type { BotBrowserStore } from './browser-store.ts'

/** Subscribe to host-half browser-open events; returns an unsubscribe function. */
export function startBrowserEventSource(store: BotBrowserStore): () => void {
  let source: EventSource | null = null
  try {
    source = new EventSource('/oac/api/browser/events')
  } catch {
    return () => {}
  }
  const onOpen = (event: MessageEvent<string>): void => {
    try {
      const data = JSON.parse(event.data) as { localUiUrl?: unknown }
      if (typeof data.localUiUrl === 'string' && data.localUiUrl !== '') {
        store.open(data.localUiUrl)
      }
    } catch {
      // a malformed frame is not fatal; keep listening
    }
  }
  source.addEventListener('browser-open', onOpen)
  return () => source?.close()
}

/** Resolve a URI (or the Browser home) and open the sidebar on it. */
export function openBrowser(store: BotBrowserStore, uri: string | null): void {
  void api.browserOpen(uri).then(
    (url) => store.open(url),
    (cause: unknown) => store.fail(cause instanceof Error ? cause.message : String(cause)),
  )
}
