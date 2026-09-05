import assert from 'node:assert/strict'
import test from 'node:test'

// These tests assert the CLI verb mapping through the mocked `run`; disable
// the in-process local-read fast path so every route exercises the CLI path.
process.env.OAC_DSH_NO_LOCAL_READ = '1'

const plugin = await import('../lib/index.js')

async function capture(method, payload, run) {
  const calls = []
  const result = await plugin.dispatchKbRoutes(method, payload, {
    run: run ?? (async (args) => {
      calls.push(args)
      return { ok: true, state: 'success', data: { args } }
    }),
  })
  return { result, calls }
}

test('kb/list forwards to the knowledge-base CLI; learn passes id/full flags', async () => {
  const list = await capture('kb/list', { from: 'alice' })
  assert.equal(list.result.ok, true)
  assert.deepEqual(list.calls[0], ['knowledge-base', 'list', '--from', 'alice'])

  const learn = await capture('kb/learn', { from: 'alice', id: 'kb1', full: true })
  assert.deepEqual(learn.calls[0], ['knowledge-base', 'learn', '--from', 'alice', '--id', 'kb1', '--full'])

  const learnDefault = await capture('kb/learn', { from: 'alice' })
  assert.deepEqual(learnDefault.calls[0], ['knowledge-base', 'learn', '--from', 'alice'])
})

test('kb create/update/remove map flags; remove is confirm-gated at the CLI', async () => {
  const create = await capture('kb/create', { from: 'alice', name: 'Law', description: '法规', autoLearn: false })
  const createArgs = create.calls[0]
  assert.ok(createArgs.includes('--name') && createArgs.includes('Law'))
  assert.ok(createArgs.includes('--description') && createArgs.includes('法规'))
  assert.ok(createArgs.includes('--autolearn') && createArgs.includes('off'))

  const update = await capture('kb/update', { from: 'alice', id: 'kb1', autoLearn: true })
  assert.ok(update.calls[0].includes('--id') && update.calls[0].includes('kb1'))
  assert.ok(update.calls[0].includes('--autolearn') && update.calls[0].includes('on'))

  const remove = await capture('kb/remove', { from: 'alice', id: 'kb1' })
  assert.deepEqual(remove.calls[0], ['knowledge-base', 'remove', '--from', 'alice', '--id', 'kb1', '--confirm'])
})

test('kb/import without a local profile fails explicitly; non-kb methods fall through', async () => {
  const result = await plugin.importKbFile('nobody-here', 'kb1', 'doc.md', Buffer.from('x'))
  assert.equal(result.ok, false)
  assert.equal(result.code, 'kb_unavailable')

  const unknown = await capture('kb/unknown', { from: 'alice' })
  assert.equal(unknown.result, undefined, 'non-kb methods fall through')

  const missing = await capture('kb/list', {})
  assert.equal(missing.result.ok, false)
  assert.equal(missing.result.code, 'missing_from')
  assert.equal(missing.calls.length, 0)
})

test('study/list falls back to an explicit failure without local read', async () => {
  const { result } = await capture('study/list', { from: 'alice' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'study_unavailable')
})
