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
import type { ReactNode } from 'react'
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

export function A2AOverlay({ t, usePanelInfo, usePanel, ...face }: A2AOverlayProps): ReactNode {
  const open = usePanel((state) => state.open)
  return (
    <CenterOverlayFrame open={open} usePanelInfo={usePanelInfo}>
      <A2AConversation {...face} usePanel={usePanel} t={t} />
    </CenterOverlayFrame>
  )
}
