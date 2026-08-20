import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const plugin = await import('../lib/index.js')

function runScript(steps) {
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
        if (args[2] === 'update' && file.newAttempt) {
          return { ok: true, state: 'success', data: { attempt: { id: 'att_1' } } }
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
  return {
    mounted,
    followedUp,
    ctx: {
      agentPresets: {
        mount: async (agentCtx, id) => mounted.push(id),
      },
      agents: {
        create: async (options) => {
          await options.setup?.({})
          return {
            agent: {
              ctx: {},
              followup: (message) => followedUp.push(message),
              whenIdle: () => handoffText === 'never' ? new Promise(() => {}) : Promise.resolve(),
              session: {
                events: handoffText && handoffText !== 'never'
                  ? [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: handoffText }] } } }]
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
    ['local_workers_list', 'local_worker_delegate', 'twin_task_cancel', 'twin_task_status', 'worker_session_stop'].sort(),
  )
  assert.match(plugin.TWIN_OVERLAY_TEXT, /Twin Bot Orchestration Role/)
  assert.match(plugin.TWIN_OVERLAY_TEXT, /local_worker_delegate/)
  assert.match(plugin.WORKER_DELEGATION_SYSTEM_PROMPT, /persistent Worker Bot/)
})
