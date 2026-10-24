// Bridge tests for the metatask participation-write tools (PR-2:
// metatask_claim / metatask_release / metatask_submit / metatask_verify).
// Fake-run only: argv spelling, --request-file body shape, local pre-write
// refusals, envelope rendering, refusal pass-through, and the
// description-discipline invariants. No daemon, no chain, no ports. Protocol
// truth (canon hashes, same-side roster, replay guard) lives in
// oac-src/tests/metatask/ and is NOT re-tested here.
//
// Recorded implementation decision (design §4): the plugin DOES reject a
// caller-supplied `result.hash` locally ("the writer computes the hash —
// resend without `hash`") — the writer would tolerate it, but catching the
// confused agent before a daemon round trip is the one cheap validation
// worth doing. The test below pins this behavior.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const plugin = await import('../lib/metatask-tools.js')

const TOOL_NAMES = ['metatask_claim', 'metatask_release', 'metatask_submit', 'metatask_verify']

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

/** Fake run: captures {args, options, payload, rawPayload} per call. */
function fakeRun(result) {
  const calls = []
  const run = async (args, options) => {
    // runMetabotWithPayloadFile deletes its temp payload on return, so the
    // payload (and its raw bytes, for key-order assertions) must be captured
    // synchronously here.
    const flagIndex = args.indexOf('--request-file')
    const payloadPath = flagIndex >= 0 ? args[flagIndex + 1] : null
    calls.push({
      args,
      options,
      payload: payloadPath ? JSON.parse(readFileSync(payloadPath, 'utf8')) : undefined,
      rawPayload: payloadPath ? readFileSync(payloadPath, 'utf8') : undefined,
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
const NODE = 'n2'
const CLAIM = `b${'3'.repeat(63)}i0`
const SUBMISSION = `a${'2'.repeat(63)}i0`

// ── registration ─────────────────────────────────────────────────────────────

test('bindMetataskToolInstall registers exactly the four write tools', () => {
  const host = slugHost()
  plugin.bindMetataskToolInstall(host.ctx)
  assert.deepEqual(host.tools.map((tool) => tool.name), TOOL_NAMES)
})

// ── actor plumbing ───────────────────────────────────────────────────────────

test('no OAC slug: every write tool refuses locally with zero run calls', async () => {
  const { calls, run } = fakeRun()
  const host = fakeHost() // no agentPresets at all
  const { definitions } = toolsWith(host, run)
  const byName = (name) => definitions.find((tool) => tool.name === name)
  const claimOut = await byName('metatask_claim').execute({ rootPinId: ROOT, node: NODE }, {})
  assert.match(claimOut, /metatask_claim failed: no OAC bot profile is bound/)
  await byName('metatask_release').execute({ rootPinId: ROOT, node: NODE, claimPinId: CLAIM }, {})
  await byName('metatask_submit').execute({ rootPinId: ROOT, node: NODE, result: { ok: 1 } }, {})
  await byName('metatask_verify').execute(
    { targetPinId: SUBMISSION, verdict: 'pass', method: 'replay', semanticCheck: 'statement match' },
    {},
  )
  assert.equal(calls.length, 0, 'a session without an OAC slug must never reach the CLI')
})

// ── argv spelling (identical to the CLI write-verb surface) ──────────────────

test('metatask_claim argv: --root/--node/--from with the write timeout', async () => {
  const { calls, run } = fakeRun({ ok: true, state: 'success', data: { claimPinId: CLAIM, intentOnly: true } })
  const { definitions } = toolsWith(slugHost(), run)
  const out = await definitions.find((tool) => tool.name === 'metatask_claim').execute(
    { rootPinId: ROOT, node: NODE },
    {},
  )
  assert.deepEqual(calls[0].args, ['metatask', 'claim', '--root', ROOT, '--node', NODE, '--from', 'beta'])
  assert.equal(calls[0].options.timeoutMs, 300_000)
  assert.match(out, /"claimPinId"/, 'writer data is echoed as JSON')
  assert.match(out, /"intentOnly": true/, 'competitive intentOnly rides in data')
})

test('metatask_release argv: --root/--node/--claim/--from', async () => {
  const { calls, run } = fakeRun({ ok: true, state: 'success', data: { releasePinId: CLAIM } })
  const { definitions } = toolsWith(slugHost(), run)
  const missingRoot = await definitions.find((tool) => tool.name === 'metatask_release').execute(
    { node: NODE, claimPinId: CLAIM },
    {},
  )
  assert.match(missingRoot, /metatask_release failed: rootPinId is required\./)
  assert.equal(calls.length, 0)
  await definitions.find((tool) => tool.name === 'metatask_release').execute(
    { rootPinId: ROOT, node: NODE, claimPinId: CLAIM },
    {},
  )
  assert.deepEqual(
    calls[0].args,
    ['metatask', 'release', '--root', ROOT, '--node', NODE, '--claim', CLAIM, '--from', 'beta'],
  )
  assert.equal(calls[0].options.timeoutMs, 300_000)
})

// ── metatask_submit request-file contract ────────────────────────────────────

test('metatask_submit: request-file payload has exactly the allowed keys', async () => {
  const { calls, run } = fakeRun({ ok: true, state: 'success', data: { submissionPinId: SUBMISSION } })
  const { definitions } = toolsWith(slugHost(), run)
  await definitions.find((tool) => tool.name === 'metatask_submit').execute(
    {
      rootPinId: ROOT,
      node: NODE,
      result: { ok: 1 },
      claimPinId: CLAIM,
      contentType: 'application/json;utf-8',
      attachment: 'metafile://x',
      childIds: [SUBMISSION],
      parentRefs: { n1: SUBMISSION },
      supersedePinId: SUBMISSION,
    },
    {},
  )
  const { args, payload, options } = calls[0]
  assert.deepEqual(args.slice(0, 5), ['metatask', 'submit', '--from', 'beta', '--request-file'])
  assert.equal(typeof args[5], 'string', 'request-file path rides after the flag')
  // Deep-equal against the daemon contract (metataskHandlers submit): catches
  // camelCase drift — body key is `root` (not rootPinId), optionals only when set.
  assert.deepEqual(payload, {
    root: ROOT,
    node: NODE,
    result: { ok: 1 },
    claimPinId: CLAIM,
    contentType: 'application/json;utf-8',
    attachment: 'metafile://x',
    childIds: [SUBMISSION],
    parentRefs: { n1: SUBMISSION },
    supersedePinId: SUBMISSION,
  })
  assert.equal(options.timeoutMs, 300_000)
})

test('metatask_submit: result object passes through byte-identical (key order preserved)', async () => {
  const { calls, run } = fakeRun()
  const { definitions } = toolsWith(slugHost(), run)
  const result = { z: 1, a: { y: 2, b: 3 }, m: 'x' }
  await definitions.find((tool) => tool.name === 'metatask_submit').execute(
    { rootPinId: ROOT, node: NODE, result },
    {},
  )
  const expected = { root: ROOT, node: NODE, result: { z: 1, a: { y: 2, b: 3 }, m: 'x' } }
  assert.equal(calls[0].rawPayload, JSON.stringify(expected), 'raw payload bytes preserve insertion order')
})

test('metatask_submit: caller-supplied result.hash is rejected locally, zero run calls', async () => {
  const { calls, run } = fakeRun()
  const { definitions } = toolsWith(slugHost(), run)
  const out = await definitions.find((tool) => tool.name === 'metatask_submit').execute(
    { rootPinId: ROOT, node: NODE, result: { ok: 1, hash: 'deadbeef' } },
    {},
  )
  assert.match(out, /metatask_submit failed: the writer computes the hash — resend without `hash`\./)
  assert.equal(calls.length, 0)
})

test('metatask_submit: malformed optionals are rejected locally', async () => {
  const { calls, run } = fakeRun()
  const { definitions } = toolsWith(slugHost(), run)
  const submit = definitions.find((tool) => tool.name === 'metatask_submit')
  const badChildIds = await submit.execute({ rootPinId: ROOT, node: NODE, result: { ok: 1 }, childIds: 'n1' }, {})
  assert.match(badChildIds, /metatask_submit failed: childIds must be an array/)
  const badParentRefs = await submit.execute({ rootPinId: ROOT, node: NODE, result: { ok: 1 }, parentRefs: ['n1'] }, {})
  assert.match(badParentRefs, /metatask_submit failed: parentRefs must be an object/)
  const badResult = await submit.execute({ rootPinId: ROOT, node: NODE, result: 'ok' }, {})
  assert.match(badResult, /metatask_submit failed: result must be an object/)
  assert.equal(calls.length, 0)
})

// ── metatask_verify local gates + payload ────────────────────────────────────

test('metatask_verify: wrong-case verdict is rejected locally, zero run calls', async () => {
  const { calls, run } = fakeRun()
  const { definitions } = toolsWith(slugHost(), run)
  const out = await definitions.find((tool) => tool.name === 'metatask_verify').execute(
    { targetPinId: SUBMISSION, verdict: 'PASS', method: 'replay', semanticCheck: 'statement match' },
    {},
  )
  assert.match(out, /metatask_verify failed: verdict must be exactly "pass" or "fail"/)
  assert.match(out, /"PASS"/, 'the rejected value is echoed back')
  assert.match(out, /spent as a pass vote/, 'the daemon normalization foot-gun is explained')
  assert.equal(calls.length, 0)
})

test('metatask_verify: fail verdict without failReason is rejected locally', async () => {
  const { calls, run } = fakeRun()
  const { definitions } = toolsWith(slugHost(), run)
  const out = await definitions.find((tool) => tool.name === 'metatask_verify').execute(
    { targetPinId: SUBMISSION, verdict: 'fail', method: 'replay', semanticCheck: 'statement match' },
    {},
  )
  assert.match(out, /metatask_verify failed: verdict=fail requires failReason/)
  assert.equal(calls.length, 0)
})

test('metatask_verify: empty method / semanticCheck are rejected locally', async () => {
  const { calls, run } = fakeRun()
  const { definitions } = toolsWith(slugHost(), run)
  const verify = definitions.find((tool) => tool.name === 'metatask_verify')
  const noMethod = await verify.execute(
    { targetPinId: SUBMISSION, verdict: 'pass', method: '  ', semanticCheck: 'statement match' },
    {},
  )
  assert.match(noMethod, /metatask_verify failed: method is empty/)
  const noSemantic = await verify.execute(
    { targetPinId: SUBMISSION, verdict: 'pass', method: 'replay', semanticCheck: '' },
    {},
  )
  assert.match(noSemantic, /metatask_verify failed: semantic_check is empty/)
  assert.equal(calls.length, 0)
})

test('metatask_verify: happy-path payload keys exact (pass with evidence, fail with failReason)', async () => {
  const { calls, run } = fakeRun({ ok: true, state: 'success', data: { votePinId: `c${'4'.repeat(63)}i0` } })
  const { definitions } = toolsWith(slugHost(), run)
  const verify = definitions.find((tool) => tool.name === 'metatask_verify')
  await verify.execute(
    { targetPinId: SUBMISSION, verdict: 'pass', method: 'spec rerun pass; hashes match', semanticCheck: 'statement match', evidence: 'logs' },
    {},
  )
  assert.deepEqual(calls[0].args.slice(0, 5), ['metatask', 'verify', '--from', 'beta', '--request-file'])
  assert.deepEqual(calls[0].payload, {
    targetPinId: SUBMISSION,
    verdict: 'pass',
    method: 'spec rerun pass; hashes match',
    semanticCheck: 'statement match',
    evidence: 'logs',
  })
  assert.equal(calls[0].options.timeoutMs, 300_000)
  await verify.execute(
    { targetPinId: SUBMISSION, verdict: 'fail', method: 'spec rerun mismatch', semanticCheck: 'statement match', failReason: 'inner hash differs' },
    {},
  )
  assert.deepEqual(calls[1].payload, {
    targetPinId: SUBMISSION,
    verdict: 'fail',
    method: 'spec rerun mismatch',
    semanticCheck: 'statement match',
    failReason: 'inner hash differs',
  })
})

// ── refusal pass-through (verbatim, unmangled) ───────────────────────────────

test('same_side_roster refusal renders verbatim through the failure envelope', async () => {
  const refusal = 'Refused: same_side_roster — the submitter or publisher is on the local roster, so a local bot\'s vote is not independent. Review a different node.'
  const { run } = fakeRun({ ok: false, state: 'failed', code: 'metatask_refused', message: refusal })
  const { definitions } = toolsWith(slugHost(), run)
  const out = await definitions.find((tool) => tool.name === 'metatask_verify').execute(
    { targetPinId: SUBMISSION, verdict: 'pass', method: 'replay', semanticCheck: 'statement match' },
    {},
  )
  assert.equal(out, `metatask_verify failed: [metatask_refused] ${refusal}`)
})

test('claim-rejected:<node>:<state> rides the message through unmangled', async () => {
  const { run } = fakeRun({ ok: false, state: 'failed', code: 'metatask_refused', message: 'claim-rejected:n3:claimed' })
  const { definitions } = toolsWith(slugHost(), run)
  const out = await definitions.find((tool) => tool.name === 'metatask_claim').execute(
    { rootPinId: ROOT, node: 'n3' },
    {},
  )
  assert.equal(out, 'metatask_claim failed: [metatask_refused] claim-rejected:n3:claimed')
})

test('a thrown CLI-bridge error surfaces as the same string envelope with the daemon hint', async () => {
  const run = async () => {
    throw new Error('metabot timed out after 300000ms')
  }
  const { definitions } = toolsWith(slugHost(), run)
  const out = await definitions.find((tool) => tool.name === 'metatask_submit').execute(
    { rootPinId: ROOT, node: NODE, result: { ok: 1 } },
    {},
  )
  assert.match(out, /metatask_submit failed: metabot timed out after 300000ms/)
  assert.match(out, /OAC daemon running — start it and retry/)
})

// ── description discipline (wayfinding: publisher verbs land later) ──────────

test('no write-tool description mentions the later publisher tools; daemon requirement stated', () => {
  const host = slugHost()
  plugin.bindMetataskToolInstall(host.ctx)
  for (const tool of host.tools) {
    assert.doesNotMatch(
      tool.description,
      /metatask_publish|publish-spec|metatask_amend/,
      `${tool.name} description must not point at publisher verbs (they land in a later PR)`,
    )
    assert.match(tool.description, /daemon/, `${tool.name} description must state the daemon requirement`)
  }
})

// ── same-side rule description carries the discipline (design §5) ────────────

test('metatask_verify description carries the same-side rule', () => {
  const host = slugHost()
  plugin.bindMetataskToolInstall(host.ctx)
  const verify = host.tools.find((tool) => tool.name === 'metatask_verify')
  assert.match(verify.description, /Same-side rule: you must NOT review a submission whose submitter or the task publisher is on the local roster/)
})
