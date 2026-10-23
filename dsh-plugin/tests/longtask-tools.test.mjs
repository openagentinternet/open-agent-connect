import assert from 'node:assert/strict'
import test from 'node:test'

const plugin = await import('../lib/longtask-tools.js')

const TOOL_NAMES = [
  'longtask_board',
  'longtask_show',
  'longtask_create',
  'longtask_add_subtask',
  'longtask_set_status',
  'longtask_advance',
]

function fakeHost(overrides = {}) {
  const tools = []
  const sections = []
  return {
    tools,
    sections,
    ctx: {
      tools: { register: (definition) => tools.push(definition) },
      systemPrompt: { section: (spec) => sections.push(spec) },
      logger: { warn: () => undefined },
      ...overrides,
    },
  }
}

/** Dispatching fake run: answers by `longtask <subcommand>`; records every call. */
function fakeRun(handlers) {
  const calls = []
  const run = async (args, options) => {
    calls.push({ args, options })
    const handler = handlers[args[1]]
    if (!handler) throw new Error(`no fake handler for: ${args.join(' ')}`)
    return handler
  }
  return { calls, run }
}

function buildTools(handlers, hostOverrides) {
  const host = fakeHost({ agentPresets: { composedPreset: () => 'oac-alice' }, ...hostOverrides })
  const { calls, run } = fakeRun(handlers)
  const tools = plugin.buildLongtaskToolDefinitions({ host: host.ctx, hostAgent: { ctx: {} }, run })
  return { host, tools, calls }
}

const ok = (data) => ({ ok: true, state: 'success', data })
const fail = (code, message) => ({ ok: false, state: 'failed', code, message })

const LONG_DETAIL = 'x'.repeat(200)

const SHOW_PAYLOAD = {
  task: {
    id: 'lt-demo', title: 'Demo task', goal: 'Ship the demo', stage: 'active',
    currentSubtaskId: null, createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z',
  },
  subtasks: [
    { taskId: 'lt-demo', id: 'st-one', ordinal: 1, title: 'First', status: 'accepted', dependsOn: [], expectedMinutes: 30 },
    { taskId: 'lt-demo', id: 'st-two', ordinal: 3, title: 'Second', status: 'in_progress', dependsOn: ['st-one'], expectedMinutes: null },
  ],
  events: [
    { id: 'e1', taskId: 'lt-demo', subtaskId: null, kind: 'task_created', actor: 'local', detail: 'created', at: '2026-10-23T00:00:01.000Z' },
    { id: 'e2', taskId: 'lt-demo', subtaskId: 'st-two', kind: 'advance', actor: 'system', detail: LONG_DETAIL, at: '2026-10-23T00:00:02.000Z' },
  ],
}

const BOARD_PAYLOAD = {
  cards: [
    {
      task: {
        id: 'lt-demo', title: 'Demo task', goal: 'Ship the demo', stage: 'active',
        currentSubtaskId: null, createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z',
      },
      column: 'in_progress',
      progress: { accepted: 1, total: 2, percent: 50 },
      currentSubtask: { taskId: 'lt-demo', id: 'st-two', ordinal: 3, title: 'Second', status: 'in_progress', dependsOn: ['st-one'], expectedMinutes: null },
    },
  ],
}

test('bindLongtaskToolInstall registers exactly the six longtask tools, no prompt sections', () => {
  const host = fakeHost()
  plugin.bindLongtaskToolInstall(host.ctx)
  assert.deepEqual(host.tools.map((tool) => tool.name), TOOL_NAMES)
  assert.equal(host.sections.length, 0)
  for (const tool of host.tools) {
    assert.equal(typeof tool.description, 'string')
    assert.ok(tool.description.length > 40, `${tool.name} needs a real description`)
    assert.equal(tool.output.schema.type, 'string')
  }
})

