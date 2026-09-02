import { useState, type ReactNode } from 'react'
import { resolveAvatarUrl } from '../avatar-url.ts'

/**
 * Round avatar: the Bot's own image when it has one, initials otherwise.
 * Chain pin references (pinId / metafile:// / indexer /content/ paths) route
 * through the daemon avatar proxy via resolveAvatarUrl; an image that fails
 * to load falls back to initials instead of a broken glyph.
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
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const base = 'oac-bot-avatar'
  const classes = className === undefined ? base : `${base} ${className}`
  const resolved = resolveAvatarUrl(src)
  if (resolved !== undefined && resolved !== failedSrc) {
    return <img className={classes} src={resolved} alt="" loading="lazy" onError={() => setFailedSrc(resolved)} />
  }
  const initials = name.trim().slice(0, 2).toUpperCase() || 'MB'
  return <span className={`${classes} oac-bot-avatar-fallback`} aria-hidden="true">{initials}</span>
}
