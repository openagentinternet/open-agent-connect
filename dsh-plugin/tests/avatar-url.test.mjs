import assert from 'node:assert/strict'
import test from 'node:test'

const plugin = await import('../lib/index.js')

const PIN_ID = 'a'.repeat(64)

test('resolveAvatarUrl passes data/blob/http(s) URLs through', () => {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
  assert.equal(plugin.resolveAvatarUrl(dataUrl), dataUrl)
  assert.equal(plugin.resolveAvatarUrl('blob:https://example.com/x'), 'blob:https://example.com/x')
  assert.equal(plugin.resolveAvatarUrl('https://cdn.example.com/a.png'), 'https://cdn.example.com/a.png')
})

test('resolveAvatarUrl routes pin references through the daemon avatar proxy', () => {
  assert.equal(
    plugin.resolveAvatarUrl(PIN_ID),
    `/oac/api/file/avatar?ref=${encodeURIComponent(PIN_ID)}`,
  )
  assert.equal(
    plugin.resolveAvatarUrl(`metafile://${PIN_ID}i0`),
    `/oac/api/file/avatar?ref=${encodeURIComponent(`metafile://${PIN_ID}i0`)}`,
  )
  assert.equal(
    plugin.resolveAvatarUrl(`/content/${PIN_ID}i0`),
    `/oac/api/file/avatar?ref=${encodeURIComponent(`${PIN_ID}i0`)}`,
  )
  assert.equal(
    plugin.resolveAvatarUrl(`https://file.metaid.io/metafile-indexer/content/${PIN_ID}`),
    `/oac/api/file/avatar?ref=${encodeURIComponent(PIN_ID)}`,
  )
})

test('resolveAvatarUrl collapses empty content markers and unusable values to undefined', () => {
  assert.equal(plugin.resolveAvatarUrl(''), undefined)
  assert.equal(plugin.resolveAvatarUrl(null), undefined)
  assert.equal(plugin.resolveAvatarUrl(undefined), undefined)
  assert.equal(plugin.resolveAvatarUrl('/content/'), undefined)
  assert.equal(plugin.resolveAvatarUrl('not-an-avatar'), undefined)
})

test('extractAvatarPinReference reads every reference form', () => {
  assert.equal(plugin.extractAvatarPinReference(PIN_ID), PIN_ID)
  assert.equal(plugin.extractAvatarPinReference(`${PIN_ID}i1`), `${PIN_ID}i1`)
  assert.equal(plugin.extractAvatarPinReference(`metafile://${PIN_ID}i0`), `metafile://${PIN_ID}i0`)
  assert.equal(plugin.extractAvatarPinReference(`/metafile-indexer/thumbnail/${PIN_ID}?x=1`), PIN_ID)
  assert.equal(plugin.extractAvatarPinReference('https://example.com/a.png'), '')
})

test('avatar proxy cache keys pin aliases together and expires', () => {
  plugin.clearAvatarProxyCache()
  const body = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  assert.equal(plugin.avatarProxyCacheKey(PIN_ID), PIN_ID)
  assert.equal(plugin.avatarProxyCacheKey(`/content/${PIN_ID}`), PIN_ID)
  assert.equal(plugin.avatarProxyCacheKey(`metafile://${PIN_ID}i0`), `${PIN_ID}i0`)
  assert.equal(plugin.getAvatarProxyCache(PIN_ID), null)
  plugin.setAvatarProxyCache(`/content/${PIN_ID}`, body, 'image/png')
  const hit = plugin.getAvatarProxyCache(PIN_ID)
  assert.ok(hit)
  assert.equal(hit.contentType, 'image/png')
  assert.deepEqual([...hit.body], [...body])
  plugin.clearAvatarProxyCache()
  assert.equal(plugin.getAvatarProxyCache(PIN_ID), null)
})

test('avatar proxy and BotAvatar prefer a local cache over a fresh proxy hop', async () => {
  const { readFile } = await import('node:fs/promises')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const bridge = await readFile(join(root, 'src/conversation-bridge.ts'), 'utf8')
  assert.match(bridge, /getAvatarProxyCache\(ref\)/)
  assert.match(bridge, /setAvatarProxyCache\(ref, body, contentType\)/)
  assert.match(bridge, /cache-control': `public, max-age=\$\{AVATAR_BROWSER_CACHE_MAX_AGE\}/)
  const avatar = await readFile(join(root, 'src/client/BotAvatar.tsx'), 'utf8')
  assert.match(avatar, /peekCachedAvatarSrc/)
  assert.match(avatar, /loadCachedAvatarSrc/)
  assert.match(avatar, /loading = 'eager'/)
  const cache = await readFile(join(root, 'src/client/avatar-cache.ts'), 'utf8')
  assert.match(cache, /caches\.open\(CACHE_NAME\)/)
  assert.match(cache, /prefetchAvatars/)
})
