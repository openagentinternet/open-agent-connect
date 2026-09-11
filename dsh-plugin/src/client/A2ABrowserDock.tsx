/**
 * A2A in-panel Bot Browser dock (client half).
 *
 * A right-hand column inside the A2A main panel that hosts the local OAC
 * Browser for opens originating in the panel (link, avatar, and group-task
 * clicks). The official right Sidebar cannot serve those opens: its Session
 * seat unmounts while a global main panel is selected, so revealing it would
 * flip the main column back to the Conversation and lose the A2A view. The
 * dock keeps the A2A page and state fully mounted — the conversation list,
 * thread, and composer never re-render from scratch.
 *
 * The dock reuses the shared `BrowserStage` (keyed iframe, theme baking,
 * bridge reporting); its chrome is a slim header with the live ABC active-tab
 * URI and a close button. The dock state lives at apply scope
 * (`A2ABrowserDockStore`), so leaving and re-entering the A2A panel keeps the
 * dock's URL (the iframe reloads on remount, matching native tab semantics).
 */
import type { ReactNode } from 'react'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import { BrowserStage } from './browser-stage.tsx'
import type { A2ABrowserDockState } from './a2a-browser-dock-store.ts'
import type { BrowserLocaleKey } from './locale-browser.ts'

type Translate = (key: BrowserLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

export function A2ABrowserDock({ state, activeUri, onClose, onIframe, t }: {
  /** The dock store snapshot (visibility, iframe URL, target URI, error). */
  state: A2ABrowserDockState
  /** Live ABC active-tab URI reported by the iframe bridge (header line). */
  activeUri: string | null
  onClose: () => void
  /** Report the live iframe (and the URL it loaded) to the bridge. */
  onIframe: (iframe: HTMLIFrameElement | null, url: string | null) => void
  t: Translate
}): ReactNode {
  const shownUri = activeUri ?? state.uri
  return (
    <aside className="oac-a2a-dock" aria-label={t('title')}>
      <div className="oac-a2a-dock-head">
        <span className="oac-a2a-dock-title">{t('title')}</span>
        <span className="oac-a2a-dock-uri" title={shownUri ?? undefined}>{shownUri ?? ''}</span>
        <button
          type="button"
          className="oac-a2a-dock-close"
          aria-label={t('close')}
          title={t('close')}
          onClick={onClose}
        >
          <IconCloseOutline16 size={14} />
        </button>
      </div>
      <div className="oac-a2a-dock-body">
        {state.url !== null ? (
          <BrowserStage url={state.url} title={t('title')} onIframe={onIframe} />
        ) : (
          <div className="oac-browser-landing">
            <p className="oac-browser-error">{state.error ?? t('empty')}</p>
          </div>
        )}
      </div>
    </aside>
  )
}
