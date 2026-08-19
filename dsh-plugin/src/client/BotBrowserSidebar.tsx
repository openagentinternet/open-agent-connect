/**
 * Right-sidebar Bot Browser panel (client half).
 *
 * A fixed, very wide right panel portalled onto `document.body`, presenting
 * the local OAC Browser (`/browser/*` localUiUrl) in an iframe. The layout
 * push (`--oac-browser-width` on #root) comes from `styles.ts` and follows
 * open/close and width drags from this component. See the reference
 * dsh-better-sidebar for the same body-portal + layout-push pattern.
 */
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { BROWSER_NS, type BrowserLocaleKey } from './locale-browser.ts'
import type { BotBrowserStore } from './browser-store.ts'

/** Structural face of the DSH client locale service (bind/subscribe/getSnapshot). */
export interface BrowserLocaleFace {
  bind(ns: string): (key: string, vars?: Record<string, string | number>) => string
  getSnapshot(): { revision: number }
  subscribe(fn: () => void): () => void
}

export function BotBrowserSidebar({
  store,
  locale,
  openHome,
}: {
  store: BotBrowserStore
  locale: BrowserLocaleFace
  openHome: () => void
}): ReactNode {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  useSyncExternalStore(locale.subscribe, () => locale.getSnapshot().revision)
  const t = (key: BrowserLocaleKey): string => locale.bind(BROWSER_NS)(key)

  // Layout push + drag state ride CSS variables on <html> so the write is
  // immediate (no React round trip) and `#root { margin-right }` follows live.
  useEffect(() => {
    const root = document.documentElement
    if (state.open) {
      root.style.setProperty('--oac-browser-width', `${state.width}px`)
      document.body.setAttribute('data-oac-browser-open', '')
    } else {
      root.style.removeProperty('--oac-browser-width')
      document.body.removeAttribute('data-oac-browser-open')
    }
    return () => {
      root.style.removeProperty('--oac-browser-width')
      document.body.removeAttribute('data-oac-browser-open')
    }
  }, [state.open, state.width])

  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const onDragStart = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    dragRef.current = { startX: event.clientX, startWidth: state.width }
    document.body.setAttribute('data-oac-browser-dragging', '')
    setDragging(true)
    const move = (moveEvent: globalThis.PointerEvent): void => {
      const drag = dragRef.current
      if (drag === null) return
      store.setWidth(drag.startWidth + drag.startX - moveEvent.clientX)
    }
    const up = (): void => {
      dragRef.current = null
      document.body.removeAttribute('data-oac-browser-dragging')
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="oac-browser-shell" data-open={state.open} aria-hidden={!state.open}>
      <div
        className="oac-browser-resize"
        data-active={dragging}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('title')}
        onPointerDown={onDragStart}
      >
        <span className="oac-browser-resize-knob" />
      </div>
      <div className="oac-browser-panel">
        <header className="oac-browser-header">
          <h2 className="oac-browser-title">{t('title')}</h2>
          <span className="oac-browser-uri" title={state.url ?? ''}>
            {state.url ?? ''}
          </span>
          <button
            type="button"
            className="oac-browser-close"
            aria-label={t('close')}
            onClick={() => store.close()}
          >
            ×
          </button>
        </header>
        <div className="oac-browser-body">
          {state.url ? (
            <iframe
              key={state.url}
              className="oac-browser-frame"
              src={state.url}
              title={t('title')}
              allow="clipboard-read; clipboard-write; fullscreen"
            />
          ) : (
            <div className="oac-browser-landing">
              {state.error ? (
                <p className="oac-browser-error">{state.error}</p>
              ) : (
                <p className="oac-browser-empty">{t('empty')}</p>
              )}
              <button type="button" className="oac-browser-home" onClick={openHome}>
                {t('emptyAction')}
              </button>
            </div>
          )}
        </div>
      </div>
      <button type="button" className="oac-browser-reopen" aria-label={t('title')} onClick={() => store.toggle()}>
        <span className="oac-browser-reopen-label">{t('landing')}</span>
      </button>
    </div>
  )
}
