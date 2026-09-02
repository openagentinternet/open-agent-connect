import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const plugin = await import('../lib/index.js')

function runScript(options = {}) {
  const tasks = options.tasks ?? null
  let attemptCounter = 0
  const calls = []
  return {
    calls,
    run: async (args) => {
      calls.push(args)
      const verb = args.slice(0, 2).join(' ')
      if (verb === 'bot show') {
        const slug = args[args.indexOf('--from') + 1]
        return {
          ok: true,
          state: 'success',
          data: { profile: { slug, name: slug, botType: slug === 'alice' ? 'twin' : 'worker' } },
        }
      }
      if (verb === 'twin tasks') {
        const fileFlag = args.indexOf('--payload-file')
        const file = fileFlag >= 0 ? JSON.parse(await readFile(args[fileFlag + 1], 'utf8')) : null
        calls.push(['payload', file])
        if (args[2] === 'create') {
          return {
            ok: true,
            state: 'success',
            data: { task: { id: 'task_1', title: file.title, steps: [{ id: 'step_1' }] } },
          }
        }
        if (args[2] === 'show') {
          const taskId = args[args.indexOf('--task-id') + 1]
          const task = tasks?.find((entry) => entry.id === taskId) ?? null
          return task
            ? { ok: true, state: 'success', data: { task } }
            : { ok: false, state: 'failed', code: 'not_found', message: `not found: ${taskId}` }
        }
        if (args[2] === 'list') {
          return { ok: true, state: 'success', data: { tasks: tasks ?? [] } }
        }
        if (args[2] === 'update' && file.newAttempt) {
          attemptCounter += 1
          const attempt = { id: `att_${attemptCounter}`, status: 'queued', dshSessionId: file.dshSessionId ?? null }
          const step = tasks?.flatMap((entry) => entry.steps).find((entry) => entry.id === file.stepId)
          step?.attempts.push(attempt)
          return { ok: true, state: 'success', data: { attempt: { id: attempt.id } } }
        }
        if (args[2] === 'update' && file.stepId) {
          const step = tasks?.flatMap((entry) => entry.steps).find((entry) => entry.id === file.stepId)
          if (step) {
            if (file.workerSlug) step.workerSlug = file.workerSlug
            if (file.stepStatus) step.status = file.stepStatus
            if (file.attemptId) {
              const attempt = step.attempts.find((entry) => entry.id === file.attemptId)
              if (attempt) {
                if (file.attemptStatus) attempt.status = file.attemptStatus
                if (file.error) attempt.error = file.error
                if (file.handoff) attempt.handoff = file.handoff
              }
            }
          }
          return { ok: true, state: 'success', data: {} }
        }
        if (args[2] === 'update' && file.taskStatus) {
          const task = tasks?.find((entry) => entry.id === file.taskId)
          if (task) task.status = file.taskStatus
          return { ok: true, state: 'success', data: {} }
        }
        if (args[2] === 'pending-notify') {
          return {
            ok: true,
            state: 'success',
            data: {
              pending: [{
                taskId: 'task_0',
                taskTitle: '旧任务',
                stepId: 'step_0',
                workerSlug: 'bob',
                attemptId: 'att_0',
                attemptStatus: 'completed',
              }],
            },
          }
        }
        return { ok: true, state: 'success', data: {} }
      }
      return { ok: true, state: 'success', data: {} }
    },
  }
}

function fakeDsh(handoffText) {
  const mounted = []
  const followedUp = []
  const cancelled = []
  return {
    mounted,
    followedUp,
    cancelled,
    ctx: {
      agentPresets: {
        mount: async (agentCtx, id) => mounted.push(id),
      },
      agents: {
        create: async (options) => {
          await options.setup?.({})
          const preset = options.meta?.agentPreset
          const text = handoffText !== null && typeof handoffText === 'object' ? handoffText[preset] : handoffText
          return {
            agent: {
              ctx: {},
              followup: (message) => followedUp.push(message),
              whenIdle: () => text === 'never' ? new Promise(() => {}) : Promise.resolve(),
              cancel: (reason) => cancelled.push(reason),
              session: {
                id: options.sessionId,
                events: text && text !== 'never'
                  ? [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } }]
                  : [],
              },
            },
            dispose: async () => {},
          }
        },
      },
    },
  }
}