test('longtask_board: argv with --from slug, compact card render (no raw JSON dump)', async () => {
  const { tools, calls } = buildTools({ board: ok(BOARD_PAYLOAD) })
  const out = await tools.find((tool) => tool.name === 'longtask_board').execute({}, {})
  assert.deepEqual(calls[0].args, ['longtask', 'board', '--from', 'alice'])
  assert.match(out, /- \[in_progress\] lt-demo — Demo task \(1\/2, 50%\) stage:active/)
  assert.match(out, /current: \[in_progress\] #3 st-two — Second \(deps: st-one\)/)
  // Compaction proof: raw row fields the model should not need are not echoed.
  assert.ok(!out.includes('createdAt'))
  assert.ok(!out.includes('currentSubtaskId'))
})

test('longtask_board: no oac slug on the session omits --from entirely', async () => {
  const { tools, calls } = buildTools({ board: ok(BOARD_PAYLOAD) }, { agentPresets: undefined })
  const out = await tools.find((tool) => tool.name === 'longtask_board').execute({}, {})
  assert.deepEqual(calls[0].args, ['longtask', 'board'])
  assert.ok(out.length > 0)
})

test('longtask_show: argv, compact render, journal details trimmed with omission count', async () => {
  const { tools, calls } = buildTools({ show: ok(SHOW_PAYLOAD) })
  const out = await tools.find((tool) => tool.name === 'longtask_show').execute({ taskId: 'lt-demo' }, {})
  assert.deepEqual(calls[0].args, ['longtask', 'show', '--id', 'lt-demo', '--from', 'alice'])
  assert.match(out, /# Demo task \(lt-demo\) stage:active/)
  assert.match(out, /goal: Ship the demo/)
  assert.match(out, /## subtasks/)
  assert.match(out, /- \[accepted\] #1 st-one — First/)
  assert.match(out, /## journal \(2\)/)
  assert.match(out, /\(1 event detail\(s\) trimmed for size\)/)
  assert.ok(out.includes(`${'x'.repeat(120)}…`), 'trimmed detail keeps the first 120 chars + ellipsis')
  assert.ok(!out.includes('x'.repeat(121)), 'the untrimmed 200-char detail must not appear')
})

test('longtask_show: missing taskId is rejected locally with zero run calls', async () => {
  const { tools, calls } = buildTools({ show: ok(SHOW_PAYLOAD) })
  const out = await tools.find((tool) => tool.name === 'longtask_show').execute({}, {})
  assert.match(out, /longtask_show failed: taskId is required\./)
  assert.equal(calls.length, 0)
})

test('longtask_show: failure envelope keeps the CLI code verbatim', async () => {
  const { tools } = buildTools({ show: fail('longtask_not_found', 'No long-term task lt-x.') })
  const out = await tools.find((tool) => tool.name === 'longtask_show').execute({ taskId: 'lt-x' }, {})
  assert.equal(out, 'longtask_show failed: [longtask_not_found] No long-term task lt-x.')
})

test('longtask_create: tool-generated id, exact argv, description states it goes live active immediately', async () => {
  const { tools, calls } = buildTools({ create: ok(SHOW_PAYLOAD.task) })
  const out = await tools.find((tool) => tool.name === 'longtask_create').execute({ title: 'T', goal: 'G' }, {})
  const args = calls[0].args
  assert.deepEqual(args.slice(0, 3), ['longtask', 'create', '--id'])
  assert.match(args[3], /^lt-[a-z0-9]+-[a-f0-9]{6}$/)
  assert.deepEqual(args.slice(4), ['--title', 'T', '--goal', 'G', '--from', 'alice'])
  assert.ok(out.includes('"id"'))
  const def = tools.find((tool) => tool.name === 'longtask_create')
  assert.match(def.description, /goes live as stage active IMMEDIATELY/)
})

test('longtask_create: missing title or goal is rejected locally, zero run calls', async () => {
  const { tools, calls } = buildTools({ create: ok({}) })
  const create = tools.find((tool) => tool.name === 'longtask_create')
  assert.match(await create.execute({ title: 'T' }, {}), /longtask_create failed: goal is required\./)
  assert.match(await create.execute({ goal: 'G' }, {}), /longtask_create failed: title is required\./)
  assert.equal(calls.length, 0)
})

test('longtask_add_subtask: auto id + ordinal max+1 via the show pre-read; no --depends-on when no deps', async () => {
  const { tools, calls } = buildTools({
    show: ok(SHOW_PAYLOAD),
    'add-subtask': ok(SHOW_PAYLOAD.subtasks[1]),
  })
  const out = await tools.find((tool) => tool.name === 'longtask_add_subtask')
    .execute({ taskId: 'lt-demo', title: 'Third' }, {})
  assert.deepEqual(calls[0].args, ['longtask', 'show', '--id', 'lt-demo', '--from', 'alice'])
  const args = calls[1].args
  assert.deepEqual(args.slice(0, 8), ['longtask', 'add-subtask', '--id', 'lt-demo', '--subtask', args[5], '--title', 'Third'])
  assert.match(args[5], /^st-[a-z0-9]+-[a-f0-9]{6}$/)
  assert.deepEqual(args.slice(8), ['--ordinal', '4', '--from', 'alice']) // max(1,3)+1
  assert.ok(!args.includes('--depends-on'))
  assert.ok(out.includes('"id"'))
})

test('longtask_add_subtask: explicit ordinal skips the pre-read; dependsOn joins into one comma flag', async () => {
  const { tools, calls } = buildTools({ 'add-subtask': ok(SHOW_PAYLOAD.subtasks[0]) })
  await tools.find((tool) => tool.name === 'longtask_add_subtask')
    .execute({ taskId: 'lt-demo', title: 'Fourth', subtaskId: 'st-four', ordinal: 7, dependsOn: ['st-one', 'st-two'] }, {})
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, [
    'longtask', 'add-subtask', '--id', 'lt-demo', '--subtask', 'st-four',
    '--title', 'Fourth', '--ordinal', '7', '--depends-on', 'st-one,st-two', '--from', 'alice',
  ])
})

test('longtask_add_subtask: unreadable task surfaces the show failure, no add-subtask write', async () => {
  const { tools, calls } = buildTools({ show: fail('longtask_not_found', 'No long-term task lt-x.') })
  const out = await tools.find((tool) => tool.name === 'longtask_add_subtask')
    .execute({ taskId: 'lt-x', title: 'T' }, {})
  assert.equal(out, 'longtask_add_subtask failed: [longtask_not_found] No long-term task lt-x.')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].args[1], 'show')
})

test('longtask_set_status: unknown status is rejected locally with zero run calls', async () => {
  const { tools, calls } = buildTools({ 'set-status': ok({}) })
  const out = await tools.find((tool) => tool.name === 'longtask_set_status')
    .execute({ taskId: 'lt-demo', subtaskId: 'st-two', status: 'done' }, {})
  assert.match(out, /longtask_set_status failed: unknown status "done"\. Valid statuses: pending, in_progress, waiting_owner, waiting_external, accepted, rejected, skipped\./)
  assert.equal(calls.length, 0)
})

test('longtask_set_status: missing taskId/subtaskId rejected locally, zero run calls', async () => {
  const { tools, calls } = buildTools({ 'set-status': ok({}) })
  const set = tools.find((tool) => tool.name === 'longtask_set_status')
  assert.match(await set.execute({ subtaskId: 'st-two', status: 'pending' }, {}), /taskId is required\./)
  assert.match(await set.execute({ taskId: 'lt-demo', status: 'pending' }, {}), /subtaskId is required\./)
  assert.equal(calls.length, 0)
})

test('longtask_set_status: allowed move renders the row without warnings', async () => {
  const { tools, calls } = buildTools({ show: ok(SHOW_PAYLOAD), 'set-status': ok({ ...SHOW_PAYLOAD.subtasks[1], status: 'waiting_external' }) })
  const out = await tools.find((tool) => tool.name === 'longtask_set_status')
    .execute({ taskId: 'lt-demo', subtaskId: 'st-two', status: 'waiting_external' }, {})
  assert.deepEqual(calls[1].args, ['longtask', 'set-status', '--id', 'lt-demo', '--subtask', 'st-two', '--status', 'waiting_external', '--from', 'alice'])
  assert.ok(!out.includes('WARNING'))
  assert.ok(!out.includes('NOTE'))
})

test('longtask_set_status: unusual transition is applied WITH a warning (soft guard, not a refusal)', async () => {
  const { tools, calls } = buildTools({ show: ok(SHOW_PAYLOAD), 'set-status': ok({ ...SHOW_PAYLOAD.subtasks[0], status: 'pending' }) })
  const out = await tools.find((tool) => tool.name === 'longtask_set_status')
    .execute({ taskId: 'lt-demo', subtaskId: 'st-one', status: 'pending' }, {})
  assert.equal(calls.length, 2) // pre-read + write — the move goes through
  assert.match(out, /WARNING: transition accepted -> pending is outside the reference lifecycle/)
  assert.match(out, /does not gate transitions/)
})

test('longtask_set_status: accepted always carries the ungated-acceptance note', async () => {
  const { tools } = buildTools({ show: ok(SHOW_PAYLOAD), 'set-status': ok({ ...SHOW_PAYLOAD.subtasks[1], status: 'accepted' }) })
  const out = await tools.find((tool) => tool.name === 'longtask_set_status')
    .execute({ taskId: 'lt-demo', subtaskId: 'st-two', status: 'accepted' }, {})
  assert.match(out, /acceptance is ungated here/)
  assert.match(out, /owner's explicit verdict/)
  assert.ok(!out.includes('WARNING'), 'in_progress -> accepted is a reference move')
})

test('longtask_set_status: pre-read missing subtask synthesizes the CLI envelope, no write', async () => {
  const { tools, calls } = buildTools({ show: ok(SHOW_PAYLOAD), 'set-status': ok({}) })
  const out = await tools.find((tool) => tool.name === 'longtask_set_status')
    .execute({ taskId: 'lt-demo', subtaskId: 'st-missing', status: 'in_progress' }, {})
  assert.equal(out, 'longtask_set_status failed: [longtask_subtask_not_found] No sub-task st-missing in lt-demo.')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].args[1], 'show')
})

test('longtask_advance: argv and report render', async () => {
  const report = { checkedTasks: 1, decisions: [{ taskId: 'lt-demo', reasons: ['stale'] }], skipped: [], applied: 1 }
  const { tools, calls } = buildTools({ advance: ok(report) })
  const out = await tools.find((tool) => tool.name === 'longtask_advance').execute({}, {})
  assert.deepEqual(calls[0].args, ['longtask', 'advance', '--from', 'alice'])
  assert.match(out, /"applied": 1/)
})

test('description lint (pitfall ③): no PR-1 description references a stage-2 or IDBots-only verb', () => {
  const host = fakeHost()
  plugin.bindLongtaskToolInstall(host.ctx)
  const forbidden = [
    /longtask_note/, /longtask_wait/, /longtask_set_stage/, /longtask_unblock/,
    /longtask_delegation_anchor/, /longterm_/, /local_worker_delegate/, /metatask_/,
  ]
  for (const tool of host.tools) {
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(tool.description), `${tool.name} description must not match ${pattern}`)
    }
  }
})

test('longtask_set_status: schema enum carries the 7 statuses and the description states the ungated discipline', () => {
  const host = fakeHost()
  plugin.bindLongtaskToolInstall(host.ctx)
  const def = host.tools.find((tool) => tool.name === 'longtask_set_status')
  assert.deepEqual(def.parameters.properties.status.enum, [
    'pending', 'in_progress', 'waiting_owner', 'waiting_external', 'accepted', 'rejected', 'skipped',
  ])
  assert.match(def.description, /acceptance is NOT gated/)
  assert.match(def.description, /YOU hold the discipline/)
  assert.match(def.description, /owner's explicit verdict/)
})
