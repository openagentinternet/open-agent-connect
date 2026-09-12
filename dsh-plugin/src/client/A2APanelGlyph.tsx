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
 * own open state from the same store (the row's kernel `active` highlight
 * never fires now).
 */
import type { ReactNode } from 'react'
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
  return (
    <span className="oac-a2a-glyph" {...{ [A2A_PANEL_ROW_MARK]: '' }} data-open={open || undefined}>
      <IconNewChatOutline16 size={size} />
      {hasUnread ? <span className="oac-unread-dot" /> : null}
    </span>
  )
}
