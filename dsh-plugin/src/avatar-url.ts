/**
 * Avatar URL resolution shared by the chat panels.
 *
 * Chain profiles (so.metaid.io) carry the avatar as a pin *reference* — a bare
 * pinId, a `metafile://` URI, or a `/content/...`-style indexer path — which no
 * browser can render directly. The OAC `/ui/conversations` page rewrites those
 * references to the daemon's `/api/file/avatar` proxy; this module ports the
 * same normalization so the DSH panels render the same images. Direct URLs
 * (data:, blob:, http(s)) pass through untouched.
 */

// Mirrors AVATAR_CONTENT_PATH_PREFIXES in src/ui/pages/conversations/app.ts
// and src/daemon/defaultHandlers.ts.
const AVATAR_CONTENT_PATH_PREFIXES = [
  '/content/',
  '/metafile-indexer/content/',
  '/metafile-indexer/thumbnail/',
  '/metafile-indexer/api/v1/files/content/',
  '/metafile-indexer/api/v1/files/accelerate/content/',
  '/metafile-indexer/api/v1/users/avatar/accelerate/',
]

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isHttpUrl(value: string): boolean {
  const normalized = value.toLowerCase()
  return normalized.startsWith('http://') || normalized.startsWith('https://')
}

function pathOf(raw: string): string {
  if (isHttpUrl(raw)) {
    try {
      return new URL(raw).pathname
    } catch {
      return ''
    }
  }
  return raw
}

/** True when the reference points at an indexer content path (renderable only through a proxy). */
export function isAvatarContentReference(rawAvatar: string): boolean {
  const raw = normalizeText(rawAvatar)
  if (!raw) return false
  if (raw.toLowerCase().startsWith('metafile://')) return true
  const path = pathOf(raw).toLowerCase()
  return AVATAR_CONTENT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix.toLowerCase()))
}

/** Pull the pin id out of any avatar reference form; '' when the value is not a pin reference. */
export function extractAvatarPinReference(rawAvatar: string): string {
  const raw = normalizeText(rawAvatar)
  if (!raw) return ''
  if (raw.toLowerCase().startsWith('metafile://')) {
    const pinId = raw.slice('metafile://'.length).trim().split(/[?#]/)[0] ?? ''
    return pinId ? `metafile://${pinId}` : ''
  }
  const path = pathOf(raw)
  const lowerPath = path.toLowerCase()
  for (const prefix of AVATAR_CONTENT_PATH_PREFIXES) {
    if (lowerPath.startsWith(prefix.toLowerCase())) {
      return decodeURIComponent((path.slice(prefix.length).split(/[?#]/)[0] ?? '').trim())
    }
  }
  if (/^[0-9a-f]{64}(?:i[0-9]+)?$/iu.test(raw)) return raw
  return ''
}

/**
 * Renderable `src` for one stored avatar value. Pin references route through
 * the plugin host's daemon avatar proxy; known-broken content markers (a bare
 * `/content/` prefix with no pin id) collapse to undefined so callers fall
 * back to the initials avatar.
 */
export function resolveAvatarUrl(rawAvatar: string | null | undefined, apiPrefix = '/oac/api'): string | undefined {
  const raw = normalizeText(rawAvatar)
  if (!raw) return undefined
  if (/^(data:|blob:)/iu.test(raw)) return raw
  const pinRef = extractAvatarPinReference(raw)
  if (pinRef) return `${apiPrefix}/file/avatar?ref=${encodeURIComponent(pinRef)}`
  if (isAvatarContentReference(raw)) return undefined
  if (isHttpUrl(raw) || raw.startsWith('/')) return raw
  return undefined
}
