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
  'longtask_note',
  'longtask_set_stage',
  'longtask_wait',
  'longtask_unblock',
  'longtask_delegation_anchor',
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

test('bindLongtaskToolInstall registers exactly the eleven longtask tools, no prompt sections', () => {
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

test('description lint (pitfall ③): no description references a verb that does not exist on this board', () => {
  const host = fakeHost()
  plugin.bindLongtaskToolInstall(host.ctx)
  // Stage-2 names (longtask_note/wait/set_stage/unblock/delegation_anchor) are
  // now ALLOWED references, as is local_worker_delegate (round-1, merged).
  // Still forbidden: IDBots-only verbs (longterm_* tool names — the
  // <longterm_anchor> MARKER itself is fine), metatask_*, and gated lifecycle
  // verbs this board deliberately collapses into set_status + note.
  const forbidden = [
    /longterm_task_/, /longterm_subtask_/, /longterm_event_note/, /longterm_delegation_anchor/,
    /metatask_/,
    /longtask_task_complete/, /longtask_subtask_update/,
    /longtask_propose/, /longtask_accept\b/, /longtask_reject\b/, /longtask_skip\b/,
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

// ---------------------------------------------------------------------------
// Stage-2 lifecycle tools (PR-3): note / set_stage / wait / unblock / anchor.
// Composed tools assert BOTH argv sequences in order; a failure of the first
// call must abort before the second (zero second calls).
// ---------------------------------------------------------------------------

test('longtask_note: exact argv with and without --subtask; missing text rejected locally', async () => {
  const { tools, calls } = buildTools({ note: ok({ id: 'e1' }) })
  const note = tools.find((tool) => tool.name === 'longtask_note')
  await note.execute({ taskId: 'lt-demo', subtaskId: 'st-two', text: 'owner picked B' }, {})
  assert.deepEqual(calls[0].args, [
    'longtask', 'note', '--id', 'lt-demo', '--subtask', 'st-two', '--text', 'owner picked B', '--from', 'alice',
  ])
  await note.execute({ taskId: 'lt-demo', text: 'task-level note' }, {})
  assert.deepEqual(calls[1].args, ['longtask', 'note', '--id', 'lt-demo', '--text', 'task-level note', '--from', 'alice'])
  assert.match(await note.execute({ taskId: 'lt-demo' }, {}), /longtask_note failed: text is required\./)
  assert.equal(calls.length, 2)
})

test('longtask_note: failure envelope keeps the CLI code verbatim', async () => {
  const { tools } = buildTools({ note: fail('longtask_subtask_not_found', 'No sub-task st-x in lt-demo.') })
  const out = await tools.find((tool) => tool.name === 'longtask_note')
    .execute({ taskId: 'lt-demo', subtaskId: 'st-x', text: 'x' }, {})
  assert.equal(out, 'longtask_note failed: [longtask_subtask_not_found] No sub-task st-x in lt-demo.')
})

test('longtask_set_stage: argv, unknown stage rejected locally with zero calls', async () => {
  const { tools, calls } = buildTools({ 'set-stage': ok({ id: 'lt-demo', stage: 'paused' }) })
  const setStage = tools.find((tool) => tool.name === 'longtask_set_stage')
  const out = await setStage.execute({ taskId: 'lt-demo', stage: 'paused' }, {})
  assert.deepEqual(calls[0].args, ['longtask', 'set-stage', '--id', 'lt-demo', '--stage', 'paused', '--from', 'alice'])
  assert.match(out, /"stage": "paused"/)
  assert.match(await setStage.execute({ taskId: 'lt-demo', stage: 'defining' }, {}),
    /longtask_set_stage failed: unknown stage "defining"\. Valid stages: active, paused, cancelled, done\./)
  assert.equal(calls.length, 1)
})

test('longtask_set_stage: optional note runs as the SECOND call; note failure surfaces partial truth', async () => {
  const { tools, calls } = buildTools({
    'set-stage': ok({ id: 'lt-demo', stage: 'paused' }),
    note: fail('longtask_not_found', 'No long-term task lt-demo.'),
  })
  const out = await tools.find((tool) => tool.name === 'longtask_set_stage')
    .execute({ taskId: 'lt-demo', stage: 'paused', note: 'parked until owner returns' }, {})
  assert.equal(calls.length, 2, 'both calls fire')
  assert.deepEqual(calls[0].args, ['longtask', 'set-stage', '--id', 'lt-demo', '--stage', 'paused', '--from', 'alice'])
  assert.deepEqual(calls[1].args, ['longtask', 'note', '--id', 'lt-demo', '--text', 'parked until owner returns', '--from', 'alice'])
  assert.match(out, /the stage IS set, but the follow-up note failed/)
  assert.match(out, /\[longtask_not_found\]/)
})

test('longtask_wait: BOTH calls in order — set-status waiting_owner, then note with the brief; brief rides the output', async () => {
  const brief = '1) background… 2) situation… 3) the decision: pick A or B 4) options… 5) recommend B 6) next steps…'
  const { tools, calls } = buildTools({
    'set-status': ok({ id: 'st-two', status: 'waiting_owner' }),
    note: ok({ id: 'e1', kind: 'note' }),
  })
  const out = await tools.find((tool) => tool.name === 'longtask_wait')
    .execute({ taskId: 'lt-demo', subtaskId: 'st-two', kind: 'owner', brief }, {})
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].args, [
    'longtask', 'set-status', '--id', 'lt-demo', '--subtask', 'st-two', '--status', 'waiting_owner', '--from', 'alice',
  ])
  assert.deepEqual(calls[1].args, [
    'longtask', 'note', '--id', 'lt-demo', '--subtask', 'st-two', '--text', brief, '--from', 'alice',
  ])
  assert.match(out, /Parked st-two on waiting_owner/)
  assert.match(out, /--- decision brief \(present this to the owner in this turn\) ---/)
  assert.ok(out.includes(brief), 'the brief is returned for in-band presentation')
})

test('longtask_wait: a failure of the FIRST call aborts before the note (zero second calls)', async () => {
  const { tools, calls } = buildTools({
    'set-status': fail('longtask_subtask_not_found', 'No sub-task st-x in lt-demo.'),
    note: ok({ id: 'e1' }),
  })
  const out = await tools.find((tool) => tool.name === 'longtask_wait')
    .execute({ taskId: 'lt-demo', subtaskId: 'st-x', kind: 'owner', brief: 'b' }, {})
  assert.equal(out, 'longtask_wait failed: [longtask_subtask_not_found] No sub-task st-x in lt-demo.')
  assert.equal(calls.length, 1, 'the note never fires')
})

test('longtask_wait: second-call failure surfaces the partial state honestly', async () => {
  const { tools, calls } = buildTools({
    'set-status': ok({ id: 'st-two', status: 'waiting_owner' }),
    note: fail('longtask_not_found', 'No long-term task lt-demo.'),
  })
  const out = await tools.find((tool) => tool.name === 'longtask_wait')
    .execute({ taskId: 'lt-demo', subtaskId: 'st-two', kind: 'owner', brief: 'b' }, {})
  assert.equal(calls.length, 2)
  assert.match(out, /the status IS set, but the follow-up note failed/)
  assert.match(out, /re-journal the brief with longtask_note/)
})

test('longtask_wait: external wait embeds waitUntil in the journaled note; owner+waitUntil refused locally', async () => {
  const { tools, calls } = buildTools({
    'set-status': ok({ id: 'st-two', status: 'waiting_external' }),
    note: ok({ id: 'e1' }),
  })
  await tools.find((tool) => tool.name === 'longtask_wait').execute({
    taskId: 'lt-demo', subtaskId: 'st-two', kind: 'external', brief: 'notary delivery',
    waitUntil: '2026-10-26T09:00:00+08:00',
  }, {})
  assert.equal(calls[0].args[calls[0].args.indexOf('--status') + 1], 'waiting_external')
  const noteText = calls[1].args[calls[1].args.indexOf('--text') + 1]
  assert.ok(noteText.startsWith('notary delivery'))
  assert.match(noteText, /wait until: 2026-10-26T09:00:00\+08:00/)
  assert.match(noteText, /nothing re-checks this automatically/)
  const refused = await tools.find((tool) => tool.name === 'longtask_wait').execute({
    taskId: 'lt-demo', subtaskId: 'st-two', kind: 'owner', brief: 'b', waitUntil: '2026-10-26T09:00:00+08:00',
  }, {})
  assert.match(refused, /longtask_wait failed: waitUntil applies to kind="external" waits only/)
  const badIso = await tools.find((tool) => tool.name === 'longtask_wait').execute({
    taskId: 'lt-demo', subtaskId: 'st-two', kind: 'external', brief: 'b', waitUntil: 'tomorrow',
  }, {})
  assert.match(badIso, /longtask_wait failed: waitUntil must be an ISO-8601 datetime/)
  assert.equal(calls.length, 2, 'both refusals happen before any run call')
})

test('longtask_unblock: set-status in_progress first, optional note second; without note exactly one call', async () => {
  const { tools, calls } = buildTools({
    'set-status': ok({ id: 'st-two', status: 'in_progress' }),
    note: ok({ id: 'e1' }),
  })
  const unblock = tools.find((tool) => tool.name === 'longtask_unblock')
  const out = await unblock.execute({ taskId: 'lt-demo', subtaskId: 'st-two', note: 'owner chose B' }, {})
  assert.deepEqual(calls[0].args, [
    'longtask', 'set-status', '--id', 'lt-demo', '--subtask', 'st-two', '--status', 'in_progress', '--from', 'alice',
  ])
  assert.deepEqual(calls[1].args, [
    'longtask', 'note', '--id', 'lt-demo', '--subtask', 'st-two', '--text', 'owner chose B', '--from', 'alice',
  ])
  assert.match(out, /journalled: owner chose B/)
  const bare = await unblock.execute({ taskId: 'lt-demo', subtaskId: 'st-two' }, {})
  assert.match(bare, /"status": "in_progress"/)
  assert.equal(calls.length, 3, 'the note-less unblock makes no second call')
})

test('longtask_unblock: first-call failure aborts before the note', async () => {
  const { tools, calls } = buildTools({
    'set-status': fail('longtask_subtask_not_found', 'No sub-task st-x in lt-demo.'),
    note: ok({ id: 'e1' }),
  })
  const out = await tools.find((tool) => tool.name === 'longtask_unblock')
    .execute({ taskId: 'lt-demo', subtaskId: 'st-x', note: 'n' }, {})
  assert.equal(out, 'longtask_unblock failed: [longtask_subtask_not_found] No sub-task st-x in lt-demo.')
  assert.equal(calls.length, 1)
})

test('longtask_delegation_anchor: show payload in → anchor block out (en template, IDBots line order)', async () => {
  const { tools, calls } = buildTools({ show: ok(SHOW_PAYLOAD) })
  const out = await tools.find((tool) => tool.name === 'longtask_delegation_anchor')
    .execute({ taskId: 'lt-demo', subtaskId: 'st-two' }, {})
  assert.deepEqual(calls[0].args, ['longtask', 'show', '--id', 'lt-demo', '--from', 'alice'])
  const lines = out.split('\n')
  assert.equal(lines[0], '<longterm_anchor>')
  assert.equal(lines.at(-1), '</longterm_anchor>')
  // Required lines lifted from the IDBots template (mini golden file).
  assert.ok(out.includes('taskId: lt-demo'))
  assert.ok(out.includes('subtaskId: st-two'))
  assert.ok(out.includes('Task: Demo task'))
  assert.ok(out.includes('Goal: Ship the demo'))
  assert.ok(out.includes('Sub-project #3: Second'))
  assert.ok(out.includes('Acceptance criteria:'))
  assert.match(out, /no acceptance-criteria column on this board — they live in the task goal text/)
  assert.ok(out.includes('Preferred channel: undecided'))
  assert.ok(out.includes('Current status: in_progress'))
  for (const duty of ['  1. Before acting, call longtask_show(taskId)', '  2. This delegation is one execution slice',
    '  3. Prove every acceptance criterion', '  4. Journal major findings']) {
    assert.ok(out.includes(duty), `missing duty line: ${duty}`)
  }
  // Events: the 5 newest, newest first, detail collapsed and clipped at 160.
  const eventLines = lines.filter((line) => line.startsWith('  - ['))
  assert.equal(eventLines.length, 2)
  assert.match(eventLines[0], /^\s+- \[advance\/system\] x{160}$/, 'newest event first, clipped to the 160-char budget')
  assert.match(eventLines[1], /\[task_created\/local\] created/)
})

test('longtask_delegation_anchor: missing subtask synthesizes the CLI envelope, no anchor rendered', async () => {
  const { tools, calls } = buildTools({ show: ok(SHOW_PAYLOAD) })
  const out = await tools.find((tool) => tool.name === 'longtask_delegation_anchor')
    .execute({ taskId: 'lt-demo', subtaskId: 'st-missing' }, {})
  assert.equal(out, 'longtask_delegation_anchor failed: [longtask_subtask_not_found] No sub-task st-missing in lt-demo.')
  assert.equal(calls.length, 1)
})

test('longtask_delegation_anchor: zh template follows the IDBots lines', async () => {
  const zh = plugin.buildLongtaskDelegationAnchor({
    task: { id: 'lt-demo', title: 'Demo task', goal: 'Ship the demo' },
    subtask: SHOW_PAYLOAD.subtasks[1],
    events: [],
    language: 'zh',
  })
  assert.equal(zh.split('\n')[0], '<longterm_anchor>')
  for (const line of [
    '任务: Demo task',
    '目标: Ship the demo',
    '子项目 #3: Second',
    '验收标准:',
    '执行通道: 未定（本看板无通道字段）',
    '当前状态: in_progress',
    '工作要求:',
  ]) {
    assert.ok(zh.includes(line), `missing zh line: ${line}`)
  }
  assert.match(zh, /longtask_show\(taskId\) 读取全量上下文/)
  assert.match(zh, /longtask_note\(taskId, subtaskId\) 记回任务事件流/)
  assert.ok(!zh.includes('近期动态'), 'no events → no recent-events header')
})

test('stage-2 schemas: set_stage carries the 4 stages; wait carries owner/external; wait description pins the degraded form', () => {
  const host = fakeHost()
  plugin.bindLongtaskToolInstall(host.ctx)
  const setStage = host.tools.find((tool) => tool.name === 'longtask_set_stage')
  assert.deepEqual(setStage.parameters.properties.stage.enum, ['active', 'paused', 'cancelled', 'done'])
  const wait = host.tools.find((tool) => tool.name === 'longtask_wait')
  assert.deepEqual(wait.parameters.properties.kind.enum, ['owner', 'external'])
  assert.match(wait.description, /no host heartbeat re-presents waits/)
  assert.match(wait.description, /present it to the owner in this same conversation turn/)
  assert.match(wait.description, /six-section decision discipline/)
  assert.match(wait.description, /NOTHING re-checks it automatically/)
  const anchor = host.tools.find((tool) => tool.name === 'longtask_delegation_anchor')
  assert.match(anchor.description, /local_worker_delegate/)
  assert.match(anchor.description, /<longterm_anchor>/)
})
