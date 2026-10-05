/**
 * MetaTask identity badge — avatar + display name, the DSH twin of IDBots'
 * MetaIdBadge. Avatars resolve through the daemon's /api/file/avatar proxy
 * (resolveAvatarUrl); failures and absent avatars fall back to a colored
 * initial disc (color derived from the metaId, stable per bot). Every place a
 * bot identity renders uses this so humans always see WHO, not a raw metaId.
 */
import { useState, type ReactNode } from 'react'
import { resolveAvatarUrl } from '../../avatar-url.js'
import { shortMetaId } from '../../metatask-logic.js'

const AVATAR_COLORS = ['#f59e0b', '#0ea5e9', '#8b5cf6', '#10b981', '#ef4444', '#6366f1', '#ec4899', '#14b8a6']

const colorOf = (metaId: string): string => {
  let hash = 0
  for (const ch of metaId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

export function MtBadge(props: {
  metaId: string
  name: string | null
  avatar: string | null
  size?: 'sm' | 'md'
  /** Local-roster marker (IDBots "YOU" chip). */
  you?: boolean
  youLabel?: string
}): ReactNode {
  const { metaId, name, avatar, size = 'sm', you, youLabel } = props
  const [imgFailed, setImgFailed] = useState(false)
  const display = name?.trim() || shortMetaId(metaId)
  const initial = (name?.trim() || metaId).charAt(0).toUpperCase() || '?'
  const url = avatar && !imgFailed ? resolveAvatarUrl(avatar) : undefined
  return (
    <span className={`oac-mt-badge-id oac-mt-badge-id-${size}`} title={metaId}>
      {url
        ? <img className="oac-mt-badge-avatar" src={url} alt="" onError={() => { setImgFailed(true) }} />
        : <span className="oac-mt-badge-avatar oac-mt-badge-initial" style={{ background: colorOf(metaId) }}>{initial}</span>}
      <span className="oac-mt-badge-name">{display}</span>
      {you && <span className="oac-mt-you">{youLabel ?? 'YOU'}</span>}
    </span>
  )
}
