import { useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconArchiveOutline20,
  IconCopyOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  Menu,
  writeClipboard,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { relativeTimeLabel } from '../relative-time.ts'
import { timestampLabel } from './api.ts'
import type { ConversationsLocaleKey } from './locale-conversations.ts'

type Translate = (key: ConversationsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

/**
 * Trailing hover menu for conversation-list rows (private chats and group
 * tasks alike): the relative time swaps for a "..." button on hover — the
 * DSH home session-list pattern — and the native `Menu` primitive renders the
 * dropdown (Copy Session ID / Rename / Pin / Archive, IDBots item order).
 * Pinned rows keep the trailing slot visible as a pin marker that crossfades
 * to "..." on hover. Rename and archive confirmation stay with the host panel
 * (the group-task archive confirm and the rename modals are panel-owned).
 */
export function ConversationRowMenu({
  pinned,
  copyId,
  time,
  disabled,
  onRename,
  onTogglePin,
  onArchive,
  t,
}: {
  pinned: boolean
  /** Value placed on the clipboard by Copy Session ID (conversation/group id). */
  copyId: string
  /** Row timestamp; rendered as the relative label the menu swaps out. */
  time?: number | null
  /** Block the write actions while another one is in flight. */
  disabled?: boolean
  onRename: () => void
  onTogglePin: (pinned: boolean) => void
  onArchive: () => void
  t: Translate
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copySessionId = (): void => {
    if (!copyId) return
    void writeClipboard(copyId).then((ok) => {
      if (!ok) return
      setCopied(true)
      if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1600)
    }, () => undefined)
  }

  const onSelect = (id: string): void => {
    setOpen(false)
    if (id === 'copy-session-id') {
      copySessionId()
      return
    }
    if (disabled) return
    if (id === 'rename') onRename()
    else if (id === 'pin') onTogglePin(!pinned)
    else if (id === 'archive') onArchive()
  }

  const items: MenuEntry[] = [
    { id: 'copy-session-id', label: t('menuCopySessionId'), icon: <IconCopyOutline16 /> },
    { id: 'rename', label: t('menuRename'), icon: <IconEditOutline16 />, disabled },
    {
      id: 'pin',
      label: pinned ? t('menuUnpin') : t('menuPin'),
      icon: <span className="oac-menu-star" aria-hidden="true">★</span>,
      disabled,
    },
    { id: 'archive', label: t('menuArchive'), icon: <IconArchiveOutline20 size={16} />, disabled },
  ]

  const onButtonClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    setOpen((value) => !value)
  }

  return (
    <span
      className="oac-row-trail"
      data-pinned={pinned}
      data-menu-open={open}
    >
      {time != null ? (
        <span className="oac-a2a-row-time" title={timestampLabel(time)}>
          {relativeTimeLabel(time)}
        </span>
      ) : null}
      <span className="oac-row-actions">
        <Menu
          open={open}
          onClose={() => setOpen(false)}
          items={items}
          onSelect={onSelect}
          portal
          closeOnPointerLeave
          align="end"
          anchor={(
            <button
              type="button"
              className="oac-row-menu-btn"
              aria-label={t('menuMoreActions')}
              title={t('menuMoreActions')}
              onClick={onButtonClick}
            >
              <span className="oac-row-pin-icon" aria-hidden="true">★</span>
              <IconEllipsisOutline16 />
            </button>
          )}
        />
        {copied ? <span className="oac-row-menu-copied">{t('copied')}</span> : null}
      </span>
    </span>
  )
}
