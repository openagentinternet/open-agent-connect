import { useEffect, useState, type ReactNode } from 'react'
import { resolveAvatarUrl } from '../avatar-url.ts'
import { loadCachedAvatarSrc, peekCachedAvatarSrc } from './avatar-cache.ts'

/**
 * Round avatar: the Bot's own image when it has one, initials otherwise.
 * Chain pin references (pinId / metafile:// / indexer /content/ paths) route
 * through the daemon avatar proxy via resolveAvatarUrl, then the local
 * avatar cache (memory + Cache API) so a second 线上对话 paint is instant.
 * An image that fails to load falls back to initials instead of a broken
 * glyph. `className` carries an optional size variant (e.g. `oac-bot-avatar-sm`).
 */
export function BotAvatar({
  name,
  src,
  className,
  loading = 'eager',
}: {
  name: string
  src: string | undefined
  className?: string
  loading?: 'eager' | 'lazy'
}): ReactNode {
  const resolved = resolveAvatarUrl(src)
  const cached = resolved ? peekCachedAvatarSrc(resolved) : undefined
  const [displaySrc, setDisplaySrc] = useState<string | undefined>(cached)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!resolved) {
      setDisplaySrc(undefined)
      return
    }
    let cancelled = false
    const hit = peekCachedAvatarSrc(resolved)
    if (hit) {
      setDisplaySrc(hit)
      return
    }
    void loadCachedAvatarSrc(resolved).then(
      (url) => { if (!cancelled) setDisplaySrc(url) },
      () => { if (!cancelled) setFailedSrc(resolved) },
    )
    return () => { cancelled = true }
  }, [resolved])

  const base = 'oac-bot-avatar'
  const classes = className === undefined ? base : `${base} ${className}`
  if (displaySrc !== undefined && displaySrc !== failedSrc) {
    return <img className={classes} src={displaySrc} alt="" loading={loading} onError={() => setFailedSrc(displaySrc)} />
  }
  const initials = name.trim().slice(0, 2).toUpperCase() || 'MB'
  return <span className={`${classes} oac-bot-avatar-fallback`} aria-hidden="true">{initials}</span>
}

/** Avatar that opens the owner's Bot page (`metaid://…`) when clicked. */
export function BotAvatarButton({
  name,
  src,
  className,
  label,
  onClick,
}: {
  name: string
  src: string | undefined
  className?: string
  /** Accessible label / tooltip, e.g. `Open Bot page: Alice`. */
  label: string
  onClick: () => void
}): ReactNode {
  return (
    <button type="button" className="oac-avatar-btn" title={label} aria-label={label} onClick={onClick}>
      <BotAvatar name={name} src={src} className={className} />
    </button>
  )
}
