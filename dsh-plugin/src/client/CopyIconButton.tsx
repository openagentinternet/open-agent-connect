import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { IconCopyOutline16, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Icon-only copy button (the OAC `copy-action` port): copies `value` on click
 * and floats a small "copied" pill above the icon for a moment. Self-contained
 * state so it can drop into headers, message meta rows, and group transcripts
 * without plumbing through the parent.
 */
export function CopyIconButton({
  value,
  label,
  copiedLabel,
}: {
  /** Full value written to the clipboard. */
  value: string
  /** Accessible name + hover title, e.g. t('copyTxid'). */
  label: string
  /** Transient confirmation text, e.g. t('copied'). */
  copiedLabel: string
}): ReactNode {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
  }, [])

  const onClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    if (!value) return
    void writeClipboard(value).then((ok) => {
      if (!ok) return
      setCopied(true)
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1600)
    }, () => undefined)
  }

  return (
    <span className="oac-copy-wrap">
      <button
        type="button"
        className="oac-copy-action"
        title={label}
        aria-label={label}
        onClick={onClick}
      >
        <IconCopyOutline16 size={12} />
      </button>
      {copied ? <span className="oac-copy-copied">{copiedLabel}</span> : null}
    </span>
  )
}
