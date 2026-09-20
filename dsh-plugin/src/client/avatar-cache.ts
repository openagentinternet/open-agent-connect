/**
 * Browser avatar cache for DSH conversation lists.
 *
 * Pin-reference avatars render through `/oac/api/file/avatar`, which is
 * slow on a cold daemon fetch. Remembering the bytes in a module-level
 * map (tab remounts stay instant) and the Cache API (survives reload)
 * lets 线上对话 paint peer faces from local cache on click.
 */
const CACHE_NAME = 'oac-dsh-avatars-v1'
const memory = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()

function isInlineAvatarSrc(url: string): boolean {
  return /^(data:|blob:)/iu.test(url)
}

/** Sync hit: inline URLs and already-decoded blob URLs. */
export function peekCachedAvatarSrc(url: string): string | undefined {
  if (!url) return undefined
  if (isInlineAvatarSrc(url)) return url
  return memory.get(url)
}

export function rememberCachedAvatarSrc(url: string, objectUrl: string): void {
  if (!url || !objectUrl) return
  memory.set(url, objectUrl)
}

async function openAvatarCache(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return null
    return await caches.open(CACHE_NAME)
  } catch {
    return null
  }
}

async function objectUrlFromResponse(url: string, response: Response): Promise<string> {
  const blob = await response.blob()
  if (blob.size === 0) throw new Error('empty avatar')
  const objectUrl = URL.createObjectURL(blob)
  rememberCachedAvatarSrc(url, objectUrl)
  return objectUrl
}

async function loadCachedAvatarSrcOnce(url: string): Promise<string> {
  const cached = peekCachedAvatarSrc(url)
  if (cached) return cached
  const cache = await openAvatarCache()
  const stored = cache ? await cache.match(url) : undefined
  if (stored?.ok) return objectUrlFromResponse(url, stored)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`avatar fetch ${response.status}`)
  if (cache) {
    try {
      await cache.put(url, response.clone())
    } catch {
      // Quota or opaque-response failures must not block the live image.
    }
  }
  return objectUrlFromResponse(url, response)
}

/** Resolve one avatar URL from memory, Cache API, then network. Dedupes inflight loads. */
export function loadCachedAvatarSrc(url: string): Promise<string> {
  if (!url) return Promise.reject(new Error('empty avatar url'))
  const cached = peekCachedAvatarSrc(url)
  if (cached) return Promise.resolve(cached)
  const pending = inflight.get(url)
  if (pending) return pending
  const next = loadCachedAvatarSrcOnce(url).finally(() => {
    inflight.delete(url)
  })
  inflight.set(url, next)
  return next
}

/** Fire-and-forget warm-up for a conversation-list paint. */
export function prefetchAvatars(urls: Array<string | undefined | null>): void {
  for (const url of urls) {
    if (url) void loadCachedAvatarSrc(url)
  }
}

export function resetAvatarMemoryCache(): void {
  for (const objectUrl of memory.values()) {
    if (objectUrl.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(objectUrl)
      } catch {
        // ignore
      }
    }
  }
  memory.clear()
  inflight.clear()
}
