/**
 * In-process cache for the plugin's `/oac/api/file/avatar` proxy.
 *
 * The daemon already caches resolved avatar bytes, but every DSH list
 * row still hops through this host. Remembering the last successful
 * proxy body per pin keeps a second 线上对话 open off the daemon
 * entirely (and lets the response always advertise a browser max-age).
 */
import { extractAvatarPinReference } from './avatar-url.js'

export const AVATAR_PROXY_CACHE_TTL_MS = 30 * 60 * 1000
export const AVATAR_BROWSER_CACHE_MAX_AGE = 30 * 60

type AvatarProxyCacheEntry = {
  body: Buffer
  contentType: string
  expiresAt: number
}

const avatarProxyCache = new Map<string, AvatarProxyCacheEntry>()

/** Stable cache key: bare pin id when the ref is a pin, otherwise the trimmed raw. */
export function avatarProxyCacheKey(ref: string): string {
  const pin = extractAvatarPinReference(ref)
  if (!pin) return ref.trim()
  return pin.replace(/^metafile:\/\//iu, '')
}

export function getAvatarProxyCache(ref: string): { body: Buffer; contentType: string } | null {
  const key = avatarProxyCacheKey(ref)
  if (!key) return null
  const entry = avatarProxyCache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    avatarProxyCache.delete(key)
    return null
  }
  return { body: entry.body, contentType: entry.contentType }
}

export function setAvatarProxyCache(ref: string, body: Buffer, contentType: string): void {
  const key = avatarProxyCacheKey(ref)
  if (!key || body.length === 0) return
  avatarProxyCache.set(key, {
    body,
    contentType,
    expiresAt: Date.now() + AVATAR_PROXY_CACHE_TTL_MS,
  })
}

export function clearAvatarProxyCache(): void {
  avatarProxyCache.clear()
}
