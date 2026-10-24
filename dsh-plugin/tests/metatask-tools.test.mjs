// Bridge tests for the metatask publisher-write tools (PR-3:
// metatask_publish / metatask_publish_spec / metatask_amend). Fake-run only:
// argv spelling, --request-file body shape, file-mode/inline mutual exclusion
// (local, readable), envelope rendering, refusal pass-through, and the
// description-discipline invariants. No daemon, no chain, no ports. Protocol
// truth (publish invariants, H_ACT gates, frozen-node rules) lives in
// oac-src/tests/metatask/ and is NOT re-tested here.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const plugin = await import('../lib/metatask-tools.js')

const TOOL_NAMES = ['metatask_publish', 'metatask_publish_spec', 'metatask_amend']

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

/** Fake run: captures {args, options, payload} per call. */
function fakeRun(result) {
  const calls = []
  const run = async (args, options) => {
    // runMetabotWithPayloadFile deletes its temp payload on return, so the
    // payload must be captured synchronously here.
    const flagIndex = args.indexOf('--request-file')
    const payloadPath = flagIndex >= 0 ? args[flagIndex + 1] : null
    calls.push({
      args,
      options,
      payload: payloadPath ? JSON.parse(readFileSync(payloadPath, 'utf8')) : undefined,
    })
    return result ?? { ok: true, state: 'success', data: {} }
  }
  return { calls, run }
}

/** A host whose session agent resolves to the OAC bot slug `beta`. */
function slugHost() {
  return fakeHost({ agentPresets: { composedPreset: () => 'oac-beta' } })
}

function toolsWith(host, run) {
  const definitions = plugin.buildMetataskTools({ host: host.ctx, hostAgent: { ctx: host.ctx }, run })
  return { host, definitions }
}

// ── fixtures ─────────────────────────────────────────────────────────────────

const ROOT = `f${'0'.repeat(63)}i0`
const TASK_PIN = `e${'5'.repeat(63)}i0`
const DRAFTS_PATH = fileURLToPath(new URL('./fixtures/metatask-drafts.json', import.meta.url))

const INLINE_TASK = {
  title: 'Demo campaign',
  brief: 'Inline publish body',
  nodes: [{ id: 'n1', parent: null, title: 'Triage', kind: 'triage', weight: 10000 }],
  spec: { name: 'demo-root-spec', lang: 'bash', entry: 'check.sh', script: 'exit 0\n' },
  policy: { verifyQuorum: 2, claimTtlHours: 24, verifyWindowHours: 48 },
  tags: ['demo'],
}

// ── registration ─────────────────────────────────────────────────────────────

test('bindMetataskToolInstall registers exactly the three publisher tools', () => {
  const host = slugHost()
  plugin.bindMetataskToolInstall(host.ctx)
  assert.deepEqual(host.tools.map((tool) => tool.name), TOOL_NAMES)
})

// ── actor plumbing ───────────────────────────────────────────────────────────

test('no OAC slug: every publisher tool refuses locally with zero run calls', async () => {
  const { calls, run } = fakeRun()
  const { definitions } = toolsWith(fakeHost(), run)
  const byName = (name) => definitions.find((tool) => tool.name === name)
  await byName('metatask_publish').execute({ title: 'x' }, {})
  await byName('metatask_publish_spec').execute({ name: 'x', lang: 'bash', entry: 'e', script: 's' }, {})
  await byName('metatask_amend').execute({ rootPinId: ROOT, ops: [{ op: 'retitle', node: 'n1', title: 't' }] }, {})
  assert.equal(calls.length, 0, 'a session without an OAC slug must never reach the CLI')
})

// ── metatask_publish ─────────────────────────────────────────────────────────

