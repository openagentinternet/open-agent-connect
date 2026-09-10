/**
 * Bot Browser right-sidebar open flow (shared, DOM-free).
 *
 * The Bot Browser lives in the official right Sidebar as one page tab kind
 * (`bot-browser`): the client registers the type into `ctx.sidebarRightTabs`
 * and a keyed `sidebar.right.pane.tab` body, and every entry point (Settings
 * buttons, avatar clicks, daemon SSE) reveals it through
 * `ctx.sidebarRight.openTab`. This module carries the pieces both the client
 * wiring and the node tests drive: the kind/id constants, the navigation
 * params the body reads, the same-URL no-reload decision, and the
 * selectConversation → openTab reveal with its no-mounted-surface retry.
 */

/** The page tab kind `openTab` names. */
export const BOT_BROWSER_TAB_KIND = 'bot-browser'

/**
 * The tab type implementation's identity: unique across every registration,
 * and the key the body and title register under in `sidebar.right.pane.tab*`.
 */
export const BOT_BROWSER_TAB_ID = 'open-agent-connect-dsh/bot-browser'

/** Navigation params handed to `openTab('bot-browser', { params })`. */
export type BotBrowserTabParams = {
  /** The daemon `localUiUrl` the tab's iframe should load. */
  url?: string
  /** The resource URI `url` resolved from (kept for the body/title). */
  uri?: string
}

/**
 * The tab body's iframe-src decision on every navigation to its tab. A fresh
 * URL replaces the src; the SAME URL with a bumped `navigation.revision` must
 * not — the host/daemon already navigated ABC inside the live iframe via the
 * SSE fan-out, and resetting the src would reload it and drop ABC's tab
 * state. A navigation without a URL (e.g. the guide page revealing the tab)
 * never disturbs what is loaded.
 */
export function shouldResetIframeSrc(paramsUrl: string | null, loadedUrl: string | null): boolean {
  return paramsUrl !== null && paramsUrl !== loadedUrl
}

/**
 * openTab-retry delays: `ctx.sidebarRight.openTab` throws while no Session
 * surface is mounted (e.g. right after `selectPanel(null)` flips back from a
 * global main panel, before the right-Sidebar seat remounts). Three short
 * attempts cover the remount frame; a permanent failure (no Session at all)
 * is surfaced by the caller.
 */
export const OPEN_TAB_RETRY_DELAYS_MS = [0, 50, 150] as const

/** The services the reveal needs, bound by the client apply closure. */
export type BotBrowserOpenFace = {
  /** Resolve a resource URI (or the Browser home when null) to its `localUiUrl`. */
  browserOpen: (uri: string | null) => Promise<string>
  /** Return the main column to the Conversation so the right-Sidebar seat mounts. */
  selectConversation: () => void
  /** `ctx.sidebarRight.openTab` bound to the bot-browser kind. */
  openTab: (params: BotBrowserTabParams) => void
  /** Surface an open failure (store landing copy + log). */
  reportError: (message: string) => void
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Reveal the Bot Browser tab, creating it on `params` when absent. Always
 * returns the main column to the Conversation first (the right Sidebar's
 * Session seat is unmounted while a global main panel is selected), then
 * retries openTab through the seat-remount window. Never rejects: a failure
 * after the last retry lands in `reportError`.
 */
export async function revealBotBrowserTab(
  face: BotBrowserOpenFace,
  params: BotBrowserTabParams,
  delays: readonly number[] = OPEN_TAB_RETRY_DELAYS_MS,
): Promise<void> {
  try {
    face.selectConversation()
  } catch {
    // A layout-face hiccup must not block the openTab attempts below.
  }
  let lastError: unknown
  for (const delay of delays) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    try {
      face.openTab(params)
      return
    } catch (error) {
      lastError = error
    }
  }
  face.reportError(errorMessage(lastError))
}

/**
 * Open the Bot Browser on a resource URI (or the Browser home). Mirrors the
 * duplicate-navigation guard the body portal had: while an iframe is live
 * (`liveUrl` non-null) and a URI was requested, the host's SSE fan-out
 * already navigates ABC inside it, so the tab is revealed with the CURRENT
 * URL — handing the fresh one over would reset the iframe src and reload it.
 * Never rejects; failures land in `reportError`.
 */
export async function openBotBrowser(
  face: BotBrowserOpenFace,
  uri: string | null,
  liveUrl: string | null,
  delays: readonly number[] = OPEN_TAB_RETRY_DELAYS_MS,
): Promise<void> {
  const target = uri !== null && uri.trim() !== '' ? uri : null
  if (liveUrl !== null && target !== null) {
    try {
      await face.browserOpen(target)
      await revealBotBrowserTab(face, { url: liveUrl, uri: target }, delays)
    } catch (cause) {
      face.reportError(errorMessage(cause))
    }
    return
  }
  try {
    const url = await face.browserOpen(target)
    await revealBotBrowserTab(face, target === null ? { url } : { url, uri: target }, delays)
  } catch (cause) {
    face.reportError(errorMessage(cause))
  }
}
