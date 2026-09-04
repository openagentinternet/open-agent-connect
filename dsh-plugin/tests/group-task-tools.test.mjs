process.env.OAC_DSH_NO_LOCAL_READ = '1'

import assert from 'node:assert/strict'
import test from 'node:test'

const plugin = await import('../lib/index.js')

/**
 * Fake CLI bridge: `bot show --from <slug>` resolves the twin gate; every
 * `grouptask …` invocation is recorded and answered by the test's handler.
 */
function fakeRun(handler = () => ({ ok: true, state: 'success', data: {} })) {
  const calls = []
  const run = async (args) => {
    calls.push(args)
    const verb = args.slice(0, 2).join(' ')
    if (verb === 'bot show') {
      const slug = args[args.indexOf('--from') + 1]
      return {
        ok: true,
        state: 'success',
        data: { profile: { slug, botType: slug === 'alice' ? 'twin' : 'worker' } },
      }
    }
    return handler(args)
  }
  return { calls, run }
}

function flagValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function hasFlag(args, flag) {
  return args.includes(flag)
}

test('group_task tool shape: one action-union tool plus the SOP section', () => {
  const controller = plugin.createGroupTaskController('alice', { run: async () => ({ ok: true, data: {} }) })
  const tool = plugin.buildGroupTaskToolDefinition(controller)
  assert.equal(tool.name, 'group_task')
  const actions = tool.parameters.properties.action.enum
  for (const action of [
    'list', 'detail', 'messages', 'create', 'propose', 'decide', 'create_from_proposal',
    'search_candidates', 'post', 'close', 'reopen', 'kick', 'member_status', 'invite', 'invites', 'health',
  ]) {
    assert.ok(actions.includes(action), `action ${action} missing from the enum`)
  }
  assert.match(plugin.GROUP_TASK_SOP_TEXT, /group_task/)
  assert.match(plugin.GROUP_TASK_SOP_TEXT, /search_candidates/)
  assert.match(plugin.GROUP_TASK_SOP_TEXT, /slateText/)
  assert.match(plugin.GROUP_TASK_SOP_TEXT, /create_from_proposal/)
  assert.match(plugin.GROUP_TASK_SOP_TEXT, /pendingRemoteSeats/)
  assert.match(plugin.GROUP_TASK_SOP_TEXT, /直接开始/, 'the auto-start waiver must cover the Chinese phrases')
  assert.match(plugin.GROUP_TASK_SOP_TEXT, /planning, executing, review, done, cancelled/)
})

test('installGroupTaskOnAgent registers the SOP section and the group_task tool', () => {
  const sections = []
  const registered = []
  const agent = {
    ctx: {
      systemPrompt: { section: (section) => sections.push(section) },
      tools: { register: (definition) => registered.push(definition) },
    },
  }
  plugin.installGroupTaskOnAgent(agent, 'alice', { run: async () => ({ ok: true, data: {} }) })
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'oac:group-task')
  assert.match(sections[0].text, /Group Tasks/)
  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, 'group_task')
})

test('non-twin callers are refused before any grouptask invocation', async () => {
  const { calls, run } = fakeRun()
  const controller = plugin.createGroupTaskController('bob', { run })
  await assert.rejects(controller.run('list', {}), /TWIN_TOOL_FORBIDDEN/)
  assert.deepEqual(calls.filter((args) => args[0] === 'grouptask'), [])
})

test('list defaults to the active tab and renders one line per task', async () => {
  const { calls, run } = fakeRun((args) => ({
    ok: true,
    state: 'success',
    data: {
      tasks: [
        { id: 3, title: '发布 MetaApp', status: 'executing', chairSlug: 'alice', memberCount: 4 },
        { id: 4, title: '周报配图', status: 'review', chairSlug: 'alice', memberCount: 2, openTeam: true },
      ],
    },
  }))
  const controller = plugin.createGroupTaskController('alice', { run })
  const output = await controller.run('list', {})
  const listCall = calls.find((args) => args[0] === 'grouptask' && args[1] === 'list')
  assert.ok(listCall)
  assert.equal(flagValue(listCall, '--tab'), 'active')
  assert.match(output, /\[executing\] 发布 MetaApp · task 3 · chair alice · 4 members/)
  assert.match(output, /\[review\] 周报配图 .*OpenTeam/)
})

