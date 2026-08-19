import assert from 'node:assert/strict'
import test from 'node:test'

const apps = await import('../lib/apps.js')

test('record helpers name, subtitle, and view pin id like the OAC page', () => {
  const record = {
    pinId: 'a'.repeat(64) + 'i3',
    firstPinId: 'b'.repeat(64) + 'i0',
    title: 'Desk',
    appName: 'desk',
    version: 'v1.0.0',
    runtime: 'browser/macOS',
  }
  assert.equal(apps.recordPinId(record), 'a'.repeat(64) + 'i3')
  assert.equal(apps.recordViewPinId(record), 'b'.repeat(64) + 'i0')
  assert.equal(apps.recordName(record, 'untitled'), 'Desk')
  assert.equal(apps.recordSubtitle(record), 'v1.0.0 / browser/macOS')
  assert.equal(apps.recordName({}, 'untitled'), 'untitled')
})

test('splitList and recordTags split on newlines and commas', () => {
  assert.deepEqual(apps.splitList('a, b\nc'), ['a', 'b', 'c'])
  assert.deepEqual(apps.recordTags({ tags: ['a', 'b', '', 'c'] }, 2), ['a', 'b'])
  assert.equal(apps.recordTags({}).length, 0)
})

test('bumpVersion increments the last numeric token', () => {
  assert.equal(apps.bumpVersion('v1.0.0'), 'v1.0.1')
  assert.equal(apps.bumpVersion('v9'), 'v10')
  assert.equal(apps.bumpVersion('v0.9'), 'v0.10')
  assert.equal(apps.bumpVersion('1.2.3-beta'), '1.2.4-beta')
})

test('normalizeMetafileReference canonicalizes pin references and rejects garbage', () => {
  const pin = 'a'.repeat(64) + 'i0'
  assert.equal(apps.normalizeMetafileReference(pin, 'content'), `metafile://${pin}`)
  assert.equal(apps.normalizeMetafileReference(`metafile://${pin}.zip`, 'content'), `metafile://${pin}.zip`)
  assert.throws(() => apps.normalizeMetafileReference('not-a-pin', 'content'), /pin id or a metafile/)
  assert.deepEqual(apps.normalizeMetafileList(`${pin}\n${'b'.repeat(64)}i0`, 'content'), [
    `metafile://${pin}`,
    `metafile://${'b'.repeat(64)}i0`,
  ])
})

test('normalizeImageReference keeps http(s) assets and pins pins', () => {
  const pin = 'a'.repeat(64) + 'i0'
  assert.equal(apps.normalizeImageReference('https://example.com/a.png', 'icon'), 'https://example.com/a.png')
  assert.equal(apps.normalizeImageReference(`metafile://${pin}`, 'icon'), `metafile://${pin}`)
})

test('normalizeRuntimeSelection defaults to browser and dedupes', () => {
  assert.deepEqual(apps.normalizeRuntimeSelection([]), ['browser'])
  assert.deepEqual(apps.normalizeRuntimeSelection(['browser', 'browser', 'android']), ['browser', 'android'])
  assert.deepEqual(apps.normalizeRuntimeSelection('browser/android'), ['browser', 'android'])
})

test('metadataFromInput parses and rejects non-objects', () => {
  assert.deepEqual(apps.metadataFromInput('{ "k": 1 }'), { k: 1 })
  assert.throws(() => apps.metadataFromInput('[1,2]'), /JSON object/)
})

test('uri helpers build share links from the record', () => {
  const record = { pinId: 'a'.repeat(64) + 'i0', firstPinId: 'b'.repeat(64) + 'i0' }
  assert.equal(apps.metaAppUriFor(record), `metaapp://${'b'.repeat(64)}i0`)
  assert.equal(apps.metaWebUrlFor(record), `https://openagentinternet.org/browser/metaapp/${'b'.repeat(64)}i0`)
  assert.equal(apps.runUrlFor(record), `https://openagentinternet.org/browser/metaapp/${'b'.repeat(64)}i0`)
})

test('formatTimestamp handles seconds and milliseconds', () => {
  assert.equal(apps.formatTimestamp(1_700_000_000), '2023-11-14T22:13:20.000Z')
  assert.equal(apps.formatTimestamp(1_700_000_000_000), '2023-11-14T22:13:20.000Z')
  assert.equal(apps.formatTimestamp(0), '-')
})

test('chainTxids collects txids from chainWrite and top-level rows', () => {
  const txid1 = 'c'.repeat(64)
  const txid2 = 'd'.repeat(64)
  const withChainWrite = { chainWrite: { txids: [txid1], txid: txid2 } }
  assert.deepEqual(apps.chainTxids(withChainWrite), [txid1, txid2])
  assert.deepEqual(apps.chainTxids({ txids: [txid1] }), [txid1])
  assert.deepEqual(apps.chainTxids({}), [])
})

test('displayValue handles arrays, objects, and scalars', () => {
  assert.equal(apps.displayValue(['a', 'b']), 'a\nb')
  assert.equal(apps.displayValue({ a: 1 }), '{\n  "a": 1\n}')
  assert.equal(apps.displayValue('x'), 'x')
  assert.equal(apps.displayValue(''), '-')
})
