/**
 * Cerebellum memory write gate wiring tests — Round 3 PR-2 (design doc
 * design-assistant-cerebellum-port.md §2.2 B4 / §3 PR-2 test strategy).
 *
 * fakeRun capture proves the call-count contracts:
 *   - gate verdict `false` → ZERO `memory extract` calls (transcript
 *     mirrors still run);
 *   - verdict `null` / `true` / thrown → the extract call proceeds;
 *   - cerebellum disabled (the shipped default) → ZERO JEV fetches, ZERO
 *     extra CLI reads, and the CLI call sequence is byte-identical to the
 *     ungated main (transcript, transcript, extract);
 *   - explicitOnly variant swaps the memory-worthy definition (the policy
 *     read drives it; a failed policy read falls back to the implicit
 *     definition — the fail-open direction).
 *
 * All fetches are injected fakes — no network.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const plugin = await import('../lib/index.js')
const writeGateModule = await import('../lib/cerebellum-write-gate.js')
const { bindCerebellumCore } = await import('../lib/cerebellum/client.js')
const gateQuestions = await import('../lib/cerebellum/questions/memoryWriteGate.js')

/** The plugin-config cerebellum SECTION — bindCerebellumCore takes the
 *  section itself (index.ts passes `config.cerebellum`), not the envelope. */
const ENABLED_SECTION = {
  enabled: true,
  provider: 'typesafe-jev',
  apiKey: 'sk-test',
  baseUrl: 'https://jev.example',
  model: 'jev-test-model',
}

/** JEV answer envelope for the write-gate question. */
const gateAnswer = (noul) => ({
  ok: true,
  status: 200,
  json: async () => ({ answers: { worth_remembering: { noul } } }),
})

function fakeCtx(preset) {
  const listeners = []
  return {
    listeners,
    ctx: {
      on: (event, listener, options) => listeners.push({ event, listener, options }),
      agentPresets: { composedPreset: () => preset },
    },
  }
}

const USER_MESSAGE = {
  role: 'user',
  content: [{ type: 'text', text: '帮我记住我喜欢喝美式咖啡' }],
  source: { kind: 'user' },
}
const ASSISTANT_TEXT = '好的，记下了'

/**
 * Drives one completed turn through the session/event listener. options:
 *   fetchImpl   — injected JEV fetch; its return is recorded in jevCalls.
 *   policyImplicit — what `memory policy get` reports (default true).
 *   policyFails — the policy CLI call answers with a failure envelope.
 * Returns the captured CLI calls after the per-session queue settles.
 */
