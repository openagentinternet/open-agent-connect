import assert from 'node:assert/strict'
import test from 'node:test'

const plugin = await import('../lib/index.js')

test('bots/wallet spawns bot wallet --from <slug>', async () => {
  const calls = []
  const result = await plugin.dispatchBotAdvancedRoutes('bots/wallet', { slug: 'alice' }, async (args) => {
    calls.push(args)
    return { ok: true, state: 'success', data: { wallet: { addresses: {}, balances: {} } } }
  })
  assert.equal(result.ok, true)
  assert.deepEqual(calls, [['bot', 'wallet', '--from', 'alice']])
})

test('bots/wallet rejects a missing slug without spawning the CLI', async () => {
  const calls = []
  const result = await plugin.dispatchBotAdvancedRoutes('bots/wallet', {}, async (args) => {
    calls.push(args)
    return { ok: true, state: 'success' }
  })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'missing_slug')
  assert.deepEqual(calls, [])
})

test('bots/backup spawns bot backup --from <slug>', async () => {
  const calls = []
  const result = await plugin.dispatchBotAdvancedRoutes('bots/backup', { slug: 'alice' }, async (args) => {
    calls.push(args)
    return { ok: true, state: 'success', data: { backup: { slug: 'alice', name: 'Alice', words: ['w1', 'w2'] } } }
  })
  assert.equal(result.ok, true)
  assert.deepEqual(calls, [['bot', 'backup', '--from', 'alice']])
})

test('bots/backup rejects a missing slug without spawning the CLI', async () => {
  const calls = []
  const result = await plugin.dispatchBotAdvancedRoutes('bots/backup', { slug: '  ' }, async (args) => {
    calls.push(args)
    return { ok: true, state: 'success' }
  })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'missing_slug')
  assert.deepEqual(calls, [])
})

test('bots/homepage-upload validates slug and base64 before touching the daemon', async () => {
  const uploads = []
  const upload = async (...args) => {
    uploads.push(args)
    return { ok: true, state: 'success', data: {} }
  }
  const missingSlug = await plugin.dispatchBotAdvancedRoutes(
    'bots/homepage-upload',
    { base64: Buffer.from('hi').toString('base64') },
    undefined,
    upload,
  )
  assert.equal(missingSlug.code, 'missing_slug')
  const missingFile = await plugin.dispatchBotAdvancedRoutes('bots/homepage-upload', { slug: 'alice' }, undefined, upload)
  assert.equal(missingFile.code, 'missing_file')
  const emptyFile = await plugin.dispatchBotAdvancedRoutes(
    'bots/homepage-upload',
    { slug: 'alice', base64: Buffer.from('').toString('base64') || ' ' },
    undefined,
    upload,
  )
  assert.equal(emptyFile.code, 'missing_file')
  assert.deepEqual(uploads, [])
})

test('bots/homepage-upload decodes base64 and forwards raw bytes to the daemon route', async () => {
  const uploads = []
  const result = await plugin.dispatchBotAdvancedRoutes(
    'bots/homepage-upload',
    { slug: 'alice', fileName: 'home.html', contentType: 'text/html', base64: Buffer.from('<html>hi</html>').toString('base64') },
    undefined,
    async (slug, fileName, contentType, bytes) => {
      uploads.push({ slug, fileName, contentType, bytes })
      return { ok: true, state: 'success', data: { metafileUri: 'metafile://' + 'aa'.repeat(32) + 'i0.html' } }
    },
  )
  assert.equal(result.ok, true)
  assert.equal(uploads.length, 1)
  assert.equal(uploads[0].slug, 'alice')
  assert.equal(uploads[0].fileName, 'home.html')
  assert.equal(uploads[0].contentType, 'text/html')
  assert.equal(uploads[0].bytes.toString('utf8'), '<html>hi</html>')
  assert.equal(result.data.metafileUri, 'metafile://' + 'aa'.repeat(32) + 'i0.html')
})

test('bots/homepage-upload maps an unreachable daemon to daemon_unreachable', async () => {
  const result = await plugin.dispatchBotAdvancedRoutes(
    'bots/homepage-upload',
    { slug: 'alice', base64: Buffer.from('hi').toString('base64') },
    undefined,
    async () => null,
  )
  assert.equal(result.ok, false)
  assert.equal(result.code, 'daemon_unreachable')
})

test('bots/homepage-upload applies fileName/contentType defaults', async () => {
  const uploads = []
  await plugin.dispatchBotAdvancedRoutes(
    'bots/homepage-upload',
    { slug: 'alice', base64: Buffer.from('hi').toString('base64') },
    undefined,
    async (...args) => {
      uploads.push(args)
      return { ok: true, state: 'success', data: {} }
    },
  )
  assert.equal(uploads[0][1], 'homepage-upload.bin')
  assert.equal(uploads[0][2], 'application/octet-stream')
})

test('unknown bot-advanced method returns undefined so dispatchPost keeps routing', async () => {
  const result = await plugin.dispatchBotAdvancedRoutes('bots/list', {})
  assert.equal(result, undefined)
})
