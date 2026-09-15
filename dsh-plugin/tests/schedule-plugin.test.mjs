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

test('unknown methods keep dispatching', async () => {
  const run = async () => resultOf(true)
  assert.equal(await dispatchScheduleRoutes('schedule/nope', {}, { run }), undefined)
  assert.equal(await dispatchScheduleRoutes('surf/status', {}, { run }), undefined)
})
