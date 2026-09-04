/**
 * DSH theme ↔ ABC Browser theme bridge (client half).
 *
 * ABC renders its own theme inside the iframe (host CSS cannot cross the
 * iframe boundary), so the host only selects it — per agent-browser-core's
 * `docs/browser-theme-host-integration.md`. DSH resolves its
 * `light | dark | system` preference onto `body[data-ds-dark-theme]` (the
 * ui-theme boot script and ThemePresenter toggle that attribute), which this
 * module observes. Two selection paths:
 *
 * - **Initial paint** — the daemon bakes the theme into the served Browser
 *   page HTML, so the iframe URL carries `?theme=` (`withThemeParam`); no
 *   light flash in dark mode.
 * - **Runtime flips** — one `agent-browser:set-theme` postMessage into the
 *   loaded iframe (`postBrowserThemeMessage`) re-themes ABC without
 *   reloading or losing page state.
 */

export type BrowserResolvedTheme = 'light' | 'dark'

/**
 * ABC's stable host → Browser theme envelope constants, mirrored here instead
 * of importing `@openagentinternet/agent-browser-ui/browser` (that entry also
 * carries ABC's page-render modules, which must not be bundled into the DSH
 * client). Keep in sync with the published `createBrowserThemeMessage`.
 */
const BROWSER_THEME_MESSAGE_TYPE = 'agent-browser:set-theme'
const BROWSER_THEME_MESSAGE_VERSION = 1

/** The DSH theme runtime's resolved dark-mode marker on `<body>`. */
const DSH_DARK_ATTRIBUTE = 'data-ds-dark-theme'

/** DSH's resolved theme: concrete `light`/`dark`, `system` already applied. */
export function readDshTheme(): BrowserResolvedTheme {
  if (typeof document === 'undefined') return 'light'
  return document.body.hasAttribute(DSH_DARK_ATTRIBUTE) ? 'dark' : 'light'
}

/** Subscribe to DSH theme flips; returns a disconnect function. */
export function watchDshTheme(onChange: (theme: BrowserResolvedTheme) => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  const observer = new MutationObserver(() => onChange(readDshTheme()))
  observer.observe(document.body, { attributes: true, attributeFilter: [DSH_DARK_ATTRIBUTE] })
  return () => observer.disconnect()
}

/**
 * Bake the resolved DSH theme into a daemon-served Browser page URL
 * (`/browser/*?theme=dark`). Non-URLs pass through unchanged.
 */
export function withThemeParam(url: string, theme: BrowserResolvedTheme): string {
  try {
    const parsed = new URL(url)
    parsed.searchParams.set('theme', theme)
    return parsed.toString()
  } catch {
    return url
  }
}

/** Push a theme flip into the loaded ABC iframe (no-op when not loaded). */
export function postBrowserThemeMessage(
  iframe: HTMLIFrameElement | null,
  theme: BrowserResolvedTheme,
): void {
  const target = iframe?.contentWindow
  if (!target) return
  target.postMessage(
    { type: BROWSER_THEME_MESSAGE_TYPE, version: BROWSER_THEME_MESSAGE_VERSION, theme },
    '*',
  )
}
