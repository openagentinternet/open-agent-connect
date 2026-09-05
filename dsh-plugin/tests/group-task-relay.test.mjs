process.env.OAC_DSH_NO_LOCAL_READ = '1'

import assert from 'node:assert/strict'
import test from 'node:test'

const plugin = await import('../lib/index.js')

function fakeCtx() {
  const preStepHandlers = []
  return {
    preStepHandlers,
    ctx: {
      on: (event, handler) => {
        if (event === 'agent/pre-step') preStepHandlers.push(handler)
      },
    },
  }
}

function row(overrides = {}) {
  return {
    id: 1, taskId: 42, groupId: 'grp-1', sessionId: 'sess-origin',
    kind: 'review', title: '发布 MetaApp', text: 'The task awaits acceptance.',
    createdAt: Date.now(), chairSlug: 'bob', ...overrides,
  }
}

async function preStepThrough(handler, agent) {
  return handler(
    { agent, messages: [], turn: 1, step: 1 },
    async () => ({ kind: 'enter', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }),
  )
}

test('relay drain delivers into the live origin session exactly once', async () => {
  const rows = [row(), row({ id: 2, kind: 'dispatch', text: 'Work is underway.' })]
  const { ctx } = fakeCtx()
  const delivered = []
  plugin.liveOacAgents.set('bob', {
    ctx: {},
    session: { id: 'sess-origin' },
    followup: (message) => delivered.push(message),
  })
  const drainer = plugin.applyGroupTaskRelayDrain(ctx, { daemonAlive: async () => true, run: async () => ({ ok: true, data: { relayed: rows } }) })
  const count = await drainer.drainOnce()
  assert.equal(count, 2)
  assert.equal(delivered.length, 2)
  assert.match(delivered[0].content[0].text, /\[Group Task\] 发布 MetaApp/)
  assert.match(delivered[0].content[0].text, /awaits acceptance/)
  assert.equal(delivered[0].source.form, 'group-task-relay')
  // Re-draining the same rows cannot double-deliver.
  await drainer.drainOnce()
  assert.equal(delivered.length, 2)
  plugin.liveOacAgents.delete('bob')
  drainer.stop()
})

test('relay rows for closed sessions wait and inject on the next turn', async () => {
  const { ctx, preStepHandlers } = fakeCtx()
  const drainer = plugin.applyGroupTaskRelayDrain(ctx, { daemonAlive: async () => true, run: async () => ({ ok: true, data: { relayed: [row()] } }) })
  await drainer.drainOnce()

  assert.equal(preStepHandlers.length, 1, 'pre-step waterfall mounted')
  const handler = preStepHandlers[0]
  const decision = await preStepThrough(handler, { session: { id: 'sess-origin' } })
  assert.equal(decision.messages.length, 2, 'relay block appended after the user message')
  assert.match(decision.messages[1].content[0].text, /\[Group Task\] 发布 MetaApp/)

  // The pending block is consumed: the following turn gets nothing.
  const second = await preStepThrough(handler, { session: { id: 'sess-origin' } })
  assert.equal(second.messages.length, 1)
  drainer.stop()
})

test('relay drain survives CLI failures and ignores foreign sessions', async () => {
  const { ctx, preStepHandlers } = fakeCtx()
  let fail = true
  const drainer = plugin.applyGroupTaskRelayDrain(ctx, {
    daemonAlive: async () => true,
    run: async () => (fail ? { ok: false, code: 'daemon_down' } : { ok: true, data: { relayed: [row()] } }),
  })
  assert.equal(await drainer.drainOnce(), 0, 'CLI failure drains nothing')
  fail = false
  assert.equal(await drainer.drainOnce(), 1)
  const decision = await preStepThrough(preStepHandlers[0], { session: { id: 'sess-other' } })
  assert.equal(decision.messages.length, 1, 'a foreign session receives nothing')
  drainer.stop()
})
