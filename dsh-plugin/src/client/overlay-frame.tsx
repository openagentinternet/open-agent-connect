/**
 * Shared center-column overlay frame (client half) — the `shell.overlay`
 * chrome both overlay surfaces (A2A Chat, the Bots page) render through.
 *
 * The frame covers the center column ONLY: the left rail and the official
 * right Sidebar stay mounted and interactive (a kernel global main panel
 * would unmount the right Sidebar — that is exactly why these surfaces are
 * overlays). The entry renders a three-column grid whose template mirrors
 * the frame element's inline `grid-template-columns` (the frame owns the
 * sidebar / center / rightbar geometry), so the opaque center cell tracks
 * column resizes, sidebar collapse, and right-Sidebar open/close exactly;
 * the side cells are transparent and click-through. Until the frame is found
 * the fallback covers the full frame.
 *
 * Renders nothing while the owning surface is closed OR while a kernel
 * global main panel is active (the right Sidebar is unmounted there anyway).
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { UsePanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'

/** Full-frame fallback used until the frame's grid template can be mirrored. */
const FALLBACK_COLUMNS = '0px minmax(0, 1fr) 0px'

export function CenterOverlayFrame({ open, usePanelInfo, children }: {
  /** The owning surface's open state (its apply-scope store). */
  open: boolean
  usePanelInfo: UsePanelInfo
  children: ReactNode
}): ReactNode {
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
  // The oac-a2a-overlay class names predate the extraction; they are the
  // shared overlay frame styles now (renaming would churn every assertion).
  return (
    <div className="oac-a2a-overlay" ref={rootRef} style={{ gridTemplateColumns: columns }}>
      <div aria-hidden="true" />
      <div className="oac-a2a-overlay-center">{children}</div>
      <div aria-hidden="true" />
    </div>
  )
}
