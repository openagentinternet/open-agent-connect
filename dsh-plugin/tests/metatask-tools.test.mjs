// Bridge tests for the metatask read tools (PR-1: metatask_list /
// metatask_get / metatask_replay). Fake-run only: argv spelling, envelope
// rendering, CLI failure relaying, and the description-discipline invariants.
// No daemon, no chain, no ports. Protocol truth lives in oac-src/tests/metatask/.
import assert from 'node:assert/strict'
import test from 'node:test'

const plugin = await import('../lib/metatask-tools.js')

const TOOL_NAMES = ['metatask_list', 'metatask_get', 'metatask_replay']

function fakeHost(overrides = {}) {
  const tools = []
  return {
    tools,
    ctx: {
      tools: { register: (definition) => tools.push(definition) },
      logger: { warn: () => undefined },
      ...overrides,
    },
  }
}

/** Fake run: captures {args, options} per call and returns a fixed envelope. */
function fakeRun(result) {
  const calls = []
  const run = async (args, options) => {
    calls.push({ args, options })
    return result ?? { ok: true, state: 'success', data: {} }
  }
  return { calls, run }
}

function toolsWith(run) {
  const host = fakeHost()
  const definitions = plugin.buildMetataskTools({ host: host.ctx, hostAgent: { ctx: host.ctx }, run })
  return { host, definitions }
}

// ── fixtures (minimal board + task payloads, shaped on the daemon contract:
//    src/core/metatask/store.ts MetaTaskBoardTask / engine MetaTaskTaskProjection) ──

const ROOT_A = `f${'0'.repeat(63)}i0`
const ROOT_B = `e${'1'.repeat(63)}i0`

const BOARD = {
  localRosterMetaIds: ['idq1rosterbot00'],
  tasks: [
    {
      rootPinId: ROOT_A,
      title: 'Formalize lemma L1',
      brief: 'Lean formalization race',
      publisher: 'idq1publisher00',
      tags: ['lean'],
      mode: 'competitive',
      taskComplete: false,
      progress: { total: 4, verified: 1, claimed: 1, open: 2, disputed: 0, satisfied: 1 },
      participantCount: 3,
      lastActivityMs: 1000,
      freshness: { boundaryBlock: 193800, evaluatedAtMs: 2000, eventCount: 12 },
      myRoles: ['participant'],
      myStats: { claimed: 1, submitted: 2, verified: 1, reviewVotes: 3, shareBP: 0, estShareBP: 610 },
      settlementFinalized: false,
    },
    {
      rootPinId: ROOT_B,
      title: 'Index docs',
      brief: 'Doc index sweep',
      publisher: 'idq1other99999',
      tags: [],
      mode: 'tree',
      taskComplete: true,
      progress: { total: 2, verified: 2, claimed: 0, open: 0, disputed: 0, satisfied: 2 },
      participantCount: 2,
      lastActivityMs: 500,
      freshness: { boundaryBlock: 193790, evaluatedAtMs: 1500, eventCount: 7 },
      myRoles: [],
      myStats: null,
      settlementFinalized: true,
    },
  ],
  identities: {
    idq1publisher00: { metaId: 'idq1publisher00', name: 'Poly Trader', avatar: 'metafile://avatarpin0' },
    idq1other99999: { metaId: 'idq1other99999', name: null, avatar: null },
  },
  alerts: [],
  activation: { hAct2: 191500, hAct3: 192000 },
  refresh: { lastRefreshAtMs: 3000, lastOkAtMs: 3000, lastError: null, boundaryBlock: 193800, refreshing: false, seq: 9 },
}