test('detail/messages default the chair to the twin slug', async () => {
  const { calls, run } = fakeRun()
  const controller = plugin.createGroupTaskController('alice', { run })
  await controller.run('detail', { taskId: 3 })
  const detailCall = calls.find((args) => args[1] === 'detail')
  assert.equal(flagValue(detailCall, '--chair'), 'alice')
  assert.equal(flagValue(detailCall, '--task'), '3')
  await controller.run('messages', { taskId: 3, limit: 20 })
  const messagesCall = calls.find((args) => args[1] === 'messages')
  assert.equal(flagValue(messagesCall, '--chair'), 'alice')
  assert.equal(flagValue(messagesCall, '--limit'), '20')
})

test('create passes the roster and renders the created task with follow-up hints', async () => {
  const { calls, run } = fakeRun((args) => ({
    ok: true,
    state: 'success',
    data: {
      chairSlug: 'alice',
      task: { id: 5, groupId: 'group-pin-1', title: '发布 MetaApp', status: 'planning' },
    },
  }))
  const controller = plugin.createGroupTaskController('alice', { run })
  const output = await controller.run('create', {
    title: '发布 MetaApp',
    goal: '上线并发布',
    acceptanceCriteria: '应用可打开',
    workerSlugs: ['bob', 'carol'],
  })
  const createCall = calls.find((args) => args[1] === 'create')
  assert.equal(flagValue(createCall, '--title'), '发布 MetaApp')
  assert.equal(flagValue(createCall, '--goal'), '上线并发布')
  assert.equal(flagValue(createCall, '--acceptance'), '应用可打开')
  assert.equal(flagValue(createCall, '--workers'), 'bob,carol')
  assert.equal(flagValue(createCall, '--chair'), 'alice')
  assert.match(output, /task 5, group group-pin-1, status planning/)
  assert.match(output, /alice chairs it/)
})

test('propose forwards the plan, wish, language, and the source session id', async () => {
  const { calls, run } = fakeRun((args) => ({
    ok: true,
    state: 'success',
    data: {
      proposal: { id: 7 },
      slateText: '按你的目标…回复确认',
      ownerConfirmRequired: true,
    },
  }))
  const controller = plugin.createGroupTaskController('alice', { run })
  const plan = {
    stages: [{ id: 's1', title: '写稿', seatRole: 'content', dependsOn: [] }],
    seats: [{ role: 'content', candidateName: 'Bob', candidateSlug: 'bob', source: 'local', reason: '文案强' }],
  }
  const output = await controller.run(
    'propose',
    { title: '发布 MetaApp', goal: '上线并发布', plan, wish: '帮我发布', language: 'zh' },
    { sessionId: 'sess-1' },
  )
  const proposeCall = calls.find((args) => args[1] === 'staffing' && args[2] === 'propose')
  assert.ok(proposeCall)
  assert.deepEqual(JSON.parse(flagValue(proposeCall, '--plan')), plan)
  assert.equal(flagValue(proposeCall, '--session'), 'sess-1')
  assert.equal(flagValue(proposeCall, '--wish'), '帮我发布')
  assert.equal(flagValue(proposeCall, '--lang'), 'zh')
  assert.equal(flagValue(proposeCall, '--chair'), 'alice')
  assert.match(output, /按你的目标…回复确认/)
  assert.match(output, /proposalId: 7/)
  assert.match(output, /ownerConfirmRequired: true/)
})

test('propose through the tool execute path captures the running session id', async () => {
  const { calls, run } = fakeRun((args) => ({
    ok: true,
    state: 'success',
    data: { proposal: { id: 1 }, slateText: 'slate', ownerConfirmRequired: true },
  }))
  const controller = plugin.createGroupTaskController('alice', { run })
  const tool = plugin.buildGroupTaskToolDefinition(controller)
  await tool.execute(
    { action: 'propose', title: 'T', goal: 'G', plan: { stages: [], seats: [] } },
    { agent: { session: { id: 'sess-9' } } },
  )
  const proposeCall = calls.find((args) => args[1] === 'staffing')
  assert.equal(flagValue(proposeCall, '--session'), 'sess-9')
})