test('metatask_publish inline: payload keys exact; allowPreActivation rides as a boolean body key', async () => {
  const { calls, run } = fakeRun({ ok: true, state: 'success', data: { rootPinId: TASK_PIN } })
  const { definitions } = toolsWith(slugHost(), run)
  const out = await definitions.find((tool) => tool.name === 'metatask_publish').execute(
    { ...INLINE_TASK, allowPreActivation: true },
    {},
  )
  const { args, payload, options } = calls[0]
  assert.deepEqual(args.slice(0, 5), ['metatask', 'publish', '--from', 'beta', '--request-file'])
  assert.equal(typeof args[5], 'string', 'request-file path rides after the flag')
  assert.deepEqual(payload, { ...INLINE_TASK, allowPreActivation: true })
  assert.equal(payload.allowPreActivation, true, 'allowPreActivation serialized as boolean, one code path (body key, never a CLI flag)')
  assert.equal(options.timeoutMs, 300_000)
  assert.match(out, /"rootPinId"/, 'writer data is echoed as JSON')
})

test('metatask_publish inline minimal: allowPreActivation omitted when not true', async () => {
  const { calls, run } = fakeRun()
  const { definitions } = toolsWith(slugHost(), run)
  await definitions.find((tool) => tool.name === 'metatask_publish').execute({ title: 'T', allowPreActivation: false }, {})
  assert.deepEqual(calls[0].payload, { title: 'T' }, 'false/absent allowPreActivation adds no key')
  await definitions.find((tool) => tool.name === 'metatask_publish').execute({ title: 'T' }, {})
  assert.deepEqual(calls[1].payload, { title: 'T' })
})

test('metatask_publish file mode: payload is exactly {draftsFile, taskId} (+specPinByKey); fixture path forwarded verbatim', async () => {
  const { calls, run } = fakeRun()
  const { definitions } = toolsWith(slugHost(), run)
  await definitions.find((tool) => tool.name === 'metatask_publish').execute(
    { draftsFile: DRAFTS_PATH, taskId: 'demo-campaign' },
    {},
  )
  assert.deepEqual(calls[0].payload, { draftsFile: DRAFTS_PATH, taskId: 'demo-campaign' })
  await definitions.find((tool) => tool.name === 'metatask_publish').execute(
    { draftsFile: DRAFTS_PATH, taskId: 'demo-campaign', specPinByKey: { 'witness-extraction': 'pin://x0' } },
    {},
  )
  assert.deepEqual(calls[1].payload, {
    draftsFile: DRAFTS_PATH,
    taskId: 'demo-campaign',
    specPinByKey: { 'witness-extraction': 'pin://x0' },
  })
})

test('metatask_publish: BOTH draftsFile and inline title → local mutual-exclusion error, zero run calls', async () => {
  const { calls, run } = fakeRun()
  const { definitions } = toolsWith(slugHost(), run)
  const out = await definitions.find((tool) => tool.name === 'metatask_publish').execute(
    { draftsFile: DRAFTS_PATH, taskId: 'demo-campaign', title: 'mixed mode' },
    {},
  )
  assert.match(
    out,
    /metatask_publish failed: Refused: pass either draftsFile\+taskId OR inline arguments \(title\/brief\/nodes\/spec\/policy\/tags\), not both\./,
  )
  assert.equal(calls.length, 0)
})

test('metatask_publish: taskId without draftsFile (and vice versa) → must-be-passed-together refusal', async () => {
  const { calls, run } = fakeRun()
  const { definitions } = toolsWith(slugHost(), run)
  const publish = definitions.find((tool) => tool.name === 'metatask_publish')
  const noFile = await publish.execute({ taskId: 'demo-campaign' }, {})
  assert.match(noFile, /metatask_publish failed: Refused: draftsFile and taskId must be passed together/)
  const noId = await publish.execute({ draftsFile: DRAFTS_PATH }, {})
  assert.match(noId, /must be passed together/)
  assert.equal(calls.length, 0)
})

test('metatask_publish: specPinByKey without draftsFile → local refusal, zero run calls', async () => {
  const { calls, run } = fakeRun()
  const { definitions } = toolsWith(slugHost(), run)
  const out = await definitions.find((tool) => tool.name === 'metatask_publish').execute(
    { title: 'T', specPinByKey: { k: 'pin://x0' } },
    {},
  )
  assert.match(out, /metatask_publish failed: Refused: specPinByKey only applies in draftsFile mode \(pass draftsFile \+ taskId\)\./)
  assert.equal(calls.length, 0)
})