const TASK = {
  rootPinId: ROOT_A,
  title: 'Formalize lemma L1',
  brief: 'Lean formalization race',
  publisher: 'idq1publisher00',
  tags: ['lean'],
  policy: {
    claimTtlHours: 24, verifyQuorum: 2, verifyWindowHours: 48, rewardSat: 0, challengeTtlDays: 14,
    hasSplit: true, rosterid: null, submitterShareBP: 8000, mode: 'competitive', finalNode: 'n3',
  },
  nodes: [],
  amendHead: ROOT_A,
  nodeStates: {
    n1: {
      id: 'n1', parent: null, title: 'Triage', kind: 'triage', weight: 1000, params: null, specid: null, deps: [],
      status: 'verified', disputed: false, holder: null,
      submission: { pinId: `a${'2'.repeat(63)}i0`, submitter: 'idq1worker111', atMs: 1, superseded: false, result: { ok: 1 }, hash: null, contentType: null, attachment: null, parentrefs: {} },
      passVotes: 2, failVotes: 0, votes: [], cycleCount: 1,
    },
    n2: {
      id: 'n2', parent: 'n1', title: 'Search', kind: 'search', weight: 3000, params: null, specid: null, deps: ['n1'],
      status: 'claimed', disputed: false, holder: { pinId: `b${'3'.repeat(63)}i0`, claimant: 'idq1worker222', sinceMs: 5 },
      submission: null, passVotes: 0, failVotes: 0, votes: [], cycleCount: 0,
    },
    n3: {
      id: 'n3', parent: 'n1', title: 'Proof', kind: 'proof', weight: 6000, params: null, specid: null, deps: ['n2'],
      status: 'open', disputed: false, holder: null,
      submission: null, passVotes: 0, failVotes: 0, votes: [], cycleCount: 0,
    },
  },
  progress: { total: 3, verified: 1, claimed: 1, open: 1, disputed: 0, satisfied: 1 },
  taskComplete: false,
  participants: [
    { metaId: 'idq1worker111', effectiveClaims: 1, submissions: 2, verifiedContrib: 1, reviewVotes: 3, reviewCorrect: 2, reviewTerminal: 3 },
  ],
  identities: {
    idq1publisher00: { metaId: 'idq1publisher00', name: 'Poly Trader', avatar: 'metafile://avatarpin0' },
    idq1worker111: { metaId: 'idq1worker111', name: 'W1', avatar: null },
  },
  settlement: null,
  freshness: { boundaryBlock: 193800, evaluatedAtMs: 2000, eventCount: 12, eventSetHash: 'deadbeef', expiryApplied: false },
  lastActivityMs: 9000,
  ignoredEvents: [],
  estimation: {
    basis: 'weighted',
    shares: [{ metaId: 'idq1worker111', shareBP: 8000, from: { submittedBP: 6000, reviewedBP: 2000 } }],
  },
  openNodes: [
    { id: 'n2', title: 'Search', status: 'claimed', kind: 'search', weight: 3000, deps: ['n1'] },
    { id: 'n3', title: 'Proof', status: 'open', kind: 'proof', weight: 6000, deps: ['n2'] },
  ],
}

// ── registration ─────────────────────────────────────────────────────────────

test('bindMetataskToolInstall registers exactly the three read tools', () => {
  const host = fakeHost()
  plugin.bindMetataskToolInstall(host.ctx)
  assert.deepEqual(host.tools.map((tool) => tool.name), TOOL_NAMES)
})

// ── argv spelling (identical to the metatask-routes.ts dispatcher) ──────────

test('metatask_list argv: cache read, then --refresh appended with the longer timeout', async () => {
  const { calls, run } = fakeRun({ ok: true, state: 'success', data: BOARD })
  const { definitions } = toolsWith(run)
  const list = definitions.find((tool) => tool.name === 'metatask_list')
  await list.execute({}, {})
  assert.deepEqual(calls[0].args, ['metatask', 'list'])
  assert.equal(calls[0].options.timeoutMs, 60_000)
  await list.execute({ refresh: true }, {})
  assert.deepEqual(calls[1].args, ['metatask', 'list', '--refresh'])
  assert.equal(calls[1].options.timeoutMs, 180_000)
  assert.equal(calls.length, 2)
})

test('metatask_get argv: --root plumbing; missing rootPinId fails locally with zero run calls', async () => {
  const { calls, run } = fakeRun({ ok: true, state: 'success', data: TASK })
  const { definitions } = toolsWith(run)
  const get = definitions.find((tool) => tool.name === 'metatask_get')
  const localError = await get.execute({}, {})
  assert.match(localError, /metatask_get failed: rootPinId is required\./)
  assert.equal(calls.length, 0, 'no CLI call for a missing root')

  await get.execute({ rootPinId: ROOT_A }, {})
  assert.deepEqual(calls[0].args, ['metatask', 'get', '--root', ROOT_A])
  assert.equal(calls[0].options.timeoutMs, 60_000)
  await get.execute({ rootPinId: ROOT_A, refresh: true }, {})
  assert.deepEqual(calls[1].args, ['metatask', 'get', '--root', ROOT_A, '--refresh'])
  assert.equal(calls[1].options.timeoutMs, 180_000)
})

