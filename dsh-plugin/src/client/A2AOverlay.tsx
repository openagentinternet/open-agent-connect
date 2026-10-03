/**
 * A2A Chat `shell.overlay` entry (client half).
 *
 * The overlay covers the center column ONLY: the left rail and the official
 * right Sidebar stay mounted and interactive (a kernel global main panel
 * would unmount the right Sidebar — its root gates on the active panel id).
 * The frame chrome (grid-mirroring center cell, closed/main-panel gating) is
 * the shared `CenterOverlayFrame`.
 *
 * Open state comes from the apply-scope A2APanelStore (the panellist row's
 * intercepted click toggles it; navigation back to the conversation column
 * closes it — the apply wiring watches `ctx.sessions.list` AND wraps
 * `ctx.layout.selectPanel(null)`, because 新会话 reusing the already-current
 * blank session changes neither). The entry renders nothing while a
 * kernel global panel is active or the right Sidebar is fullscreen (the
 * frame's `data-rightbar-fullscreen` attribute, pure CSS).
 */
import { Component, type ReactNode } from 'react'
import type { CommonKeyOf, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { UsePanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import { A2AConversation, type A2AConversationInjected } from './A2AConversation.tsx'
import { CenterOverlayFrame } from './overlay-frame.tsx'
import type { ConversationsLocaleKey } from './locale-conversations.ts'

type Translate = (key: ConversationsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

export type A2AOverlayInjected = Omit<A2AConversationInjected, 'hooks'> & {
  hooks: A2AConversationInjected['hooks']
}

export type A2AOverlayProps =
  InjectFace<A2AOverlayInjected>
  & {
    t: Translate
    usePanelInfo: UsePanelInfo
  }

/**
 * Crash containment for the panel body. The slot framework retires a crashed
 * list entry from its cell for the rest of the registration's life — an
 * uncaught render error inside the panel would silently kill every row
 * click until the page reloads. This boundary keeps the entry alive: the
 * error becomes a visible note, and the next navigation target (a new row
 * click writes a fresh object) resets the boundary for a fresh mount.
 */
class OverlayPanelBoundary extends Component<
  { resetKey: unknown; errorText: string; children: ReactNode },
  { error: unknown }
> {
  state = { error: undefined as unknown }

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error }
  }

  componentDidCatch(cause: unknown): void {
    console.error('[oac-dsh] A2A panel crashed:', cause)
  }

  componentDidUpdate(previous: { resetKey: unknown }): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error !== undefined) {
      this.setState({ error: undefined })
    }
  }

  render(): ReactNode {
    if (this.state.error !== undefined) {
      return (
        <div className="oac-a2a-panel">
          <div className="oac-gt-placeholder"><p className="oac-note error">{this.props.errorText}</p></div>
        </div>
      )
    }
    return this.props.children
  }
}

export function A2AOverlay({ t, usePanelInfo, usePanel, ...face }: A2AOverlayProps): ReactNode {
  const open = usePanel((state) => state.open)
  const target = usePanel((state) => state.target)
  return (
    <CenterOverlayFrame open={open} usePanelInfo={usePanelInfo}>
      <OverlayPanelBoundary resetKey={target} errorText={t('panelError')}>
        <A2AConversation {...face} usePanel={usePanel} t={t} />
      </OverlayPanelBoundary>
    </CenterOverlayFrame>
  )
}
