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
