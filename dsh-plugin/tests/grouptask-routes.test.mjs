import assert from 'node:assert/strict'
import test from 'node:test'

const plugin = await import('../lib/index.js')

async function capture(method, payload) {
  const calls = []
  const result = await plugin.dispatchGroupTaskRoutes(method, payload, {
    run: async (args, options) => {
      calls.push({ args, options })
      return { ok: true, state: 'success', data: { args } }
    },
  })
  return { result, calls }
}

test('non-grouptask methods fall through as undefined', async () => {
  const result = await plugin.dispatchGroupTaskRoutes('memory/list', {}, { run: async () => ({ ok: true }) })
  assert.equal(result, undefined)
})

test('grouptask/create maps payload to CLI flags with a long write timeout', async () => {
  const { result, calls } = await capture('grouptask/create', {
    title: 'Haiku sprint',
    goal: 'One haiku',
    acceptanceCriteria: '5-7-5',
    workerSlugs: ['alice', 'bob'],
    chairSlug: 'twin',
  })
  assert.equal(result.ok, true)
  const { args, options } = calls[0]
  assert.deepEqual(args.slice(0, 2), ['grouptask', 'create'])
  assert.equal(args[args.indexOf('--title') + 1], 'Haiku sprint')
  assert.equal(args[args.indexOf('--workers') + 1], 'alice,bob')
  assert.equal(args[args.indexOf('--chair') + 1], 'twin')
  assert.ok(options.timeoutMs >= 120_000, 'creation waits on chain writes and indexing')

  const missing = await capture('grouptask/create', { goal: 'g' })
  assert.equal(missing.result.ok, false)
  assert.equal(missing.result.code, 'missing_title')
})

test('grouptask/list and detail map tab/view/sync flags', async () => {
  const list = await capture('grouptask/list', { tab: 'active', includeArchived: true })
  assert.ok(list.calls[0].args.includes('--tab'))
  assert.ok(list.calls[0].args.includes('--include-archived'))

  const detail = await capture('grouptask/detail', { chair: 'twin', taskId: 3, view: 'summary', sync: false })
  const args = detail.calls[0].args
  assert.deepEqual(args.slice(0, 2), ['grouptask', 'detail'])
  assert.equal(args[args.indexOf('--task') + 1], '3')
  assert.ok(args.includes('--no-sync'))

  const badRef = await capture('grouptask/detail', { chair: 'twin' })
  assert.equal(badRef.result.code, 'missing_task_id')
})

test('grouptask/post maps sender selection and rejects conflicts', async () => {
  const asOwner = await capture('grouptask/post', {
    chair: 'twin', taskId: 1, content: 'hi', asOwner: true, mention: ['id1', 'id2'],
  })
  const args = asOwner.calls[0].args
  assert.ok(args.includes('--as-owner'))
  assert.equal(args[args.indexOf('--mention') + 1], 'id1,id2')

  const conflict = await capture('grouptask/post', {
    chair: 'twin', taskId: 1, content: 'hi', asOwner: true, asSlug: 'alice',
  })
  assert.equal(conflict.result.code, 'conflicting_sender')

  const noContent = await capture('grouptask/post', { chair: 'twin', taskId: 1 })
  assert.equal(noContent.result.code, 'missing_content')
})

test('grouptask/close validates outcome and forwards rating', async () => {
  const ok = await capture('grouptask/close', {
    chair: 'twin', taskId: 1, outcome: 'done', rating: 5, ratingComment: 'nice',
  })
  const args = ok.calls[0].args
  assert.equal(args[args.indexOf('--outcome') + 1], 'done')
  assert.equal(args[args.indexOf('--rating') + 1], '5')

  const bad = await capture('grouptask/close', { chair: 'twin', taskId: 1, outcome: 'finished' })
  assert.equal(bad.result.code, 'invalid_outcome')
})

test('grouptask/kick and member-status require a member reference', async () => {
  const kick = await capture('grouptask/kick', { chair: 'twin', taskId: 1, slug: 'alice', reason: 'idle' })
  assert.equal(kick.calls[0].args[kick.calls[0].args.indexOf('--member') + 1], 'alice')

  const remote = await capture('grouptask/kick', { chair: 'twin', taskId: 1, globalMetaId: 'IDX' })
  assert.ok(remote.calls[0].args.includes('--global-metaid'))

  const missing = await capture('grouptask/kick', { chair: 'twin', taskId: 1 })
  assert.equal(missing.result.code, 'missing_member')

  const status = await capture('grouptask/member-status', {
    chair: 'twin', taskId: 1, slug: 'alice', status: 'working',
  })
  assert.equal(status.calls[0].args[status.calls[0].args.indexOf('--status') + 1], 'working')
})

test('grouptask pin/archive toggle to their inverse verbs', async () => {
  const pin = await capture('grouptask/pin', { chair: 'twin', taskId: 1, pinned: true })
  assert.equal(pin.calls[0].args[1], 'pin')
  const unpin = await capture('grouptask/pin', { chair: 'twin', taskId: 1, pinned: false })
  assert.equal(unpin.calls[0].args[1], 'unpin')
  const archive = await capture('grouptask/archive', { chair: 'twin', taskId: 1, archived: true })
  assert.equal(archive.calls[0].args[1], 'archive')
  const unarchive = await capture('grouptask/archive', { chair: 'twin', taskId: 1, archived: false })
  assert.equal(unarchive.calls[0].args[1], 'unarchive')
})

test('grouptask/invite maps the OpenTeam invite flags with a write timeout', async () => {
  const ok = await capture('grouptask/invite', {
    chair: 'twin',
    taskId: 2,
    globalMetaId: 'IDREMOTE',
    name: 'Remote Poet',
    requiredSkills: ['poetry', 'zh'],
    allowReinvite: true,
  })
  const { args, options } = ok.calls[0]
  assert.deepEqual(args.slice(0, 2), ['grouptask', 'invite'])
  assert.equal(args[args.indexOf('--global-metaid') + 1], 'IDREMOTE')
  assert.equal(args[args.indexOf('--name') + 1], 'Remote Poet')
  assert.equal(args[args.indexOf('--skills') + 1], 'poetry,zh')
  assert.ok(args.includes('--allow-reinvite'))
  assert.ok(options.timeoutMs >= 120_000)

  const missing = await capture('grouptask/invite', { chair: 'twin', taskId: 2 })
  assert.equal(missing.result.code, 'missing_global_metaid')
})

test('grouptask collabs and collab-messages map guest-side reads', async () => {
  const collabs = await capture('grouptask/collabs', {})
  assert.deepEqual(collabs.calls[0].args, ['grouptask', 'collabs'])

  const messages = await capture('grouptask/collab-messages', { slug: 'worker-1', groupId: 'grp-9', limit: 50 })
  const args = messages.calls[0].args
  assert.deepEqual(args.slice(0, 2), ['grouptask', 'collab-messages'])
  assert.equal(args[args.indexOf('--bot') + 1], 'worker-1')
  assert.equal(args[args.indexOf('--group') + 1], 'grp-9')
  assert.equal(args[args.indexOf('--limit') + 1], '50')

  const missing = await capture('grouptask/collab-messages', { slug: 'worker-1' })
  assert.equal(missing.result.code, 'missing_group_id')
})

test('unknown grouptask methods fail with not-found', async () => {
  const { result } = await capture('grouptask/bogus', {})
  assert.equal(result.ok, false)
  assert.equal(result.code, 'not-found')
})
