import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const plugin = await import('../lib/index.js')

async function capture(method, payload) {
  const calls = []
  const result = await plugin.dispatchSection(method, payload, async (args) => {
    calls.push(args)
    const fileFlag = args.includes('--request-file') ? '--request-file' : args.includes('--payload-file') ? '--payload-file' : null
    let file
    if (fileFlag) {
      const path = args[args.indexOf(fileFlag) + 1]
      file = JSON.parse(await readFile(path, 'utf8'))
    }
    return { ok: true, state: 'success', data: { args, file } }
  })
  return { result, calls }
}

test('chat private requires from, to, and content before spawning CLI', async () => {
  const missing = await capture('chat/private', { to: 'idq', content: 'hi' })
  assert.equal(missing.calls.length, 0)
  assert.equal(missing.result.code, 'missing_from')
  const sent = await capture('chat/private', { from: 'alice', to: 'idq1peer', content: 'hello' })
  assert.equal(sent.calls.length, 1)
  assert.deepEqual(sent.calls[0].slice(0, 4), ['chat', 'private', '--from', 'alice'])
  assert.equal(sent.calls[0].includes('--request-file'), true)
})

test('services publish and revoke refuse to spawn without confirm', async () => {
  const publish = await capture('services/publish', {
    from: 'alice',
    payload: { serviceName: 'weather', displayName: 'Weather' },
  })
  assert.equal(publish.calls.length, 0)
  assert.equal(publish.result.code, 'confirmation_required')
  const revoke = await capture('services/owned/revoke', { from: 'alice', serviceId: 'pin1' })
  assert.equal(revoke.calls.length, 0)
  assert.equal(revoke.result.code, 'confirmation_required')
})

test('services publish with confirm writes the payload file', async () => {
  const { result, calls } = await capture('services/publish', {
    from: 'alice',
    confirm: true,
    payload: { serviceName: 'weather', displayName: 'Weather', price: '0' },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(calls[0].slice(0, 4), ['services', 'publish', '--from', 'alice'])
  assert.equal(result.data.file.serviceName, 'weather')
})

test('services call sets confirmed only after UI confirm', async () => {
  const preview = await capture('services/call', {
    from: 'alice',
    request: { servicePinId: 'pin', providerGlobalMetaId: 'idq', userTask: 'hi' },
  })
  assert.equal(preview.result.data.file.confirmed, undefined)
  const paid = await capture('services/call', {
    from: 'alice',
    confirm: true,
    request: { servicePinId: 'pin', providerGlobalMetaId: 'idq', userTask: 'hi' },
  })
  assert.equal(paid.result.data.file.confirmed, true)
})

test('metaapp delete and publish require confirm and pass --confirm to CLI', async () => {
  const blocked = await capture('metaapp/delete', { from: 'alice', targetPinId: 'aa'.repeat(32) + 'i0' })
  assert.equal(blocked.calls.length, 0)
  assert.equal(blocked.result.code, 'confirmation_required')
  const deleted = await capture('metaapp/delete', {
    from: 'alice',
    targetPinId: 'ab'.repeat(32) + 'i0',
    confirm: true,
  })
  assert.ok(deleted.calls[0].includes('--confirm'))
  const published = await capture('metaapp/publish', {
    from: 'alice',
    confirm: true,
    payload: { appName: 'desk', title: 'Desk', content: 'metafile://' + 'aa'.repeat(32) + 'i0' },
  })
  assert.ok(published.calls[0].includes('--confirm'))
  assert.equal(published.calls[0].includes('--payload-file'), true)
})

test('metaapp list passes --size and --cursor when provided', async () => {
  const plain = await capture('metaapp/list', { from: 'alice' })
  assert.deepEqual(plain.calls[0], ['metaapp', 'list', '--from', 'alice', '--size', '12'])
  const paged = await capture('metaapp/list', { from: 'alice', size: 20, cursor: 'abc123' })
  assert.deepEqual(paged.calls[0], ['metaapp', 'list', '--from', 'alice', '--size', '20', '--cursor', 'abc123'])
  const badSize = await capture('metaapp/list', { from: 'alice', size: 'not-a-number' })
  assert.deepEqual(badSize.calls[0], ['metaapp', 'list', '--from', 'alice', '--size', '12'])
})

test('metaapp update requires confirm and targetPinId, then writes the payload file', async () => {
  const unconfirmed = await capture('metaapp/update', {
    from: 'alice',
    targetPinId: 'aa'.repeat(32) + 'i0',
    payload: { appName: 'desk' },
  })
  assert.equal(unconfirmed.calls.length, 0)
  assert.equal(unconfirmed.result.code, 'confirmation_required')
  const noTarget = await capture('metaapp/update', { from: 'alice', confirm: true, payload: { appName: 'desk' } })
  assert.equal(noTarget.calls.length, 0)
  assert.equal(noTarget.result.code, 'missing_target_pin_id')
  const updated = await capture('metaapp/update', {
    from: 'alice',
    confirm: true,
    targetPinId: 'ab'.repeat(32) + 'i0',
    payload: { appName: 'desk', title: 'Desk', content: 'metafile://' + 'aa'.repeat(32) + 'i0' },
  })
  assert.ok(updated.calls[0].includes('--confirm'))
  assert.ok(updated.calls[0].includes('--target-pin-id'))
  assert.ok(updated.calls[0].includes('--payload-file'))
  assert.equal(updated.result.data.file.appName, 'desk')
})

test('uploadFileBytes hands raw bytes to file upload-large and cleans up the temp file', async () => {
  const calls = []
  const result = await plugin.uploadFileBytes('alice', Buffer.from('hello world'), 'text/plain', async (args) => {
    calls.push(args)
    return { ok: true, state: 'success', data: { metafileUri: 'metafile://' + 'aa'.repeat(32) + 'i0' } }
  })
  assert.equal(result.ok, true)
  assert.equal(result.data.metafileUri, 'metafile://' + 'aa'.repeat(32) + 'i0')
  assert.deepEqual(calls[0].slice(0, 5), ['file', 'upload-large', '--from', 'alice', '--file'])
  assert.deepEqual(calls[0].slice(-2), ['--content-type', 'text/plain'])
  const fileFlag = calls[0].indexOf('--file')
  const tempPath = calls[0][fileFlag + 1]
  assert.equal(typeof tempPath, 'string')
  assert.ok(tempPath.startsWith(join(tmpdir(), 'oac-dsh-upload-')))
  await assert.rejects(access(tempPath))
})

test('unknown section method returns undefined so bots routes stay on dispatchPost', async () => {
  const result = await plugin.dispatchSection('bots/list', {})
  assert.equal(result, undefined)
})