test('decide validates the decision and create_from_proposal surfaces remote seats', async () => {
  const { calls, run } = fakeRun((args) => {
    if (args[1] === 'staffing' && args[2] === 'create') {
      return {
        ok: true,
        state: 'success',
        data: {
          chairSlug: 'alice',
          task: { id: 6, groupId: 'group-pin-2', title: '发布 MetaApp', status: 'planning' },
          taskId: 6,
          pendingRemoteSeats: [
            { role: 'design', candidateName: 'Remote Designer', candidateGlobalMetaId: 'gm-1' },
          ],
          decision: 'owner_confirmed',
        },
      }
    }
    return { ok: true, state: 'success', data: { proposal: { id: 7 } } }
  })
  const controller = plugin.createGroupTaskController('alice', { run })
  await assert.rejects(controller.run('decide', { proposalId: 7, decision: 'maybe' }), /invalid_decision/)
  await controller.run('decide', { proposalId: 7, decision: 'confirm' })
  const decideCall = calls.find((args) => args[2] === 'decide')
  assert.equal(flagValue(decideCall, '--proposal'), '7')
  assert.equal(flagValue(decideCall, '--decision'), 'confirm')

  const output = await controller.run('create_from_proposal', { proposalId: 7 })
  const createCall = calls.find((args) => args[2] === 'create')
  assert.equal(flagValue(createCall, '--proposal'), '7')
  assert.equal(flagValue(createCall, '--chair'), 'alice')
  assert.match(output, /task 6, group group-pin-2/)
  assert.match(output, /Pending remote seats \(1\)/)
  assert.match(output, /design: Remote Designer \(globalMetaId gm-1\)/)
  assert.match(output, /invites expire in 10 minutes/)
})

test('search_candidates requires a seat or a query', async () => {
  const { run } = fakeRun()
  const controller = plugin.createGroupTaskController('alice', { run })
  await assert.rejects(controller.run('search_candidates', {}), /missing_query/)
  await assert.rejects(controller.run('propose', { title: 'T', goal: 'G' }), /missing_plan/)
})

test('close validates the outcome and forwards rating fields', async () => {
  const { calls, run } = fakeRun()
  const controller = plugin.createGroupTaskController('alice', { run })
  await assert.rejects(controller.run('close', { taskId: 3, outcome: 'maybe' }), /invalid_outcome/)
  await controller.run('close', { taskId: 3, outcome: 'done', rating: 5, comment: '很棒' })
  const closeCall = calls.find((args) => args[1] === 'close')
  assert.equal(flagValue(closeCall, '--outcome'), 'done')
  assert.equal(flagValue(closeCall, '--rating'), '5')
  assert.equal(flagValue(closeCall, '--comment'), '很棒')
})

test('post rejects conflicting senders and routes slug vs owner identity', async () => {
  const { calls, run } = fakeRun()
  const controller = plugin.createGroupTaskController('alice', { run })
  await assert.rejects(
    controller.run('post', { taskId: 3, content: 'hi', asSlug: 'bob', asOwner: true }),
    /conflicting_sender/,
  )
  await controller.run('post', { taskId: 3, content: 'hi', asOwner: true })
  const ownerCall = calls.find((args) => args[1] === 'post')
  assert.ok(hasFlag(ownerCall, '--as-owner'))
  assert.equal(hasFlag(ownerCall, '--as'), false)
})

test('kick and member_status pick slug or global-metaid', async () => {
  const { calls, run } = fakeRun()
  const controller = plugin.createGroupTaskController('alice', { run })
  await assert.rejects(controller.run('kick', { taskId: 3 }), /missing_member/)
  await controller.run('kick', { taskId: 3, member: 'bob', reason: 'off track' })
  const kickCall = calls.find((args) => args[1] === 'kick')
  assert.equal(flagValue(kickCall, '--member'), 'bob')
  assert.equal(flagValue(kickCall, '--reason'), 'off track')
  await controller.run('member_status', { taskId: 3, status: 'standby', globalMetaId: 'gm-2' })
  const statusCall = calls.find((args) => args[1] === 'member-status')
  assert.equal(flagValue(statusCall, '--status'), 'standby')
  assert.equal(flagValue(statusCall, '--global-metaid'), 'gm-2')
  assert.equal(hasFlag(statusCall, '--member'), false)
})

test('invite requires a globalMetaId and forwards invite options', async () => {
  const { calls, run } = fakeRun()
  const controller = plugin.createGroupTaskController('alice', { run })
  await assert.rejects(controller.run('invite', { taskId: 3 }), /missing_global_metaid/)
  await controller.run('invite', { taskId: 3, globalMetaId: 'gm-3', name: 'Designer', skills: ['design'], allowReinvite: true })
  const inviteCall = calls.find((args) => args[1] === 'invite')
  assert.equal(flagValue(inviteCall, '--global-metaid'), 'gm-3')
  assert.equal(flagValue(inviteCall, '--name'), 'Designer')
  assert.equal(flagValue(inviteCall, '--skills'), 'design')
  assert.ok(hasFlag(inviteCall, '--allow-reinvite'))
})

test('unknown actions fail with the action inventory', async () => {
  const { run } = fakeRun()
  const controller = plugin.createGroupTaskController('alice', { run })
  await assert.rejects(controller.run('nope', {}), /unknown_action/)
  await assert.rejects(controller.run('detail', {}), /missing_task_id/)
})
