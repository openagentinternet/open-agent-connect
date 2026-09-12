/**
 * A2A Chat `shell.overlay` entry (client half).
 *
 * The overlay covers the center column ONLY: the left rail and the official
 * right Sidebar stay mounted and interactive (a kernel global main panel
 * would unmount the right Sidebar — its root gates on the active panel id).
 * The entry renders a three-column grid whose template mirrors the frame
 * element's inline `grid-template-columns` (the frame owns the sidebar /
 * center / rightbar geometry), so the opaque center cell tracks column
 * resizes, sidebar collapse, and right-Sidebar open/close exactly; the side
 * cells are transparent and click-through. Until the frame is found the
 * fallback covers the full frame — the old global-panel behavior.
 *
 * Open state comes from the apply-scope A2APanelStore (the panellist row's
 * intercepted click toggles it; session navigation closes it — the apply
 * wiring watches `ctx.sessions.list`). The entry renders nothing while a
 * kernel global panel is active or the right Sidebar is fullscreen (the
 * frame's `data-rightbar-fullscreen` attribute, pure CSS).
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { CommonKeyOf, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { UsePanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import { A2AConversation, type A2AConversationInjected } from './A2AConversation.tsx'
import type { A2APanelState } from './a2a-panel-store.ts'
import type { ConversationsLocaleKey } from './locale-conversations.ts'

type Translate = (key: ConversationsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

export type A2AOverlayInjected = Omit<A2AConversationInjected, 'hooks'> & {
  hooks: A2AConversationInjected['hooks'] & {
    /** The apply-scope A2A overlay open state. */
    panel: SnapshotStore<A2APanelState>
  }
}

export type A2AOverlayProps =
  InjectFace<A2AOverlayInjected>
  & {
    t: Translate
    usePanelInfo: UsePanelInfo
  }

/** Full-frame fallback used until the frame's grid template can be mirrored. */
const FALLBACK_COLUMNS = '0px minmax(0, 1fr) 0px'

export function A2AOverlay({ t, usePanelInfo, usePanel, ...face }: A2AOverlayProps): ReactNode {
  const open = usePanel((state) => state.open)
  const activePanel = usePanelInfo((info) => info.activePanelId)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [columns, setColumns] = useState(FALLBACK_COLUMNS)

  // Mirror the frame element's inline grid template (sidebar | center |
  // rightbar): the frame re-renders that style on every geometry change, so
  // one MutationObserver keeps the center cell aligned through resizes,
  // sidebar collapse, and right-Sidebar open/close.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const frame = root.closest('[data-shell-overlay]')?.parentElement ?? null
    if (frame === null) return
    const sync = (): void => {
      const template = frame.style.gridTemplateColumns
      setColumns(template === '' ? FALLBACK_COLUMNS : template)
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(frame, { attributes: true, attributeFilter: ['style'] })
    return () => { observer.disconnect() }
  }, [open, activePanel])

  if (!open || activePanel !== null) return null
  return (
    <div className="oac-a2a-overlay" ref={rootRef} style={{ gridTemplateColumns: columns }}>
      <div aria-hidden="true" />
      <div className="oac-a2a-overlay-center">
        <A2AConversation {...face} t={t} />
      </div>
      <div aria-hidden="true" />
    </div>
  )
}
