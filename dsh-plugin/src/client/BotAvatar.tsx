import type { ReactNode } from 'react'

/**
 * Round avatar: the Bot's own image when it has one, initials otherwise.
 * `className` carries an optional size variant (e.g. `oac-bot-avatar-sm`).
 */
export function BotAvatar({
  name,
  src,
  className,
}: {
  name: string
  src: string | undefined
  className?: string
}): ReactNode {
  const base = 'oac-bot-avatar'
  const classes = className === undefined ? base : `${base} ${className}`
  if (src !== undefined && src.trim() !== '') {
    return <img className={classes} src={src} alt="" />
  }
  const initials = name.trim().slice(0, 2).toUpperCase() || 'MB'
  return <span className={`${classes} oac-bot-avatar-fallback`} aria-hidden="true">{initials}</span>
}
