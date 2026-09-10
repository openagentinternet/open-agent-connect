/**
 * A2A Chat `sidebar.panellist` glyph (client half).
 *
 * The sidebar owns the panel row (button, tooltip, selection); this
 * registration renders only the glyph inside it: the chat icon plus the
 * unread dot while any private conversation or group task has unread
 * activity. The dot reads the apply-scope unread feed through the inject
 * `hooks` compartment, so it works no matter which main panel is selected.
 */
import type { ReactNode } from 'react'
import { IconNewChatOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { hasAnyUnread, type UnreadState } from '../unread-logic.ts'

export interface A2APanelGlyphInjected {
  hooks: {
    /** The apply-scope A2A unread feed. */
    unread: SnapshotStore<UnreadState>
  }
}

export type A2APanelGlyphProps =
  InjectFace<A2APanelGlyphInjected>
  & {
    /** Row-requested square edge in pixels. */
    size: number
    /** Whether this panel is selected in the main column. */
    active: boolean
  }

export function A2APanelGlyph({ size, useUnread }: A2APanelGlyphProps): ReactNode {
  const hasUnread = useUnread((state) => hasAnyUnread(state))
  return (
    <span className="oac-a2a-glyph">
      <IconNewChatOutline16 size={size} />
      {hasUnread ? <span className="oac-unread-dot" /> : null}
    </span>
  )
}
