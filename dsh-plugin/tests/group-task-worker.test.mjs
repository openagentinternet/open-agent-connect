process.env.OAC_DSH_NO_LOCAL_READ = '1'

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const plugin = await import('../lib/index.js')

function claim(overrides = {}) {
  return {
    requestId: 9,
    chairSlug: 'alice',
    taskId: 42,
    workerSlug: 'carol',
    workerName: 'Carol',
    targetPinId: 'pin-target',
    task: { title: '发布 MetaApp', goal: '上线并发布', acceptanceCriteria: '可打开', status: 'executing' },
    roster: [
      { name: 'Alice', role: 'chair', remote: false },
      { name: 'Carol', role: 'worker', remote: false },
    ],
    recentMessages: [{ index: 11, sender: 'Alice', content: '@Carol 请做封面' }],
    targetMessage: { index: 11, sender: 'Alice', content: '@Carol 请做封面' },
    ...overrides,
  }
}

function harness(options = {}) {
  const calls = []
  const created = []
  const submits = []
  const acks = []
  let claimResult = { ok: true, data: { request: options.claim === undefined ? claim() : options.claim } }
  const run = async (args) => {
    calls.push(args)
    if (args[0] === 'bot' && args[1] === 'show') {
      return { ok: true, state: 'success', data: { profile: { slug: 'carol', dshLlmProvider: 'deepseek', dshLlmModel: 'deepseek-chat' } } }
    }
    if (args[1] === 'post') {
      acks.push(args)
      return { ok: true, state: 'success', data: { pinId: 'pin-ack' } }
    }
    if (args[1] === 'work') {
      if (args[2] === 'claim') return claimResult
      if (args[2] === 'submit') {
        const file = args[args.indexOf('--payload-file') + 1]
        const payload = JSON.parse(await readFile(file, 'utf8'))
        submits.push(payload)
        return { ok: true, state: 'success', data: { status: 'completed', pinId: 'pin-reply' } }
      }
    }
    return { ok: true, state: 'success', data: {} }
  }
  const handoffText = options.handoffText === undefined ? '封面做好了 [DELIVERABLE] metaapp://pin-1' : options.handoffText
  const ctx = {
    agentPresets: { mount: async (agentCtx, id) => created.push({ mount: id }) },
    get: (key) => (key === 'agentDefaultModel' && options.hostModel
      ? { currentSelection: () => options.hostModel }
      : undefined),
    agents: (() => {
      const registryAgents = new Map()
      return {
        create: async (createOptions) => {
          created.push({ create: createOptions })
          if (options.spawnFails) throw new Error('registry down')
        const events = handoffText === 'turn_error'
          ? [{ type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'no model' } } } }]
          : handoffText
            ? [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: handoffText }] } } }]
            : []
          const agent = {
            id: createOptions.sessionId,
            ctx: {},
            followup: (message) => created.push({ followup: message }),
            whenIdle: () => (handoffText === 'never' ? new Promise(() => {}) : Promise.resolve()),
            cancel: (reason) => created.push({ cancel: reason }),
            session: { id: createOptions.sessionId, snapshotEvents: () => events },
          }
          registryAgents.set(agent.id, agent)
          return { agent, dispose: async () => {} }
        },
        get: (id) => registryAgents.get(id),
        list: () => [...registryAgents.values()],
      }
    })(),
  }
  return { calls, created, submits, acks, ctx, run, setClaim: (r) => { claimResult = r } }
}

test('worker session: claim → ACK → sub-session → handoff submitted on-chain', async () => {
  const h = harness()
  const runner = plugin.applyGroupTaskWorkerSessions(h.ctx, { daemonAlive: async () => true, run: h.run, pollMs: 600_000 })
  const worked = await runner.claimOnce()
  console.error('DEBUG calls:', JSON.stringify(h.calls))
  console.error('DEBUG worked:', worked)
  // ACK posted on-chain as the worker before the session runs.
  const ack = h.acks[0]
  assert.equal(ack[ack.indexOf('--as') + 1], 'carol')
  assert.match(ack[ack.indexOf('--content') + 1], /^\[WORKING\]/)
  // The sub-session carries the worker preset + its own LLM pair.
  const create = h.created.find((entry) => entry.create)?.create
  assert.equal(create.meta.agentPreset, 'oac-carol')
  assert.deepEqual(create.agentOptions, { provider: 'deepseek', model: 'deepseek-chat' })
  const section = h.created.find((entry) => entry.create)
  assert.ok(create, 'session created')
  // The work wrapper carries the goal, roster, log, target, and handoff contract.
  const wrapper = h.created.find((entry) => entry.followup)?.followup
  assert.match(wrapper.content[0].text, /<group_task_work>/)
  assert.match(wrapper.content[0].text, /发布 MetaApp/)
  assert.match(wrapper.content[0].text, /@Carol 请做封面/)
  assert.match(wrapper.content[0].text, /\[DELIVERABLE\] lines/)
  // The handoff is submitted with the session id and posted by the daemon.
  assert.equal(h.submits.length, 1)
  assert.equal(h.submits[0].requestId, 9)
  assert.match(h.submits[0].handoff, /封面做好了 \[DELIVERABLE\] metaapp:\/\/pin-1/)
  assert.ok(h.submits[0].dshSessionId)
  runner.stop()
})

test('worker session: empty handoff fails the request with WORKER_EMPTY_HANDOFF', async () => {
  const h = harness({ handoffText: '' })
  const runner = plugin.applyGroupTaskWorkerSessions(h.ctx, { daemonAlive: async () => true, run: h.run, pollMs: 600_000 })
  await runner.claimOnce()
  assert.equal(h.submits.length, 1)
  assert.match(h.submits[0].error, /WORKER_EMPTY_HANDOFF/)
  assert.ok(h.submits[0].dshSessionId)
  runner.stop()
})

test('worker session: spawn failure and timeouts fail the request gracefully', async () => {
  const failing = harness({ spawnFails: true })
  const failingRunner = plugin.applyGroupTaskWorkerSessions(failing.ctx, { daemonAlive: async () => true, run: failing.run, pollMs: 600_000 })
  await failingRunner.claimOnce()
  assert.match(failing.submits[0].error, /worker_session_spawn_failed/)
  failingRunner.stop()

  const wedged = harness({ handoffText: 'never' })
  const wedgedRunner = plugin.applyGroupTaskWorkerSessions(wedged.ctx, {
    daemonAlive: async () => true, run: wedged.run, pollMs: 600_000, turnTimeoutMs: 30,
  })
  await wedgedRunner.claimOnce()
  assert.match(wedged.submits[0].error, /WORKER_TURN_TIMED_OUT/)
  wedgedRunner.stop()
})

test('worker session: the (task, worker) session is reused across turns', async () => {
  const h = harness()
  const runner = plugin.applyGroupTaskWorkerSessions(h.ctx, { daemonAlive: async () => true, run: h.run, pollMs: 600_000 })
  await runner.claimOnce()
  h.setClaim({ ok: true, data: { request: claim({ requestId: 10, targetMessage: { index: 14, sender: 'Alice', content: 'next step' } }) } })
  await runner.claimOnce()
  const creations = h.created.filter((entry) => entry.create)
  assert.equal(creations.length, 1, 'second turn reused the live session')
  assert.equal(h.submits.length, 2)
  runner.stop()
})
