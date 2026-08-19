import { useEffect, useState, type ReactNode } from 'react'
import { imageUrlCandidates } from '../apps.ts'

/**
 * Render a MetaApp asset image (icon / cover / intro shot). The value is any
 * reference the protocol stores (metafile:// pin, bare pin, http(s) URL); the
 * candidate URLs are tried in order, and when every candidate fails the given
 * fallback (usually an initials tile) is rendered.
 */
export function AssetImage({
  value,
  className,
  alt,
  fallback,
}: {
  value: string
  className?: string
  alt?: string
  fallback?: ReactNode
}): ReactNode {
  const candidates = imageUrlCandidates(value)
  const [tried, setTried] = useState(0)
  useEffect(() => { setTried(0) }, [value])
  if (candidates.length === 0 || tried >= candidates.length) {
    return fallback ?? null
  }
  return (
    <img
      className={className}
      src={candidates[tried] ?? ''}
      alt={alt ?? ''}
      loading="lazy"
      onError={() => setTried((count) => count + 1)}
    />
  )
}