async function waitFor(condition) {
  for (let index = 0; index < 2000 && !condition(); index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.ok(condition(), 'waitFor condition never became true')
}

test('delegate runs a worker sub-session and posts ORCH-NOTIFY to the twin', async () => {
  const { run } = runScript()
  const dsh = fakeDsh('清单已整理好，证据如下…')
  const notices = []
  plugin.liveOacAgents.set('alice', {
    ctx: {},
    followup: (message) => notices.push(message),
  })
  const orchestrator = plugin.createTwinOrchestrator(dsh.ctx, 'alice', { run })
  const result = await orchestrator.delegate({
    workerSlug: 'bob',
    objective: '整理发布清单',
    acceptanceCriteria: ['包含全部条目'],
  })
  assert.equal(result.ok, true)
  assert.equal(result.data.handoff, '清单已整理好，证据如下…')
  assert.deepEqual(dsh.mounted, ['oac-bob'])
  assert.match(dsh.followedUp[0].content[0].text, /<twin_delegation>/)
  assert.match(dsh.followedUp[0].content[0].text, /整理发布清单/)
  assert.match(notices[0].content[0].text, /ORCH-NOTIFY/)
  assert.match(notices[0].content[0].text, /已完成/)
  plugin.liveOacAgents.delete('alice')
})

test('delegate refuses non-twin callers', async () => {
  const { run } = runScript()
  const dsh = fakeDsh('x')
  const orchestrator = plugin.createTwinOrchestrator(dsh.ctx, 'bob', { run })
  const result = await orchestrator.delegate({ workerSlug: 'carol', objective: 'x' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'TWIN_TOOL_FORBIDDEN')
})

test('delegate times out a wedged worker and marks the attempt timed_out', async () => {
  const { run, calls } = runScript()
  const dsh = fakeDsh('never')
  const orchestrator = plugin.createTwinOrchestrator(dsh.ctx, 'alice', { run, stepTimeoutMs: 50 })
  const result = await orchestrator.delegate({ workerSlug: 'bob', objective: 'x' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'worker_timed_out')
  const attemptUpdates = calls
    .filter((entry) => Array.isArray(entry) && entry[0] === 'payload' && entry[1]?.attemptStatus)
    .map((entry) => entry[1])
  assert.equal(attemptUpdates[0].attemptStatus, 'timed_out')
})

test('pending notifications are delivered and marked when the twin appears', async () => {
  const { run, calls } = runScript()
  const dsh = fakeDsh('x')
  const orchestrator = plugin.createTwinOrchestrator(dsh.ctx, 'alice', { run })
  const notices = []
  await orchestrator.deliverPendingNotifications('alice', {
    ctx: {},
    followup: (message) => notices.push(message),
  })
  assert.equal(notices.length, 1)
  assert.match(notices[0].content[0].text, /旧任务/)
  const marked = calls
    .filter((entry) => Array.isArray(entry) && entry[0] === 'payload' && entry[1]?.markNotified === true)
  assert.equal(marked.length, 1)
  assert.equal(marked[0][1].attemptId, 'att_0')
})

test('twin tools carry the expected names and the overlay text is present', () => {
  const orchestrator = plugin.createTwinOrchestrator({}, 'alice', { run: async () => ({ ok: true, data: {} }) })
  const tools = plugin.buildTwinToolDefinitions(orchestrator, 'alice', async () => ({ ok: true, data: {} }))
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    [
      'local_workers_list',
      'local_worker_delegate',
      'oac_session_insert_user_message',
      'twin_task_cancel',
      'twin_task_reassign',
      'twin_task_status',
      'worker_session_stop',
    ].sort(),
  )
  assert.match(plugin.TWIN_OVERLAY_TEXT, /Twin Bot Orchestration Role/)
  assert.match(plugin.TWIN_OVERLAY_TEXT, /local_worker_delegate/)
  assert.match(plugin.TWIN_OVERLAY_TEXT, /twin_task_reassign/)
  assert.match(plugin.TWIN_OVERLAY_TEXT, /oac_session_insert_user_message/)
  assert.match(plugin.WORKER_DELEGATION_SYSTEM_PROMPT, /persistent Worker Bot/)
})

test('reassign moves a failed step to a new worker and returns its handoff', async () => {
  const tasks = [{
    id: 'task_1',
    title: '发布清单',
    status: 'running',
    steps: [{
      id: 'step_1',
      workerSlug: 'bob',
      objective: '整理发布清单',
      acceptanceCriteria: ['包含全部条目'],
      permissionScope: { workspace: 'read_write' },
      status: 'failed',
      attempts: [{ id: 'att_0', status: 'failed', error: 'boom' }],
    }],
  }]
  const { run, calls } = runScript({ tasks })
  const dsh = fakeDsh('新 Worker 交付了清单')
  const orchestrator = plugin.createTwinOrchestrator(dsh.ctx, 'alice', { run })
  const result = await orchestrator.reassign({ stepId: 'step_1', workerSlug: 'carol' })
  assert.equal(result.ok, true)
  assert.equal(result.data.handoff, '新 Worker 交付了清单')
  assert.deepEqual(dsh.mounted, ['oac-carol'])
  // the step record moved to the new worker and gained a fresh attempt
  assert.equal(tasks[0].steps[0].workerSlug, 'carol')
  assert.ok(tasks[0].steps[0].attempts.some((attempt) => attempt.id === 'att_1'))
  // the already-failed attempt was left alone (no REASSIGNED cancellation)
  assert.equal(tasks[0].steps[0].attempts[0].status, 'failed')
  // the step was reset to ready with the new assignee in one update
  const reassignUpdates = calls
    .filter((entry) => Array.isArray(entry) && entry[0] === 'payload' && entry[1]?.workerSlug === 'carol')
  assert.equal(reassignUpdates.length, 1)
  assert.equal(reassignUpdates[0][1].stepStatus, 'ready')
  // the new delegation inherited objective + acceptance criteria from the step
  assert.match(dsh.followedUp[0].content[0].text, /整理发布清单/)
  assert.match(dsh.followedUp[0].content[0].text, /包含全部条目/)
})

test('reassign record-cancels a stale active attempt before re-delegating', async () => {
  const tasks = [{
    id: 'task_1',
    title: '发布清单',
    status: 'running',
    steps: [{
      id: 'step_1',
      workerSlug: 'bob',
      objective: '整理发布清单',
      status: 'running',
      attempts: [{ id: 'att_0', status: 'running' }],
    }],
  }]
  const { run, calls } = runScript({ tasks })
  const dsh = fakeDsh('done')
  const orchestrator = plugin.createTwinOrchestrator(dsh.ctx, 'alice', { run })
  const result = await orchestrator.reassign({ stepId: 'step_1', workerSlug: 'carol', taskId: 'task_1' })
  assert.equal(result.ok, true)
  const cancelPayloads = calls
    .filter((entry) => Array.isArray(entry) && entry[0] === 'payload' && entry[1]?.attemptStatus === 'cancelled')
  assert.equal(cancelPayloads.length, 1)
  assert.equal(cancelPayloads[0][1].attemptId, 'att_0')
  assert.equal(cancelPayloads[0][1].error, 'REASSIGNED_TO_ANOTHER_WORKER')
  assert.equal(tasks[0].steps[0].attempts[0].status, 'cancelled')
})

test('reassign aborts the in-flight attempt; its settle records the cancellation and skips the notify', async () => {
  const tasks = [{
    id: 'task_1',
    title: '发布清单',
    status: 'running',
    steps: [{
      id: 'step_1',
      workerSlug: 'bob',
      objective: '整理发布清单',
      status: 'running',
      attempts: [],
    }],
  }]
  const { run, calls } = runScript({ tasks })
  const dsh = fakeDsh({ 'oac-bob': 'never', 'oac-carol': '改派后完成' })
  // bounded step timeout: even if the abort path misfires the run cannot hang
  const orchestrator = plugin.createTwinOrchestrator(dsh.ctx, 'alice', { run, stepTimeoutMs: 10_000 })
  const notices = []
  plugin.liveOacAgents.set('alice', { ctx: {}, followup: (message) => notices.push(message) })
  const first = orchestrator.delegate({ workerSlug: 'bob', objective: '整理发布清单', taskId: 'task_1', stepId: 'step_1' })
  // wait until the delegation message is out: at that point the flight is
  // registered, the worker agent is live, and its abort listener is armed
  await waitFor(() => dsh.followedUp.length > 0)
  const result = await orchestrator.reassign({ stepId: 'step_1', workerSlug: 'carol', taskId: 'task_1' })
  assert.equal(result.ok, true)
  assert.equal(result.data.handoff, '改派后完成')
  const firstResult = await first
  assert.equal(firstResult.ok, false)
  assert.equal(firstResult.code, 'attempt_superseded')
  assert.deepEqual(dsh.mounted, ['oac-bob', 'oac-carol'])
  const step = tasks[0].steps[0]
  assert.equal(step.workerSlug, 'carol')
  const superseded = step.attempts.find((attempt) => attempt.id === 'att_1')
  assert.equal(superseded.status, 'cancelled')
  assert.equal(superseded.error, 'REASSIGNED_TO_ANOTHER_WORKER')
  assert.ok(step.attempts.some((attempt) => attempt.id === 'att_2' && attempt.status === 'completed'))
  assert.equal(step.status, 'completed')
  assert.equal(tasks[0].status, 'review')
  // exactly one notify (the successful new delegation); the superseded attempt stays silent
  assert.equal(notices.length, 1)
  assert.match(notices[0].content[0].text, /已完成/)
  plugin.liveOacAgents.delete('alice')
})

test('reassign validates caller, worker, and step state', async () => {
  const { run } = runScript({ tasks: [] })
  const dsh = fakeDsh('x')
  const notTwin = plugin.createTwinOrchestrator(dsh.ctx, 'bob', { run })
  const forbidden = await notTwin.reassign({ stepId: 'step_1', workerSlug: 'carol' })
  assert.equal(forbidden.code, 'TWIN_TOOL_FORBIDDEN')

  const orchestrator = plugin.createTwinOrchestrator(dsh.ctx, 'alice', { run })
  const missing = await orchestrator.reassign({ stepId: 'step_nope', workerSlug: 'carol' })
  assert.equal(missing.code, 'step_not_found')

  const cancelledTasks = [{
    id: 'task_1',
    title: 't',
    status: 'cancelled',
    steps: [{ id: 'step_1', workerSlug: 'bob', objective: 'x', status: 'cancelled', attempts: [] }],
  }]
  const cancelledRun = runScript({ tasks: cancelledTasks })
  const orchestrator2 = plugin.createTwinOrchestrator(dsh.ctx, 'alice', { run: cancelledRun.run })
  const illegal = await orchestrator2.reassign({ stepId: 'step_1', workerSlug: 'carol' })
  assert.equal(illegal.code, 'illegal_state')
})

test('insertSessionMessage delivers into a live worker session by slug', async () => {
  const { run } = runScript()
  const orchestrator = plugin.createTwinOrchestrator({}, 'alice', { run })
  const delivered = []
  plugin.liveOacAgents.set('bob', { ctx: {}, session: { id: 'sess-bob' }, followup: (message) => delivered.push(message) })
  const result = await orchestrator.insertSessionMessage('bob', '把今天的进展发我')
  assert.equal(result.ok, true)
  assert.equal(result.data.workerSlug, 'bob')
  assert.equal(result.data.sessionId, 'sess-bob')
  assert.equal(delivered.length, 1)
  assert.match(delivered[0].content[0].text, /Cross-session message from alice/)
  assert.match(delivered[0].content[0].text, /把今天的进展发我/)
  assert.equal(delivered[0].source.form, 'cross-session')
  assert.ok(delivered[0].id)
  plugin.liveOacAgents.delete('bob')
})

test('insertSessionMessage reaches an in-flight delegated session by slug', async () => {
  const { run } = runScript()
  const dsh = fakeDsh('never')
  // bounded step timeout: even if the abort path misfires the run cannot hang
  const orchestrator = plugin.createTwinOrchestrator(dsh.ctx, 'alice', { run, stepTimeoutMs: 10_000 })
  const pending = orchestrator.delegate({ workerSlug: 'bob', objective: 'x' })
  await waitFor(() => dsh.followedUp.length > 0)
  const result = await orchestrator.insertSessionMessage('bob', '顺便检查一下格式')
  assert.equal(result.ok, true, result.message)
  assert.equal(result.data.workerSlug, 'bob')
  assert.match(dsh.followedUp.at(-1).content[0].text, /顺便检查一下格式/)
  await orchestrator.stopAttempt('task_1', 'step_1')
  const settled = await pending
  assert.equal(settled.ok, false)
})

test('insertSessionMessage validates input and target liveness', async () => {
  const { run } = runScript()
  const orchestrator = plugin.createTwinOrchestrator({}, 'alice', { run })
  assert.equal((await orchestrator.insertSessionMessage('bob', '   ')).code, 'empty_message')
  assert.equal((await orchestrator.insertSessionMessage('bob', 'x'.repeat(12_001))).code, 'message_too_long')
  assert.equal((await orchestrator.insertSessionMessage('alice', 'hi')).code, 'same_session')
  assert.equal((await orchestrator.insertSessionMessage('nobody', 'hi')).code, 'session_not_live')
  const notTwin = plugin.createTwinOrchestrator({}, 'bob', { run })
  assert.equal((await notTwin.insertSessionMessage('carol', 'hi')).code, 'TWIN_TOOL_FORBIDDEN')
})

test('stopLiveSession cancels a live interactive session', async () => {
  const { run } = runScript()
  const orchestrator = plugin.createTwinOrchestrator({}, 'alice', { run })
  const cancelled = []
  plugin.liveOacAgents.set('bob', { ctx: {}, cancel: (reason) => cancelled.push(reason) })
  const result = await orchestrator.stopLiveSession('bob')
  assert.equal(result.ok, true)
  assert.equal(cancelled[0].kind, 'orchestrator_stop')
  plugin.liveOacAgents.delete('bob')
  assert.equal((await orchestrator.stopLiveSession('nobody')).code, 'session_not_live')
  assert.equal((await orchestrator.stopLiveSession('alice')).code, 'same_session')
})

test('stopLiveSession points at taskId+stepId for in-flight delegated sessions', async () => {
  const { run } = runScript()
  const dsh = fakeDsh('never')
  // bounded step timeout: even if the abort path misfires the run cannot hang
  const orchestrator = plugin.createTwinOrchestrator(dsh.ctx, 'alice', { run, stepTimeoutMs: 10_000 })
  const pending = orchestrator.delegate({ workerSlug: 'bob', objective: 'x' })
  await waitFor(() => dsh.followedUp.length > 0)
  const result = await orchestrator.stopLiveSession('bob')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'use_task_step')
  assert.match(result.message, /task_1/)
  assert.match(result.message, /step_1/)
  await orchestrator.stopAttempt('task_1', 'step_1')
  await pending
})

test('delegate resolves the agents registry through ctx.get when the Cordis inject fence guards the property', async () => {
  const { run } = runScript()
  const dsh = fakeDsh('围栏后也能交付')
  // live-host shape: the property read throws, ctx.get returns the service
  const fencedCtx = {
    get agents() { throw new Error('cannot get property "agents" without inject') },
    get: (key) => key === 'agents' ? dsh.ctx.agents : undefined,
    agentPresets: dsh.ctx.agentPresets,
  }
  const orchestrator = plugin.createTwinOrchestrator(fencedCtx, 'alice', { run })
  const result = await orchestrator.delegate({ workerSlug: 'bob', objective: 'x' })
  assert.equal(result.ok, true, result.message)
  assert.equal(result.data.handoff, '围栏后也能交付')
})

test('delegate fails clean when the agents registry is genuinely unavailable', async () => {
  const { run } = runScript()
  const fencedCtx = {
    get agents() { throw new Error('cannot get property "agents" without inject') },
    get: () => undefined,
    agentPresets: { mount: async () => {} },
  }
  const orchestrator = plugin.createTwinOrchestrator(fencedCtx, 'alice', { run })
  const result = await orchestrator.delegate({ workerSlug: 'bob', objective: 'x' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'delegation_unavailable')
})
