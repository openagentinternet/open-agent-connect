/**
 * Shared Bot Browser iframe stage (client half).
 *
 * One keyed iframe per URL: the DSH-resolved theme is baked into the src once
 * per URL so the daemon-served ABC page paints in the right palette from the
 * first frame; live theme flips must NOT rewrite the src (that would reload
 * the iframe and drop Browser page state) — they arrive as set-theme
 * postMessages instead. The live iframe (and the URL it loaded) is reported
 * to the bridge on every real mount/unmount. Used by the right-Sidebar tab
 * body (`BotBrowserTab`) and the A2A in-panel dock (`A2ABrowserDock`).
 */
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { postBrowserThemeMessage, readDshTheme, watchDshTheme, withThemeParam } from './browser-theme.ts'

export function BrowserStage({ url, title, onIframe }: {
  /** The resolved `localUiUrl` the iframe loads. */
  url: string
  /** The iframe's a11y title. */
  title: string
  /** Report the live iframe (and the URL it loaded) to the bridge; (null, url) on detach. */
  onIframe: (iframe: HTMLIFrameElement | null, url: string | null) => void
}): ReactNode {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  // Stable per url: React then fires the ref only on real mount/unmount (the
  // keyed iframe remounts on a URL change), not on every render.
  const reportIframe = useCallback((element: HTMLIFrameElement | null): void => {
    iframeRef.current = element
    onIframe(element, url)
  }, [url, onIframe])
  const iframeSrc = useMemo(() => withThemeParam(url, readDshTheme()), [url])
  useEffect(() => watchDshTheme((theme) => postBrowserThemeMessage(iframeRef.current, theme)), [url])
  return (
    <iframe
      key={url}
      className="oac-browser-frame"
      src={iframeSrc}
      title={title}
      allow="clipboard-read; clipboard-write; fullscreen"
      ref={reportIframe}
      onLoad={() => postBrowserThemeMessage(iframeRef.current, readDshTheme())}
    />
  )
}
