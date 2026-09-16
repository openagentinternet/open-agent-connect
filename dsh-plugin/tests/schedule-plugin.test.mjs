// Scheduled-task host routes — CLI forwarding shapes for the A2A panel's
// "Scheduled" tab.
import assert from 'node:assert/strict'
import test from 'node:test'

const plugin = await import('../lib/index.js')

const { dispatchScheduleRoutes } = plugin

function resultOf(ok, data) {
  return { ok, state: ok ? 'success' : 'failed', ...(data !== undefined ? { data } : {}) }
}

test('schedule routes forward to the metabot schedule CLI verbs', async () => {
  const calls = []
  const run = async (args) => {
    calls.push(args)
    return resultOf(true, { ok: true })
  }

  const list = await dispatchScheduleRoutes('schedule/list', { from: 'alice' }, { run })
  assert.equal(list.ok, true)
  assert.deepEqual(calls[0], ['schedule', 'list', '--from', 'alice'])

  await dispatchScheduleRoutes('schedule/runs', { from: 'alice', id: 't1', limit: 10 }, { run })
  assert.deepEqual(calls[1], ['schedule', 'runs', '--from', 'alice', '--id', 't1', '--limit', '10'])

  await dispatchScheduleRoutes('schedule/enable', { from: 'alice', id: 't1' }, { run })
  assert.deepEqual(calls[2], ['schedule', 'enable', '--from', 'alice', '--id', 't1'])

  await dispatchScheduleRoutes('schedule/disable', { from: 'alice', id: 't1' }, { run })
  assert.deepEqual(calls[3], ['schedule', 'disable', '--from', 'alice', '--id', 't1'])
})

test('schedule routes reject missing ids before any CLI call; run never spawns without id', async () => {
  const calls = []
  const run = async (args) => {
    calls.push(args)
    return resultOf(true)
  }
  for (const method of ['schedule/runs', 'schedule/enable', 'schedule/disable', 'schedule/run']) {
    const result = await dispatchScheduleRoutes(method, { from: 'alice' }, { run })
    assert.equal(result.ok, false, method)
    assert.equal(result.code, 'missing_id', method)
  }
  assert.equal(calls.length, 0)
})

test('schedule create/update/delete forward with validated shapes', async () => {
  const calls = []
  const payloads = []
  const run = async (args) => {
    calls.push(args)
    // The payload helper deletes its temp file after run() returns, so the
    // content must be captured here.
    const flagIndex = args.indexOf('--payload-file')
    if (flagIndex >= 0) {
      const raw = await (await import('node:fs/promises')).readFile(args[flagIndex + 1], 'utf8')
      payloads.push(JSON.parse(raw))
    }
    return resultOf(true, { task: { id: 't1' } })
  }

  // create: flags form; interval carries everyMs; unknown channel refused.
  await dispatchScheduleRoutes('schedule/create', {
    from: 'alice', name: 'n', prompt: 'p', everyMs: 3_600_000, channel: 'auto',
  }, { run })
  assert.deepEqual(calls[0], ['schedule', 'create', '--from', 'alice', '--name', 'n', '--prompt', 'p', '--every', '3600000', '--channel', 'auto'])
  await dispatchScheduleRoutes('schedule/create', { from: 'alice', name: 'n', prompt: 'p', at: '2026-09-16T09:00', enabled: false }, { run })
  assert.deepEqual(calls[1], ['schedule', 'create', '--from', 'alice', '--name', 'n', '--prompt', 'p', '--at', '2026-09-16T09:00', '--disabled'])
  const twoSelectors = await dispatchScheduleRoutes('schedule/create', {
    from: 'alice', name: 'n', prompt: 'p', at: 'x', cron: 'y',
  }, { run })
  assert.equal(twoSelectors.ok, false)
  const badChannel = await dispatchScheduleRoutes('schedule/create', {
    from: 'alice', name: 'n', prompt: 'p', cron: '* * * * *', channel: 'evil',
  }, { run })
  assert.equal(badChannel.ok, false)
  const missingName = await dispatchScheduleRoutes('schedule/create', { from: 'alice', prompt: 'p', cron: '* * * * *' }, { run })
  assert.equal(missingName.ok, false)

  // update: partial payload file carries ONLY the changed fields.
  const updated = await dispatchScheduleRoutes('schedule/update', {
    from: 'alice', id: 't1', name: 'renamed', at: '2026-09-17T08:00',
  }, { run })
  assert.equal(updated.ok, true)
  const updateArgs = calls[calls.length - 1]
  assert.equal(updateArgs[0], 'schedule')
  assert.equal(updateArgs[1], 'update')
  assert.equal(updateArgs[2], '--from')
  assert.equal(updateArgs[3], 'alice')
  assert.equal(updateArgs[4], '--id')
  assert.equal(updateArgs[5], 't1')
  assert.equal(updateArgs[6], '--payload-file')
  assert.deepEqual(payloads[payloads.length - 1], { name: 'renamed', schedule: { type: 'at', datetime: '2026-09-17T08:00' } })
  const emptyPatch = await dispatchScheduleRoutes('schedule/update', { from: 'alice', id: 't1' }, { run })
  assert.equal(emptyPatch.ok, false)

  // delete: carries --confirm.
  await dispatchScheduleRoutes('schedule/delete', { from: 'alice', id: 't1' }, { run })
  assert.deepEqual(calls[calls.length - 1], ['schedule', 'delete', '--from', 'alice', '--id', 't1', '--confirm'])
})

test('unknown methods keep dispatching', async () => {
  const run = async () => resultOf(true)
  assert.equal(await dispatchScheduleRoutes('schedule/nope', {}, { run }), undefined)
  assert.equal(await dispatchScheduleRoutes('surf/status', {}, { run }), undefined)
})
