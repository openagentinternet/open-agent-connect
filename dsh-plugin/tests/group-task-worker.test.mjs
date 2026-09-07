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
    groupId: 'grp-42',
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
  const tools = []
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
            ctx: {
              systemPrompt: { section: () => () => {} },
              tools: { register: (def) => { tools.push(def); return () => {} } },
            },
            followup: (message) => created.push({ followup: message }),
            whenIdle: async () => {
              if (handoffText === 'never') return new Promise(() => {})
              // Test seam: mid-turn tool calls happen while the turn runs.
              if (options.beforeIdle) await options.beforeIdle()
            },
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
  return { calls, created, submits, acks, tools, ctx, run, setClaim: (r) => { claimResult = r } }
}

test('worker session: claim → sub-session → handoff submitted on-chain (no host-posted ACK)', async () => {
  const h = harness()
  const runner = plugin.applyGroupTaskWorkerSessions(h.ctx, { daemonAlive: async () => true, run: h.run, pollMs: 600_000 })
  const worked = await runner.claimOnce()
  assert.equal(worked, true)
  // Single-commander: the host NEVER speaks under the worker's identity — no
  // auto-[WORKING] ACK on claim; the worker's own speech is the only voice.
  assert.equal(h.acks.length, 0, 'no host-posted [WORKING] ACK on claim')
  // The session carries the mid-turn speech tool bound to the task group.
  assert.equal(h.tools.length, 1, 'the session-scoped group_chat tool registered')
  assert.equal(h.tools[0].name, 'group_chat')
  // The sub-session carries the worker preset + its own LLM pair.
  const create = h.created.find((entry) => entry.create)?.create
  assert.equal(create.meta.agentPreset, 'oac-carol')
  assert.deepEqual(create.agentOptions, { provider: 'deepseek', model: 'deepseek-chat' })
  assert.ok(create, 'session created')
  // The work wrapper carries the goal, roster, log, target, and handoff contract.
  const wrapper = h.created.find((entry) => entry.followup)?.followup
  assert.match(wrapper.content[0].text, /<group_task_work>/)
  assert.match(wrapper.content[0].text, /<group_id>grp-42<\/group_id>/)
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

test('worker session: mid-turn group_chat sends post as the worker; empty final reply settles as delivered', async () => {
  const h = harness({
    handoffText: '',
    beforeIdle: async () => {
      const tool = h.tools.find((def) => def.name === 'group_chat')
      assert.ok(tool, 'group_chat tool registered')
      const result = await tool.execute({ action: 'send_group_message', content: '[WORKING] 做了一半' })
      assert.match(result, /Sent to the group as Carol/)
    },
  })
  const runner = plugin.applyGroupTaskWorkerSessions(h.ctx, { daemonAlive: async () => true, run: h.run, pollMs: 600_000 })
  await runner.claimOnce()
  // The mid-turn send went through `grouptask post` as the worker.
  const mid = h.acks.find((args) => args[1] === 'post')
  assert.ok(mid, 'mid-turn post happened')
  assert.equal(mid[mid.indexOf('--as') + 1], 'carol')
  assert.equal(mid[mid.indexOf('--content') + 1], '[WORKING] 做了一半')
  // IDBots task #66-A: empty final reply after mid-turn sends = DELIVERED turn
  // — completed via a [NO_REPLY] handoff, no WORKER_EMPTY_HANDOFF, no repost.
  assert.equal(h.submits.length, 1)
  assert.equal(h.submits[0].handoff, '[NO_REPLY]')
  assert.equal(h.submits[0].error, undefined)
  runner.stop()
})

test('worker session: group_chat validates group_id and auto-routes to the task group', async () => {
  const h = harness({
    handoffText: '',
    beforeIdle: async () => {
      const tool = h.tools.find((def) => def.name === 'group_chat')
      // A bare task number is rejected with the teaching error (IDBots #65).
      await assert.rejects(
        () => tool.execute({ action: 'send_group_message', content: 'x', group_id: '65' }),
        /TASK number/,
      )
      // A well-formed but WRONG group id is overridden with a note.
      const ok = await tool.execute({
        action: 'send_group_message',
        content: 'progress note',
        group_id: `${'f'.repeat(64)}i9`,
      })
      assert.match(ok, /routed to this turn's task group/)
      // Unknown actions are rejected.
      await assert.rejects(
        () => tool.execute({ action: 'delete_group', content: 'x' }),
        /invalid_action/,
      )
    },
  })
  const runner = plugin.applyGroupTaskWorkerSessions(h.ctx, { daemonAlive: async () => true, run: h.run, pollMs: 600_000 })
  await runner.claimOnce()
  // Only the two successful mid-turn sends posted (the wrong-id one routed).
  assert.equal(h.acks.length, 1)
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
