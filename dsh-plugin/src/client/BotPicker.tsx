import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { pickDefaultAvailableBotSlug, sortAvailableBotsTwinFirst } from '../bot-order.ts'
import type { BotRow } from './api.ts'
import { BotAvatar } from './BotAvatar.tsx'
import { IconChevronDownOutline14 } from './icons.ts'

/**
 * The shared Bot selector for every picker in the plugin: available Bots only
 * (availability toggle on + a DSH LLM pair — the preset-chip rule), the Twin
 * Bot first, the rest by profile creation time (oldest first). The default
 * selection everywhere is `pickDefaultAvailableBotSlug(bots)` — the Twin.
 *
 * This is a listbox rather than a native select because browsers do not render
 * images inside `<option>` elements consistently. Every Bot name therefore
 * carries the same avatar and initials fallback in the trigger and menu.
 */
export function BotPicker({
  bots,
  value,
  onChange,
  disabled,
  ariaLabel,
  className,
  formatLabel,
  placeholder,
}: {
  bots: readonly BotRow[]
  value: string
  onChange: (slug: string) => void
  disabled?: boolean
  ariaLabel?: string
  className?: string
  /** Default: the Bot name with a "· Twin" badge on the Twin. */
  formatLabel?: (bot: BotRow) => string
  /** Empty-value option, rendered only while `value` is ''. */
  placeholder?: string
}): ReactNode {
  const ordered = sortAvailableBotsTwinFirst(bots)
  const labelOf = formatLabel ?? ((bot: BotRow) => `${bot.name}${bot.botType === 'twin' ? ' · Twin' : ''}`)
  const valueMissing = value !== '' && !ordered.some((bot) => bot.slug === value)
  const selected = ordered.find((bot) => bot.slug === value)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const id = useId()
  const disabledState = disabled ?? ordered.length === 0
  const triggerLabel = selected ? labelOf(selected) : valueMissing ? value : placeholder ?? ''

  useEffect(() => {
    if (!open) return undefined
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  const close = (restoreFocus = false): void => {
    setOpen(false)
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const choose = (slug: string): void => {
    onChange(slug)
    close(true)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      close(true)
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && open) {
      event.preventDefault()
      const options = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
      const active = options.findIndex((option) => option === document.activeElement)
      const next = (Math.max(active, 0) + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
      options[next]?.focus()
    }
  }

  return (
    <div ref={rootRef} className={className ?? 'oac-bot-picker'} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="oac-bot-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-listbox` : undefined}
        aria-label={ariaLabel}
        disabled={disabledState}
        onClick={() => { if (open) close(); else setOpen(true) }}
      >
        {selected ? <BotAvatar name={selected.name} src={selected.avatarDataUrl} className="oac-bot-picker-avatar" /> : null}
        <span className="oac-bot-picker-label">{triggerLabel}</span>
        <IconChevronDownOutline14 className={open ? 'oac-bot-picker-chevron oac-bot-picker-chevron-open' : 'oac-bot-picker-chevron'} />
      </button>
      {open ? (
        <div id={`${id}-listbox`} className="oac-bot-picker-menu" role="listbox" aria-label={ariaLabel}>
          {placeholder !== undefined && value === '' ? (
            <button type="button" role="option" aria-selected={value === ''} className="oac-bot-picker-option" onClick={() => { choose('') }}>
              <span className="oac-bot-picker-label">{placeholder}</span>
            </button>
          ) : null}
          {valueMissing ? (
            <button type="button" role="option" aria-selected className="oac-bot-picker-option" onClick={() => { choose(value) }}>
              <span className="oac-bot-picker-label">{value}</span>
            </button>
          ) : null}
          {ordered.map((bot) => (
            <button
              key={bot.slug}
              type="button"
              role="option"
              aria-selected={bot.slug === value}
              className="oac-bot-picker-option"
              onClick={() => { choose(bot.slug) }}
            >
              <BotAvatar name={bot.name} src={bot.avatarDataUrl} className="oac-bot-picker-avatar" />
              <span className="oac-bot-picker-label">{labelOf(bot)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export { pickDefaultAvailableBotSlug, sortAvailableBotsTwinFirst }