test('metatask_replay argv: --root only; missing rootPinId fails locally with zero run calls', async () => {
  const { calls, run } = fakeRun({ ok: true, state: 'success', data: { rootPinId: ROOT_A } })
  const { definitions } = toolsWith(run)
  const replay = definitions.find((tool) => tool.name === 'metatask_replay')
  const localError = await replay.execute({}, {})
  assert.match(localError, /metatask_replay failed: rootPinId is required\./)
  assert.equal(calls.length, 0)

  await replay.execute({ rootPinId: ROOT_A }, {})
  assert.deepEqual(calls[0].args, ['metatask', 'replay', '--root', ROOT_A])
  assert.equal(calls[0].options.timeoutMs, 60_000)
})

// ── envelope rendering ───────────────────────────────────────────────────────

test('metatask_replay success renders the payload JSON pass-through', async () => {
  const replayData = {
    rootPinId: ROOT_A, title: 'Formalize lemma L1', policy: { mode: 'competitive' },
    nodes: [{ id: 'n1', title: 'Triage', status: 'verified', disputed: false, holder: null, submitter: 'idq1worker111', passVotes: 2, failVotes: 0, weight: 1000 }],
    progress: { total: 1, verified: 1, claimed: 0, open: 0, disputed: 0, satisfied: 1 },
    taskComplete: true, settlement: null, estimation: null, ignoredEvents: [], freshness: { boundaryBlock: 193800, evaluatedAtMs: 2, eventCount: 12, eventSetHash: 'x', expiryApplied: false },
  }
  const { run } = fakeRun({ ok: true, state: 'success', data: replayData })
  const { definitions } = toolsWith(run)
  const out = await definitions.find((tool) => tool.name === 'metatask_replay').execute({ rootPinId: ROOT_A }, {})
  assert.match(out, /pure derivation over the cached chain events/)
  assert.ok(out.includes('"rootPinId"'), 'raw result.data JSON is echoed')
  assert.ok(out.includes('"taskComplete": true'))
})

