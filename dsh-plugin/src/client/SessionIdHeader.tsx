/**
 * Session-id readout in the conversation header
 * (`conversation.session.header.actions`, order -9 — immediately right of the
 * stock agent-preset label). The framework hands the entry's inject factory
 * the id of the session whose header renders, so the readout follows
 * conversation switches without polling any store.
 */

import type { ReactNode } from 'react'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import { CopyIconButton } from './CopyIconButton.tsx'
import type { ConversationsLocaleKey } from './locale-conversations.ts'

type Translate = (key: ConversationsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

export interface SessionIdHeaderProps {
  /** Id of the session whose header this entry renders in. */
  sessionId: string
  t: Translate
}

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id
}

export function SessionIdHeader({ sessionId, t }: SessionIdHeaderProps): ReactNode {
  if (!sessionId) return null
  return (
    <span className="oac-session-id-header" title={sessionId}>
      <code>{shortId(sessionId)}</code>
      <CopyIconButton value={sessionId} label={t('copyConversationId')} copiedLabel={t('copied')} />
    </span>
  )
}