async function runTurn(ctx, listeners, options = {}) {
  const calls = []
  plugin.applyMemoryExtraction(ctx, {
    cerebellumRuntime: options.cerebellumRuntime,
    log: options.log,
    run: async (args) => {
      const fileFlag = args.indexOf('--payload-file')
      const file = fileFlag >= 0 ? JSON.parse(await readFile(args[fileFlag + 1], 'utf8')) : null
      calls.push({ args, file })
      if (args[1] === 'policy') {
        if (options.policyFails) {
          return { ok: false, state: 'error', error: { message: 'policy store unavailable' } }
        }
        return {
          ok: true,
          state: 'success',
          data: { effective: { memoryImplicitUpdateEnabled: options.policyImplicit ?? true } },
        }
      }
      return { ok: true, state: 'success', data: {} }
    },
  })
  const listener = listeners.find((entry) => entry.event === 'session/event').listener
  const session = { id: 'sess-gate-1', header: { agentPreset: 'oac-alice' } }
  listener(session, { type: 'agent-preset/selected', data: { agentPreset: 'oac-alice' } })
  listener(session, { type: 'turn/start', data: { turn: 1 } })
  listener(session, { type: 'user/message', data: USER_MESSAGE })
  listener(session, { type: 'assistant/message', data: { turn: 1, step: 0, message: { content: [{ type: 'text', text: ASSISTANT_TEXT }] } } })
  listener(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  // The per-session queue drains asynchronously: settle when the extract
  // lands (proceed paths) or when the call list has been stable at the
  // pre-extract plateau (2 mirrors + policy read) for 300 ms (skip paths —
  // the injected JEV fake resolves in microtasks, so stability ⇒ decided).
  const waitFor = async (timeoutMs = 4000) => {
    const deadline = Date.now() + timeoutMs
    let lastCount = -1
    let lastChange = Date.now()
    while (Date.now() < deadline) {
      if (calls.some((call) => call.args[1] === 'extract')) return
      const now = Date.now()
      if (calls.length !== lastCount) {
        lastCount = calls.length
        lastChange = now
      } else if (calls.length >= 3 && now - lastChange >= 300) {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  await waitFor()
  return calls
}

/** Wraps an injected JEV fetch so the harness knows when the gate decided. */
function gateRuntime(fetchImpl, onCall) {
  return bindCerebellumCore(ENABLED_SECTION, {
    fetchImpl: async (url, init) => {
      const result = await fetchImpl(url, init)
      onCall?.({ url, body: JSON.parse(init.body) })
      return result
    },
  })
}

test('write gate: verdict false skips the extract call; transcripts still mirror', async () => {
  const jevCalls = []
  const logs = []
  const { ctx, listeners } = fakeCtx('oac-alice')
  const calls = await runTurn(ctx, listeners, {
    cerebellumRuntime: gateRuntime(() => gateAnswer(0.1), (call) => jevCalls.push(call)),
    log: (message) => logs.push(message),
  })
  const transcripts = calls.filter((call) => call.args[1] === 'transcript')
  const extracts = calls.filter((call) => call.args[1] === 'extract')
  assert.equal(transcripts.length, 2, 'both transcript mirrors still run')
  assert.equal(extracts.length, 0, 'a positive skip verdict suppresses the extract call')
  assert.equal(jevCalls.length, 1, 'exactly one JEV gate call')
  assert.ok(jevCalls[0].url.endsWith('/v1/systemone'))
  // Request shape (byte-synced builder): implicit definition (policy default
  // true), worth_remembering question, model, collapsed state.
  const body = jevCalls[0].body
  assert.equal(body.model, 'jev-test-model')
  assert.ok(Object.hasOwn(body.questions, 'worth_remembering'))
  assert.equal(body.questions.worth_remembering.type, 'noul')
  assert.equal(
    body.questions.worth_remembering.criteria.true,
    gateQuestions.CEREBELLUM_MEMORY_WRITE_GATE_CRITERIA_IMPLICIT.true,
    'policy implicit=true → implicit memory-worthy definition',
  )
  assert.ok(!body.questions.worth_remembering.instructions.includes('explicit-only mode'))
  assert.equal(body.state.user_message, '帮我记住我喜欢喝美式咖啡')
  assert.equal(body.state.assistant_message, ASSISTANT_TEXT)
  // ids/verdict/latency logging only — no turn text in the log line.
  assert.ok(logs.some((line) => line.includes('verdict=skip')))
  assert.ok(logs.every((line) => !line.includes('咖啡')))
})

test('write gate: verdict null (JEV 500) proceeds', async () => {
  const { ctx, listeners } = fakeCtx('oac-alice')
  const calls = await runTurn(ctx, listeners, {
    cerebellumRuntime: gateRuntime(() => ({ ok: false, status: 500, json: async () => ({}) })),
  })
  const extracts = calls.filter((call) => call.args[1] === 'extract')
  assert.equal(extracts.length, 1, 'a no-verdict gate proceeds to extract')
  assert.equal(extracts[0].file.userText, '帮我记住我喜欢喝美式咖啡')
  assert.equal(extracts[0].file.channel, 'dsh')
})

test('write gate: verdict true (noul 0.9) proceeds', async () => {
  const { ctx, listeners } = fakeCtx('oac-alice')
  const calls = await runTurn(ctx, listeners, {
    cerebellumRuntime: gateRuntime(() => gateAnswer(0.9)),
  })
  assert.equal(calls.filter((call) => call.args[1] === 'extract').length, 1)
})

test('write gate: malformed JEV payload → null verdict → extract proceeds', async () => {
  const { ctx, listeners } = fakeCtx('oac-alice')
  const calls = await runTurn(ctx, listeners, {
    cerebellumRuntime: gateRuntime(() => ({ ok: true, status: 200, json: async () => ({ answers: {} }) })),
  })
  assert.equal(calls.filter((call) => call.args[1] === 'extract').length, 1)
})

test('write gate: network error (rejected fetch) → null verdict → extract proceeds', async () => {
  const { ctx, listeners } = fakeCtx('oac-alice')
  const calls = await runTurn(ctx, listeners, {
    cerebellumRuntime: gateRuntime(() => {
      throw new Error('ECONNRESET')
    }),
  })
  assert.equal(calls.filter((call) => call.args[1] === 'extract').length, 1)
})

test('write gate: explicitOnly variant swaps the memory-worthy definition', async () => {
  const jevBodies = []
  const { ctx, listeners } = fakeCtx('oac-alice')
  const calls = await runTurn(ctx, listeners, {
    cerebellumRuntime: gateRuntime((_url, init) => {
      void init
      return gateAnswer(0.9)
    }, (call) => jevBodies.push(call.body)),
    policyImplicit: false,
  })
  assert.equal(calls.filter((call) => call.args[1] === 'extract').length, 1)
  assert.equal(jevBodies.length, 1)
  const question = jevBodies[0].questions.worth_remembering
  assert.ok(
    question.instructions.includes('In this explicit-only mode ONLY an explicit remember/forget instruction from the user counts'),
    'the explicit-only clause replaces the memory-worthy definition',
  )
  assert.equal(question.criteria.true, gateQuestions.CEREBELLUM_MEMORY_WRITE_GATE_CRITERIA_EXPLICIT_ONLY.true)
  assert.equal(question.criteria.false, gateQuestions.CEREBELLUM_MEMORY_WRITE_GATE_CRITERIA_EXPLICIT_ONLY.false)
})

test('write gate: policy read failure falls back to the implicit definition (fail-open)', async () => {
  const jevBodies = []
  const { ctx, listeners } = fakeCtx('oac-alice')
  const calls = await runTurn(ctx, listeners, {
    cerebellumRuntime: gateRuntime(() => gateAnswer(0.9), (call) => jevBodies.push(call.body)),
    policyFails: true,
  })
  assert.equal(calls.filter((call) => call.args[1] === 'extract').length, 1, 'a failed policy read never blocks the extract')
  assert.equal(jevBodies.length, 1)
  assert.equal(
    jevBodies[0].questions.worth_remembering.criteria.true,
    gateQuestions.CEREBELLUM_MEMORY_WRITE_GATE_CRITERIA_IMPLICIT.true,
    'failed policy read → implicit (more permissive) definition',
  )
})

test('write gate: disabled config (shipped default) → zero JEV calls, CLI sequence byte-identical to main', async () => {
  const jevCalls = []
  const runtime = bindCerebellumCore(
    { enabled: false, provider: 'typesafe-jev', apiKey: 'sk-test' },
    {
      fetchImpl: async (url, init) => {
        jevCalls.push({ url, init })
        return gateAnswer(0.9)
      },
    },
  )
  const { ctx, listeners } = fakeCtx('oac-alice')
  const calls = await runTurn(ctx, listeners, { cerebellumRuntime: runtime })
  assert.equal(jevCalls.length, 0, 'no JEV fetch when the cerebellum is disabled')
  assert.deepEqual(
    calls.map((call) => `${call.args[0]} ${call.args[1]}`),
    ['memory transcript', 'memory transcript', 'memory extract'],
    'CLI call sequence identical to the ungated main',
  )
  assert.equal(calls[2].file.userText, '帮我记住我喜欢喝美式咖啡')
})

test('write gate: no runtime option → ungated byte-identical path, gate never consulted', async () => {
  const { ctx, listeners } = fakeCtx('oac-alice')
  const calls = await runTurn(ctx, listeners, {})
  assert.deepEqual(
    calls.map((call) => `${call.args[0]} ${call.args[1]}`),
    ['memory transcript', 'memory transcript', 'memory extract'],
  )
  assert.equal(calls[2].file.userText, '帮我记住我喜欢喝美式咖啡')
  assert.equal(calls[2].file.assistantText, ASSISTANT_TEXT)
  assert.equal(calls[2].file.sessionId, 'sess-gate-1')
})

test('write gate: runtime failure (resolveCallContext throws) → extract proceeds', async () => {
  const { ctx, listeners } = fakeCtx('oac-alice')
  const calls = await runTurn(ctx, listeners, {
    cerebellumRuntime: {
      client: {},
      resolveCallContext: async () => {
        throw new Error('runtime exploded')
      },
    },
  })
  assert.equal(calls.filter((call) => call.args[1] === 'extract').length, 1, 'a throwing runtime must never lose the extract')
})

test('write gate: long turn text is collapsed and capped at 1200/400 in the JEV state', async () => {
  const longUser = `${'词 '.repeat(1500)}\n尾词`
  const longAssistant = `${'答 '.repeat(600)}\n尾答`
  const bodies = []
  const { ctx, listeners } = fakeCtx('oac-alice')
  const calls = []
  plugin.applyMemoryExtraction(ctx, {
    cerebellumRuntime: gateRuntime((_url, init) => {
      bodies.push(JSON.parse(init.body))
      return gateAnswer(0.9)
    }),
    run: async (args) => {
      const fileFlag = args.indexOf('--payload-file')
      const file = fileFlag >= 0 ? JSON.parse(await readFile(args[fileFlag + 1], 'utf8')) : null
      calls.push({ args, file })
      if (args[1] === 'policy') {
        return { ok: true, state: 'success', data: { effective: { memoryImplicitUpdateEnabled: true } } }
      }
      return { ok: true, state: 'success', data: {} }
    },
  })
  const listener = listeners.find((entry) => entry.event === 'session/event').listener
  const session = { id: 'sess-caps', header: { agentPreset: 'oac-alice' } }
  listener(session, { type: 'turn/start', data: { turn: 1 } })
  listener(session, { type: 'user/message', data: { ...USER_MESSAGE, content: [{ type: 'text', text: longUser }] } })
  listener(session, { type: 'assistant/message', data: { turn: 1, step: 0, message: { content: [{ type: 'text', text: longAssistant }] } } })
  listener(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  const deadline = Date.now() + 4000
  while (Date.now() < deadline && calls.filter((call) => call.args[1] === 'extract').length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(bodies.length, 1)
  assert.equal(bodies[0].state.user_message.length, 1200)
  assert.ok(!bodies[0].state.user_message.includes('\n'), 'whitespace collapsed')
  assert.equal(bodies[0].state.assistant_message.length, 400)
  assert.ok(!bodies[0].state.assistant_message.includes('\n'), 'whitespace collapsed')
})

test('write gate helper: blank user text → null verdict (proceed) without a JEV call', async () => {
  const jevCalls = []
  const runtime = gateRuntime(() => gateAnswer(0.1), (call) => jevCalls.push(call))
  const proceed = await writeGateModule.gateTurnMemoryExtract({
    runtime,
    userText: '   ',
    assistantText: 'some reply',
    readImplicitEnabled: null,
  })
  assert.equal(proceed, true, 'blank user text → null verdict → proceed')
  assert.equal(jevCalls.length, 0, 'the executor short-circuits blank user text before any fetch')
})