test('metatask_publish: inline without a title, and malformed shapes, refuse locally', async () => {
  const { calls, run } = fakeRun()
  const { definitions } = toolsWith(slugHost(), run)
  const publish = definitions.find((tool) => tool.name === 'metatask_publish')
  const noTitle = await publish.execute({ brief: 'b' }, {})
  assert.match(noTitle, /metatask_publish failed: Refused: title is empty\./)
  const badNodes = await publish.execute({ title: 'T', nodes: 'n1' }, {})
  assert.match(badNodes, /metatask_publish failed: nodes must be an array/)
  const badFlag = await publish.execute({ title: 'T', allowPreActivation: 'true' }, {})
  assert.match(badFlag, /metatask_publish failed: allowPreActivation must be a boolean/)
  assert.equal(calls.length, 0)
})

// ── metatask_publish_spec ────────────────────────────────────────────────────

test('metatask_publish_spec inline: payload keys exact (CLI verb is publish-spec)', async () => {
  const { calls, run } = fakeRun({ ok: true, state: 'success', data: { specPinId: `d${'6'.repeat(63)}i0` } })
  const { definitions } = toolsWith(slugHost(), run)
  await definitions.find((tool) => tool.name === 'metatask_publish_spec').execute(
    {
      name: 'witness-extraction-301',
      lang: 'python3',
      entry: 'spec-witness-extraction.py',
      script: '# verifier\n',
      input: { kind: 'submission-attachment' },
      output: 'pass | fail | invalid',
      workspace: { type: 'inline' },
      validation: { null_tolerance: true, enumeration_closure: { closure: 'rows', self_check_count: 3 }, proposition_fidelity: 'pin://aaaa' },
    },
    {},
  )
  const { args, payload, options } = calls[0]
  assert.deepEqual(args.slice(0, 5), ['metatask', 'publish-spec', '--from', 'beta', '--request-file'])
  assert.deepEqual(payload, {
    name: 'witness-extraction-301',
    lang: 'python3',
    entry: 'spec-witness-extraction.py',
    script: '# verifier\n',
    input: { kind: 'submission-attachment' },
    output: 'pass | fail | invalid',
    workspace: { type: 'inline' },
    validation: { null_tolerance: true, enumeration_closure: { closure: 'rows', self_check_count: 3 }, proposition_fidelity: 'pin://aaaa' },
  })
  assert.equal(options.timeoutMs, 300_000)
})

test('metatask_publish_spec: enforceHAct2Validation:false survives as a boolean; omitted otherwise', async () => {
  const { calls, run } = fakeRun()
  const { definitions } = toolsWith(slugHost(), run)
  const publishSpec = definitions.find((tool) => tool.name === 'metatask_publish_spec')
  await publishSpec.execute(
    { name: 'legacy', lang: 'bash', entry: 'e.sh', script: 'exit 0', enforceHAct2Validation: false },
    {},
  )
  assert.equal(calls[0].payload.enforceHAct2Validation, false)
  assert.equal(Object.keys(calls[0].payload).includes('enforceHAct2Validation'), true)
  await publishSpec.execute({ name: 'modern', lang: 'bash', entry: 'e.sh', script: 'exit 0' }, {})
  assert.equal('enforceHAct2Validation' in calls[1].payload, false, 'default (true) adds no key')
})

test('metatask_publish_spec file mode: payload {draftsFile, specKey}; partial and mixed modes refused locally', async () => {
  const { calls, run } = fakeRun()
  const { definitions } = toolsWith(slugHost(), run)
  const publishSpec = definitions.find((tool) => tool.name === 'metatask_publish_spec')
  await publishSpec.execute({ draftsFile: DRAFTS_PATH, specKey: 'witness-extraction' }, {})
  assert.deepEqual(calls[0].payload, { draftsFile: DRAFTS_PATH, specKey: 'witness-extraction' })
  const keyOnly = await publishSpec.execute({ specKey: 'witness-extraction' }, {})
  assert.match(keyOnly, /metatask_publish_spec failed: Refused: draftsFile and specKey must be passed together/)
  const mixed = await publishSpec.execute({ draftsFile: DRAFTS_PATH, specKey: 'witness-extraction', name: 'inline too' }, {})
  assert.match(
    mixed,
    /metatask_publish_spec failed: Refused: pass either draftsFile\+specKey OR inline arguments \(name\/lang\/entry\/script\/input\/output\/validation\/workspace\), not both\./,
  )
  assert.equal(calls.length, 1, 'only the clean file-mode call reached the CLI')
})

