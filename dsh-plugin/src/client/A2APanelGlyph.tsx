/**
 * A2A Chat `sidebar.panellist` glyph (client half).
 *
 * The sidebar owns the panel row (button, tooltip); this registration renders
 * only the glyph inside it: the chat icon plus the unread dot while any
 * private conversation or group task has unread activity. The dot reads the
 * apply-scope unread feed through the inject `hooks` compartment, so it works
 * no matter which main panel is selected.
 *
 * The row's click no longer selects a kernel global main panel (that would
 * unmount the right Sidebar): it is capture-intercepted and toggles the A2A
 * overlay store instead (see `a2a-panel-row.ts`). The glyph carries the
 * `data-oac-a2a-panellist` marker the interceptor matches on, and draws its
 * own open state from the same store. Because the kernel `active` highlight
 * on the row button never fires for an overlay, the glyph syncs the selected
 * look onto the row itself (`.oac-a2a-row-active`, the kernel panelActive
 * vocabulary) plus `aria-current`, and clears both whenever the overlay
 * closes — including when session navigation or a new-session click closed
 * it.
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { IconNewChatOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { hasAnyUnread, type UnreadState } from '../unread-logic.ts'
import { A2A_PANEL_ROW_MARK } from './a2a-panel-row.ts'
import type { A2APanelState } from './a2a-panel-store.ts'

export interface A2APanelGlyphInjected {
  hooks: {
    /** The apply-scope A2A unread feed. */
    unread: SnapshotStore<UnreadState>
    /** The apply-scope A2A overlay open state (glyph open styling). */
    panel: SnapshotStore<A2APanelState>
  }
}

export type A2APanelGlyphProps =
  InjectFace<A2APanelGlyphInjected>
  & {
    /** Row-requested square edge in pixels. */
    size: number
  }

export function A2APanelGlyph({ size, useUnread, usePanel }: A2APanelGlyphProps): ReactNode {
  const hasUnread = useUnread((state) => hasAnyUnread(state))
  const open = usePanel((state) => state.open)
  const markRef = useRef<HTMLSpanElement | null>(null)
  // The row button is the sidebar's; mirror the overlay-open state onto it so
  // the row reads as selected (and stops reading as selected the moment the
  // store closes, whichever path closed it).
  useLayoutEffect(() => {
    const row = markRef.current?.closest('button')
    if (!(row instanceof HTMLElement)) return
    row.classList.toggle('oac-a2a-row-active', open)
    if (open) row.setAttribute('aria-current', 'page')
    else row.removeAttribute('aria-current')
    return () => {
      row.classList.remove('oac-a2a-row-active')
      row.removeAttribute('aria-current')
    }
  }, [open])
  return (
    <span ref={markRef} className="oac-a2a-glyph" {...{ [A2A_PANEL_ROW_MARK]: '' }} data-open={open || undefined}>
      <IconNewChatOutline16 size={size} />
      {hasUnread ? <span className="oac-unread-dot" /> : null}
    </span>
  )
}