test('metatask_list success renders the compact board and does not echo the identity map', async () => {
  const { run } = fakeRun({ ok: true, state: 'success', data: BOARD })
  const { definitions } = toolsWith(run)
  const out = await definitions.find((tool) => tool.name === 'metatask_list').execute({}, {})
  assert.match(out, /# MetaTask board — 2 task\(s\)/)
  assert.ok(out.includes(`(pin://${ROOT_A})`), 'task A root pin in full')
  assert.ok(out.includes(`(pin://${ROOT_B})`), 'task B root pin in full')
  assert.match(out, /Formalize lemma L1/)
  assert.match(out, /author Poly Trader/, 'identities map is consumed for display names')
  assert.match(out, /progress 1\/4 done/)
  assert.match(out, /my roles: participant/)
  assert.match(out, /share 0 bp \(est\. 610 bp\)/)
  assert.match(out, /settlement finalized/)
  assert.match(out, /Board boundary block: 193800/)
  // Compaction: the raw identity map / roster / activation blocks never appear.
  assert.ok(!out.includes('"identities"'), 'identity map not echoed as JSON')
  assert.ok(!out.includes('avatarpin0'), 'avatar metafile URIs not echoed')
  assert.ok(!out.includes('localRosterMetaIds'), 'roster block not echoed')
})

test('metatask_get success renders the compact task view (nodes, openNodes, estimation, freshness)', async () => {
  const { run } = fakeRun({ ok: true, state: 'success', data: TASK })
  const { definitions } = toolsWith(run)
  const out = await definitions.find((tool) => tool.name === 'metatask_get').execute({ rootPinId: ROOT_A }, {})
  assert.ok(out.includes(`(pin://${ROOT_A})`))
  assert.match(out, /mode competitive/)
  assert.match(out, /progress 1\/3 done/)
  assert.match(out, /openNodes \(every node still short of done — idle and in-flight\): n2\(claimed\), n3\(open\)/)
  assert.match(out, /n1 \[verified\]/)
  assert.match(out, /n2 \[claimed\]/)
  assert.match(out, /n3 \[open\]/)
  assert.match(out, /votes=2✓\/0✗/)
  assert.match(out, /participants \(1\): W1/)
  assert.match(out, /estimation \(if it settled now, weighted basis\): W1 8000 bp/)
  assert.match(out, /freshness: boundary block 193800, 12 events/)
  assert.ok(!out.includes('"identities"'), 'identity map not echoed as JSON')
})

test('metatask_list empty board renders the refresh guidance line', async () => {
  const { run } = fakeRun({ ok: true, state: 'success', data: { tasks: [] } })
  const { definitions } = toolsWith(run)
  const out = await definitions.find((tool) => tool.name === 'metatask_list').execute({}, {})
  assert.match(out, /# MetaTask board — 0 task\(s\)/)
  assert.match(out, /pass refresh=true to sweep the chain first/)
})

// ── CLI failure relaying ─────────────────────────────────────────────────────

test('ok:false renders the metatask_<verb> failed: [<code>] <message> envelope verbatim', async () => {
  const { run } = fakeRun({
    ok: false, state: 'failed', code: 'metatask_not_found',
    message: `No cached projection for task root ${ROOT_A}. Run a refresh first.`,
  })
  const { definitions } = toolsWith(run)
  const out = await definitions.find((tool) => tool.name === 'metatask_get').execute({ rootPinId: ROOT_A }, {})
  assert.equal(
    out,
    `metatask_get failed: [metatask_not_found] No cached projection for task root ${ROOT_A}. Run a refresh first.`,
  )
})

test('connectivity-shaped failures append the start-the-daemon hint', async () => {
  const { run } = fakeRun({
    ok: false, state: 'failed', code: 'metatask_board_failed',
    message: 'fetch failed: ECONNREFUSED 127.0.0.1:8787',
  })
  const { definitions } = toolsWith(run)
  const out = await definitions.find((tool) => tool.name === 'metatask_list').execute({}, {})
  assert.match(out, /metatask_list failed: \[metatask_board_failed\] fetch failed: ECONNREFUSED 127\.0\.0\.1:8787/)
  assert.match(out, /OAC daemon running — start it and retry/)
})

test('a thrown CLI-bridge error surfaces as the same string envelope', async () => {
  const run = async () => {
    throw new Error('metabot timed out after 60000ms')
  }
  const { definitions } = toolsWith(run)
  const out = await definitions.find((tool) => tool.name === 'metatask_replay').execute({ rootPinId: ROOT_A }, {})
  assert.match(out, /metatask_replay failed: metabot timed out after 60000ms/)
  assert.match(out, /OAC daemon running — start it and retry/)
})

// ── description discipline (wayfinding: participation verbs land later) ─────

test('no read-tool description mentions the later participation tools or verbs', () => {
  const host = fakeHost()
  plugin.bindMetataskToolInstall(host.ctx)
  for (const tool of host.tools) {
    assert.doesNotMatch(
      tool.description,
      /metatask_claim|submit|verify|publish|amend/,
      `${tool.name} description must not point at participation verbs (they land in later PRs)`,
    )
    assert.match(tool.description, /daemon/, `${tool.name} description must state the daemon requirement`)
  }
})

// ── shared helper surface (consumed by the participation round) ─────────────

test('metataskActorSlug resolves via the live agent, else the composed preset', () => {
  // Live branch: an oac-* composed preset resolves to the bare slug.
  const live = plugin.metataskActorSlug(
    { agentPresets: { composedPreset: () => 'oac-y' } },
    { ctx: {} },
    { agent: { ctx: {} } },
  )
  assert.equal(live, 'y')
  // Fallback branch: a non-oac preset id passes through without the oac- prefix.
  const preset = plugin.metataskActorSlug(
    { agentPresets: { composedPreset: () => 'preset-x' } },
    { ctx: {} },
    {},
  )
  assert.equal(preset, 'preset-x')
  // No presets at all: empty slug (read tools never need an actor anyway).
  const none = plugin.metataskActorSlug({ agentPresets: {} }, { ctx: {} }, {})
  assert.equal(none, '')
})