// ── metatask_amend ───────────────────────────────────────────────────────────

test('metatask_amend: payload is EXACTLY {root, ops} — bases is daemon-owned and absent', async () => {
  const { calls, run } = fakeRun({ ok: true, state: 'success', data: { amendPinId: `7${'7'.repeat(63)}i0` } })
  const { definitions } = toolsWith(slugHost(), run)
  const ops = [
    { op: 'retitle', node: 'n1', title: 'Retitled' },
    { op: 'reweight', node: 'n2', weight: 4000 },
  ]
  const out = await definitions.find((tool) => tool.name === 'metatask_amend').execute(
    { rootPinId: ROOT, ops, bases: ['caller must not send this'] },
    {},
  )
  const { args, payload, options } = calls[0]
  assert.deepEqual(args.slice(0, 5), ['metatask', 'amend', '--from', 'beta', '--request-file'])
  assert.deepEqual(payload, { root: ROOT, ops })
  assert.equal('bases' in payload, false, 'bases is computed daemon-side from the amend head — a caller value must never ride through')
  assert.equal(options.timeoutMs, 300_000)
  assert.match(out, /"amendPinId"/)
})

test('metatask_amend: empty/missing ops refuse locally, zero run calls', async () => {
  const { calls, run } = fakeRun()
  const { definitions } = toolsWith(slugHost(), run)
  const amend = definitions.find((tool) => tool.name === 'metatask_amend')
  const noOps = await amend.execute({ rootPinId: ROOT }, {})
  assert.match(noOps, /metatask_amend failed: ops must be a non-empty array/)
  const emptyOps = await amend.execute({ rootPinId: ROOT, ops: [] }, {})
  assert.match(emptyOps, /ops must be a non-empty array/)
  assert.equal(calls.length, 0)
})

// ── refusal pass-through ─────────────────────────────────────────────────────

test('writer refusals render verbatim through the failure envelope', async () => {
  const refusal = 'Refused: weights must sum to exactly 10000 after the fold (got 9000).'
  const { run } = fakeRun({ ok: false, state: 'failed', code: 'metatask_refused', message: refusal })
  const { definitions } = toolsWith(slugHost(), run)
  const out = await definitions.find((tool) => tool.name === 'metatask_publish').execute({ title: 'T' }, {})
  assert.equal(out, `metatask_publish failed: [metatask_refused] ${refusal}`)
})

test('a thrown CLI-bridge error surfaces with the daemon hint', async () => {
  const run = async () => {
    throw new Error('fetch failed: ECONNREFUSED 127.0.0.1:8787')
  }
  const { definitions } = toolsWith(slugHost(), run)
  const out = await definitions.find((tool) => tool.name === 'metatask_amend').execute(
    { rootPinId: ROOT, ops: [{ op: 'retitle', node: 'n1', title: 't' }] },
    {},
  )
  assert.match(out, /metatask_amend failed: fetch failed: ECONNREFUSED/)
  assert.match(out, /OAC daemon running — start it and retry/)
})

// ── description discipline ───────────────────────────────────────────────────

test('every publisher-tool description states the daemon requirement and the mode rules', () => {
  const host = slugHost()
  plugin.bindMetataskToolInstall(host.ctx)
  for (const tool of host.tools) {
    assert.match(tool.description, /daemon/, `${tool.name} description must state the daemon requirement`)
  }
  const publish = host.tools.find((tool) => tool.name === 'metatask_publish')
  assert.match(publish.description, /Never mix the two modes/, 'publish carries the never-mix rule')
  assert.match(publish.description, /post a discovery buzz within 24h/, 'publish carries the 24h discovery-buzz duty')
  assert.match(publish.description, /post_buzz/, 'the buzz duty cross-references the post_buzz tool')
  const amend = host.tools.find((tool) => tool.name === 'metatask_amend')
  assert.match(amend.description, /PUBLISHER only/, 'amend states it is publisher-only')
  assert.match(amend.description, /never send it/, 'amend states the caller must never send bases')
})
