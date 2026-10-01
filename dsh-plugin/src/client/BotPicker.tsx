import type { ReactNode } from 'react'
import { pickDefaultAvailableBotSlug, sortAvailableBotsTwinFirst } from '../bot-order.ts'
import type { BotRow } from './api.ts'

/**
 * The shared Bot selector for every picker in the plugin: available Bots only
 * (availability toggle on + a DSH LLM pair — the preset-chip rule), the Twin
 * Bot first, the rest by profile creation time (oldest first). The default
 * selection everywhere is `pickDefaultAvailableBotSlug(bots)` — the Twin.
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
  return (
    <select
      className={className ?? 'oac-input oac-input-select'}
      value={value}
      disabled={disabled ?? ordered.length === 0}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
    >
      {placeholder !== undefined && value === '' ? <option value="">{placeholder}</option> : null}
      {valueMissing ? (
        // The selected Bot just became unavailable — keep the current value
        // renderable so the select never shows a phantom row.
        <option value={value}>{value}</option>
      ) : null}
      {ordered.map((bot) => (
        <option key={bot.slug} value={bot.slug}>{labelOf(bot)}</option>
      ))}
    </select>
  )
}

export { pickDefaultAvailableBotSlug, sortAvailableBotsTwinFirst }
