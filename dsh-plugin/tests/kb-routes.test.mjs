import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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

test('kb/list and kb/query forward to the knowledge-base CLI verbs', async () => {
  const list = await capture('kb/list', { from: 'alice' })
  assert.equal(list.result.ok, true)
  assert.deepEqual(list.calls[0], ['knowledge-base', 'list', '--from', 'alice'])

  const query = await capture('kb/query', { from: 'alice', text: '民法 合同', id: 'kb1', topK: 3, minScore: 0.3 })
  assert.equal(query.result.ok, true)
  const args = query.calls[0]
  assert.deepEqual(args.slice(0, 4), ['knowledge-base', 'query', '--from', 'alice'])
  assert.ok(args.includes('--text') && args.includes('民法 合同'))
  assert.ok(args.includes('--id') && args.includes('kb1'))
  assert.ok(args.includes('--top-k') && args.includes('3'))
  assert.ok(args.includes('--min-score') && args.includes('0.3'))
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

test('kb/add-document inlines small bodies and temp-files large ones', async () => {
  const small = await capture('kb/add-document', {
    from: 'alice',
    id: 'kb1',
    title: 'Tea guide',
    content: 'short body',
    sourceType: 'metaweb',
    pinId: 'p1',
    tags: ['tea', 'howto'],
  })
  const smallArgs = small.calls[0]
  assert.ok(smallArgs.includes('--title') && smallArgs.includes('Tea guide'))
  assert.ok(smallArgs.includes('--content') && smallArgs.includes('short body'))
  assert.ok(smallArgs.includes('--source-type') && smallArgs.includes('metaweb'))
  assert.ok(smallArgs.includes('--pin-id') && smallArgs.includes('p1'))
  assert.ok(smallArgs.includes('--tags') && smallArgs.includes('tea,howto'))

  // The route deletes the temp file after the CLI run, so read the body
  // inside the mocked run (exactly what the real CLI would do).
  const big = await capture('kb/add-document', { from: 'alice', title: 'Big', content: 'x'.repeat(20_000) },
    async (args) => {
      const flagIdx = args.indexOf('--content-file')
      const file = flagIdx >= 0 ? args[flagIdx + 1] : null
      const body = file ? await readFile(file, 'utf8') : null
      return { ok: true, state: 'success', data: { args, body } }
    })
  assert.ok(big.result.data.args.includes('--content-file'), 'large body rides a temp file, not argv')
  assert.equal(big.result.data.body.length, 20_000)
})

test('kb/learn passes the id and full flags; missing from fails fast', async () => {
  const learn = await capture('kb/learn', { from: 'alice', id: 'kb1', full: true })
  assert.deepEqual(learn.calls[0], ['knowledge-base', 'learn', '--from', 'alice', '--id', 'kb1', '--full'])

  const learnDefault = await capture('kb/learn', { from: 'alice' })
  assert.deepEqual(learnDefault.calls[0], ['knowledge-base', 'learn', '--from', 'alice'])

  const missing = await capture('kb/list', {})
  assert.equal(missing.result.ok, false)
  assert.equal(missing.result.code, 'missing_from')
  assert.equal(missing.calls.length, 0)

  const unknown = await capture('kb/unknown', { from: 'alice' })
  assert.equal(unknown.result, undefined, 'non-kb methods fall through')
})

test('study/list falls back to an explicit failure without local read', async () => {
  const { result } = await capture('study/list', { from: 'alice' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'study_unavailable')
})
