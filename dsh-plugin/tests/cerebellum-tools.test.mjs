/**
 * Cerebellum tools contract tests — Round 3 PR-3 (intuition tool + pre-step
 * shortlists + spawned-agent effort), OAC dsh-plugin.
 *
 * Ported/derived from IDBots @ d75bea8ac2249da4886bfa0f6f1db838d234ef1f:
 * intuitionTool registration (coworkRunner.ts :12622-12720) + effort chain
 * (:10010-10110) as rewired for the OAC plugin (src/cerebellum-tools.ts).
 *
 * All fetches are injected fakes — no network. Covers the acceptance matrix:
 * intuition input caps + normalization, the per-session 3/60 s rolling
 * window, honest no-verdict on every failure mode, the sync mount probe
 * (unconfigured → tool ABSENT), the pre-step shortlist message format vs
 * the IDBots block shapes and its zero-delta path when the cerebellum is
 * off, and the spawned-effort mapping (explicit pick wins, auto → max,
 * null → existing default untouched, two-level policy + 10-min sticky)
 * including the schedule-scheduler and group-task-worker agents.create
 * call sites.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

const tools = await import('../lib/cerebellum-tools.js')
const {
  buildIntuitionToolDefinition,
  bindCerebellumToolInstall,
  applyCerebellumShortlists,
  createSpawnedEffortResolver,
} = tools

const intuition = await import('../lib/cerebellum/questions/intuitionTool.js')
const {
  validateIntuitionInput,
  buildIntuitionRequest,
  parseIntuitionAnswers,
  askCerebellumIntuition,
  CEREBELLUM_INTUITION_MAX_CONTEXT_CHARS,
  CEREBELLUM_INTUITION_MAX_QUESTIONS,
  CEREBELLUM_INTUITION_MAX_INSTRUCTION_CHARS,
  CEREBELLUM_INTUITION_MAX_OPTIONS,
  CEREBELLUM_INTUITION_MAX_OPTION_CHARS,
  CEREBELLUM_INTUITION_MIN_LEVELS,
  CEREBELLUM_INTUITION_MAX_LEVELS,
  CEREBELLUM_INTUITION_MAX_LEVEL_CHARS,
} = intuition

const clientModule = await import('../lib/cerebellum/client.js')
const { bindCerebellumCore } = clientModule

const skillShortlist = await import('../lib/cerebellum/questions/skillShortlist.js')
const serviceShortlist = await import('../lib/cerebellum/questions/remoteServiceShortlist.js')

const plugin = await import('../lib/index.js')

const CONFIG = {
  provider: 'typesafe-jev',
  apiKey: 'sk-test',
  baseUrl: 'https://jev.example',
  model: 'jev-test-model',
}

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

const hangingUntilAbort = (url, init) => new Promise((_, reject) => {
  init.signal.addEventListener(
    'abort',
    () => reject(new DOMException('The operation was aborted', 'AbortError')),
    { once: true },
  )
})

const SECTION = (overrides = {}) => ({
  enabled: true,
  provider: 'typesafe-jev',
  apiKey: 'sk-test',
  ...overrides,
})

const makeRuntime = (fetchImpl, section = SECTION()) =>
  bindCerebellumCore(section, { fetchImpl })

// ---------------------------------------------------------------------------
// Intuition pure module: input caps + normalization (IDBots parity)
// ---------------------------------------------------------------------------

test('intuition validation: context required and hard-capped at 6000 chars', () => {
  assert.match(validateIntuitionInput({ context: '', questions: [] }).error ?? '', /context.*required/)
  assert.match(validateIntuitionInput({ context: '   ', questions: [] }).error ?? '', /context.*required/)
  const tooLong = 'x'.repeat(CEREBELLUM_INTUITION_MAX_CONTEXT_CHARS + 1)
  const result = validateIntuitionInput({ context: tooLong, questions: [{ type: 'noul', question: 'q?' }] })
  assert.equal(result.questions, null)
  assert.match(result.error ?? '', new RegExp(`exceeds ${CEREBELLUM_INTUITION_MAX_CONTEXT_CHARS} chars`))
  const atCap = validateIntuitionInput({
    context: 'x'.repeat(CEREBELLUM_INTUITION_MAX_CONTEXT_CHARS),
    questions: [{ type: 'noul', question: 'q?' }],
  })
  assert.ok(atCap.questions)
})

test('intuition validation: question count, types, instruction caps', () => {
  const good = { type: 'noul', question: 'Is this consistent?' }
  assert.match(validateIntuitionInput({ context: 'ctx', questions: 'nope' }).error ?? '', /non-empty array/)
  assert.match(validateIntuitionInput({ context: 'ctx', questions: [] }).error ?? '', /non-empty array/)
  const tooMany = Array.from({ length: CEREBELLUM_INTUITION_MAX_QUESTIONS + 1 }, () => good)
  const many = validateIntuitionInput({ context: 'ctx', questions: tooMany })
  assert.equal(many.questions, null)
  assert.match(many.error ?? '', new RegExp(`at most ${CEREBELLUM_INTUITION_MAX_QUESTIONS} questions`))

  assert.match(
    validateIntuitionInput({ context: 'ctx', questions: [{ type: 'wild', question: 'q?' }] }).error ?? '',
    /must be "noul", "choice", or "score"/,
  )
  assert.match(
    validateIntuitionInput({ context: 'ctx', questions: [{ type: 'noul' }] }).error ?? '',
    /question is required/,
  )
  const longQuestion = validateIntuitionInput({
    context: 'ctx',
    questions: [{ type: 'noul', question: 'y'.repeat(CEREBELLUM_INTUITION_MAX_INSTRUCTION_CHARS + 1) }],
  })
  assert.equal(longQuestion.questions, null)
  assert.match(longQuestion.error ?? '', new RegExp(`exceeds ${CEREBELLUM_INTUITION_MAX_INSTRUCTION_CHARS} chars`))
})

test('intuition validation: ids default, sanitize, and collide', () => {
  const withDefaults = validateIntuitionInput({
    context: 'ctx',
    questions: [
      { type: 'noul', question: 'a?' },
      { type: 'noul', question: 'b?' },
    ],
  })
  assert.deepEqual(withDefaults.questions?.map((q) => q.id), ['q1', 'q2'])

  const invalid = validateIntuitionInput({
    context: 'ctx',
    questions: [{ id: 'not a valid id!', type: 'noul', question: 'a?' }],
  })
  assert.equal(invalid.questions?.[0].id, 'q1')

  const dup = validateIntuitionInput({
    context: 'ctx',
    questions: [
      { id: 'same', type: 'noul', question: 'a?' },
      { id: 'same', type: 'noul', question: 'b?' },
    ],
  })
  assert.equal(dup.questions, null)
  assert.match(dup.error ?? '', /duplicate question id/)
})

test('intuition validation: choice option bounds and slug keys', () => {
  const base = { context: 'ctx', questions: [{ type: 'choice', question: 'pick', options: { a: 'A', b: 'B' } }] }
  assert.ok(validateIntuitionInput(base).questions)
  assert.match(
    validateIntuitionInput({ context: 'ctx', questions: [{ type: 'choice', question: 'pick', options: { a: 'only' } }] }).error ?? '',
    /at least 2 options/,
  )
  const tooManyOptions = {}
  for (let i = 0; i < CEREBELLUM_INTUITION_MAX_OPTIONS + 1; i += 1) tooManyOptions[`o${i}`] = 'opt'
  assert.match(
    validateIntuitionInput({ context: 'ctx', questions: [{ type: 'choice', question: 'pick', options: tooManyOptions }] }).error ?? '',
    new RegExp(`exceeds ${CEREBELLUM_INTUITION_MAX_OPTIONS} options`),
  )
  assert.match(
    validateIntuitionInput({ context: 'ctx', questions: [{ type: 'choice', question: 'pick', options: { 'not a slug': 'x', b: 'y' } }] }).error ?? '',
    /short alphanumeric slugs/,
  )
  assert.match(
    validateIntuitionInput({ context: 'ctx', questions: [{ type: 'choice', question: 'pick', options: { a: '', b: 'y' } }] }).error ?? '',
    /one-line description/,
  )
  assert.match(
    validateIntuitionInput({ context: 'ctx', questions: [{ type: 'choice', question: 'pick', options: { a: 'x'.repeat(CEREBELLUM_INTUITION_MAX_OPTION_CHARS + 1), b: 'y' } }] }).error ?? '',
    new RegExp(`exceeds ${CEREBELLUM_INTUITION_MAX_OPTION_CHARS} chars`),
  )
})

test('intuition validation: score level bounds (2-10) and per-level caps', () => {
  const base = { context: 'ctx', questions: [{ type: 'score', question: 'rate', levels: ['low', 'high'] }] }
  assert.ok(validateIntuitionInput(base).questions)
  for (const levels of [[], ['only-one']]) {
    const result = validateIntuitionInput({
      context: 'ctx',
      questions: [{ type: 'score', question: 'rate', levels }],
    })
    assert.equal(result.questions, null)
    assert.match(result.error ?? '', new RegExp(`requires "levels" — ${CEREBELLUM_INTUITION_MIN_LEVELS}`))
  }
  const tooManyLevels = Array.from({ length: CEREBELLUM_INTUITION_MAX_LEVELS + 1 }, (_, i) => `level ${i}`)
  assert.match(
    validateIntuitionInput({ context: 'ctx', questions: [{ type: 'score', question: 'rate', levels: tooManyLevels }] }).error ?? '',
    new RegExp(`exceeds ${CEREBELLUM_INTUITION_MAX_LEVELS}`),
  )
  assert.match(
    validateIntuitionInput({ context: 'ctx', questions: [{ type: 'score', question: 'rate', levels: ['ok', 'x'.repeat(CEREBELLUM_INTUITION_MAX_LEVEL_CHARS + 1)] }] }).error ?? '',
    new RegExp(`exceeds ${CEREBELLUM_INTUITION_MAX_LEVEL_CHARS} chars`),
  )
})

test('intuition request shape: shared state + noul/choice/score criteria', () => {
  const request = buildIntuitionRequest({
    context: '  the   judged   text  ',
    model: 'jev-test-model',
    questions: [
      { id: 'q1', type: 'noul', instructions: 'Is it yes?' },
      { id: 'pick', type: 'choice', instructions: 'Pick one.', options: { a: 'A option', b: 'B option' } },
      { id: 'q3', type: 'score', instructions: 'Rate it.', levels: ['low end', 'high end'] },
    ],
  })
  assert.equal(request.state, 'the judged text')
  assert.equal(request.model, 'jev-test-model')
  assert.deepEqual(request.questions.q1, {
    type: 'noul',
    instructions: 'Is it yes?',
    criteria: { true: 'The answer to the question is yes.', false: 'The answer to the question is no.' },
  })
  assert.deepEqual(request.questions.pick, {
    type: 'choice',
    instructions: 'Pick one.',
    criteria: { a: 'A option', b: 'B option' },
  })
  assert.deepEqual(request.questions.q3, { type: 'score', instructions: 'Rate it.', criteria: ['low end', 'high end'] })
})

test('intuition answer parsing: clamps, passthroughs, skips, and null shapes', () => {
  const parsed = parseIntuitionAnswers(
    {
      answers: {
        q1: { noul: 1.7, confidence: 2 },
        q2: { choice: 'b', probabilities: { a: 0.25, b: 0.75, junk: 'x' } },
        q3: { score: 2 },
        other: 'not-an-object',
      },
    },
    ['q1', 'q2', 'q3', 'missing'],
  )
  assert.equal(parsed.q1.noul, 1)
  assert.equal(parsed.q1.confidence, 1)
  assert.equal(parsed.q2.choice, 'b')
  assert.deepEqual(parsed.q2.probabilities, { a: 0.25, b: 0.75 })
  assert.equal(parsed.q3.score, 2)
  assert.equal('missing' in parsed, false)
  assert.equal('other' in parsed, false)

  assert.equal(parseIntuitionAnswers(null, ['q1']), null)
  assert.equal(parseIntuitionAnswers({}, ['q1']), null)
  assert.equal(parseIntuitionAnswers({ answers: { q1: 'nope' } }, ['q1']), null)
})

// ---------------------------------------------------------------------------
// askCerebellumIntuition: every failure mode → null (honest no-verdict)
// ---------------------------------------------------------------------------

const INTUITION_QUESTIONS = [{ id: 'q1', type: 'noul', instructions: 'Is it yes?' }]

test('intuition ask: success returns answers + usage', async () => {
  const result = await askCerebellumIntuition({
    config: CONFIG,
    fetchImpl: async () => jsonResponse(200, { answers: { q1: { noul: 0.8 } }, usage: { input_tokens: 42 } }),
    context: 'the text',
    questions: INTUITION_QUESTIONS,
  })
  assert.equal(result?.answers.q1.noul, 0.8)
  assert.equal(result?.inputTokens, 42)
})

test('intuition ask: HTTP error / throw / timeout / malformed / blank → null', async () => {
  const inputs = { config: CONFIG, context: 'the text', questions: INTUITION_QUESTIONS }
  assert.equal(await askCerebellumIntuition({ ...inputs, fetchImpl: async () => jsonResponse(500, {}) }), null)
  assert.equal(await askCerebellumIntuition({ ...inputs, fetchImpl: async () => { throw new Error('down') } }), null)
  assert.equal(await askCerebellumIntuition({ ...inputs, fetchImpl: hangingUntilAbort, timeoutMs: 25 }), null)
  assert.equal(await askCerebellumIntuition({ ...inputs, fetchImpl: async () => jsonResponse(200, { nope: true }) }), null)
  assert.equal(await askCerebellumIntuition({ ...inputs, fetchImpl: async () => jsonResponse(200, { answers: {} }), questions: [] }), null)
  assert.equal(await askCerebellumIntuition({ ...inputs, fetchImpl: async () => jsonResponse(200, {}), context: '   ' }), null)
})

// ---------------------------------------------------------------------------
// Tool binding: mount probe + rolling window + no-verdict
// ---------------------------------------------------------------------------

function fakeCtx() {
  const registered = []
  return {
    registered,
    logger: { info: () => {}, warn: () => {} },
    tools: { register: (def) => { registered.push(def) } },
  }
}

test('mount probe: unconfigured/disabled runtime registers NO tool', () => {
  for (const section of [undefined, { enabled: false, provider: 'typesafe-jev', apiKey: 'k' }, { enabled: true }]) {
    const ctx = fakeCtx()
    const runtime = bindCerebellumCore(section, { fetchImpl: async () => jsonResponse(500, {}) })
    bindCerebellumToolInstall(ctx, { runtime })
    assert.equal(ctx.registered.length, 0, `tool ABSENT for section ${JSON.stringify(section)}`)
  }
})

test('mount probe: configured runtime registers exactly the intuition tool', () => {
  const ctx = fakeCtx()
  const runtime = makeRuntime(async () => jsonResponse(500, {}))
  bindCerebellumToolInstall(ctx, { runtime })
  assert.equal(ctx.registered.length, 1)
  const [definition] = ctx.registered
  assert.equal(definition.name, 'intuition')
  // Teaching text is load-bearing: WHEN/WHEN-NOT sections must survive.
  assert.match(definition.description, /WHEN to use:/)
  assert.match(definition.description, /WHEN NOT to use:/)
  assert.match(definition.description, /calibrated across groups, NOT per-case guarantees/)
  assert.equal(definition.parameters.properties.questions.maxItems, 6)
  assert.deepEqual(definition.parameters.required, ['context', 'questions'])
})

const VALID_ARGS = {
  context: 'the text to judge',
  questions: [{ type: 'noul', question: 'Is this consistent?' }],
}

test('tool execute: honest no-verdict when the model call fails', async () => {
  const ctx = fakeCtx()
  const runtime = makeRuntime(async () => jsonResponse(503, {}))
  const definition = buildIntuitionToolDefinition({ ctx, runtime })
  const out = await definition.execute(VALID_ARGS, { agent: { session: { id: 's1' } } })
  assert.match(String(out), /no verdict/)
  assert.match(String(out), /do not retry immediately/)
})

test('tool execute: success surfaces answers with the calibration caveat', async () => {
  const ctx = fakeCtx()
  const runtime = makeRuntime(async () => jsonResponse(200, { answers: { q1: { noul: 0.8 } } }))
  const definition = buildIntuitionToolDefinition({ ctx, runtime })
  const out = await definition.execute(VALID_ARGS, { agent: { session: { id: 's1' } } })
  assert.match(String(out), /intuition result/)
  assert.match(String(out), /NOT per-case guarantees/)
  assert.match(String(out), /"noul": 0.8/)
})

test('tool execute: validation errors surface verbatim teaching text', async () => {
  const ctx = fakeCtx()
  let fetched = 0
  const runtime = makeRuntime(async () => { fetched += 1; return jsonResponse(200, {}) })
  const definition = buildIntuitionToolDefinition({ ctx, runtime })
  const out = await definition.execute({ context: 'x'.repeat(6001), questions: VALID_ARGS.questions }, { agent: { session: { id: 's1' } } })
  assert.match(String(out), /exceeds 6000 chars/)
  assert.equal(fetched, 0, 'invalid input never reaches the provider')
})

test('rolling window: 3 calls per 60 s per session, then rate limit; resets after the window', async () => {
  const ctx = fakeCtx()
  const runtime = makeRuntime(async () => jsonResponse(200, { answers: { q1: { noul: 0.5 } } }))
  let clock = 1_000_000
  const definition = buildIntuitionToolDefinition({ ctx, runtime, now: () => clock })
  const exec = { agent: { session: { id: 's1' } } }
  for (let i = 0; i < 3; i += 1) {
    const out = await definition.execute(VALID_ARGS, exec)
    assert.doesNotMatch(String(out), /rate limit/, `call ${i + 1} within budget`)
  }
  const fourth = await definition.execute(VALID_ARGS, exec)
  assert.match(String(fourth), /rate limit/)
  assert.match(String(fourth), /at most 3 calls per minute/)

  // A different session is a different window.
  const other = await definition.execute(VALID_ARGS, { agent: { session: { id: 's2' } } })
  assert.doesNotMatch(String(other), /rate limit/)

  // The window rolls over after 60 s.
  clock += 60_001
  const after = await definition.execute(VALID_ARGS, exec)
  assert.doesNotMatch(String(after), /rate limit/)
})

// ---------------------------------------------------------------------------
// Shortlist blocks: format pinned to the IDBots shapes
// ---------------------------------------------------------------------------

test('skill shortlist block: IDBots <skill_shortlist> shape, top-3 cap, suggested line', () => {
  const entries = [
    { name: 'media-convert', description: 'Convert media files', probability: 0.6 },
    { name: 'pdf', description: 'PDF toolkit', probability: 0.3 },
    { name: 'web-search', description: 'Live web search', probability: 0.2 },
    { name: 'docx', description: 'Word documents', probability: 0.1 },
  ]
  const block = skillShortlist.buildSkillShortlistBlock(entries)
  const lines = block.split('\n')
  assert.equal(lines[0], '<skill_shortlist>')
  assert.equal(lines[lines.length - 1], '</skill_shortlist>')
  assert.ok(block.includes('Consider these'))
  assert.ok(block.includes('skill_tool read_skill'))
  assert.equal((block.match(/^- `/gm) ?? []).length, 3, 'top-K 3')
  assert.ok(block.includes('Suggested skill: `media-convert`.'))
  assert.ok(!block.includes('docx'), 'rank 4 does not ride')
  assert.ok(!block.includes('0.6'), 'probabilities are deliberately NOT rendered')
})

test('service shortlist block: IDBots <remote_service_shortlist> shape', () => {
  const block = serviceShortlist.buildRemoteServiceShortlistBlock([
    { name: 'vision-describe', description: 'Describe images', probability: 0.7 },
    { name: 'audio-transcribe', description: 'Transcribe audio', probability: 0.2 },
  ])
  assert.ok(block.startsWith('<remote_service_shortlist>'))
  assert.ok(block.endsWith('</remote_service_shortlist>'))
  assert.ok(block.includes('Suggested service: `vision-describe`.'))
  assert.equal((block.match(/^- `/gm) ?? []).length, 2)
})

// ---------------------------------------------------------------------------
// Pre-step shortlist observer
// ---------------------------------------------------------------------------

function shortlistHarness(options = {}) {
  const handlers = []
  const fetches = []
  const runs = []
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    on: (event, listener) => {
      if (event === 'agent/pre-step') handlers.push(listener)
      return () => {}
    },
    agentPresets: { composedPreset: () => 'oac-alice' },
  }
  const skillCount = options.skillCount ?? 14
  const serviceCount = options.serviceCount ?? 14
  const run = async (args) => {
    runs.push(args)
    if (args[0] === 'skills' && args[1] === 'list') {
      return {
        ok: true,
        state: 'success',
        data: {
          skills: Array.from({ length: skillCount }, (_, i) => ({
            name: `skill-${i}`,
            version: '1.0.0',
            description: `Skill number ${i}`,
          })),
        },
      }
    }
    if (args[0] === 'network' && args[1] === 'services') {
      return {
        ok: true,
        state: 'success',
        data: {
          services: Array.from({ length: serviceCount }, (_, i) => ({
            servicePinId: `svc-pin-${i}`,
            displayName: `service-${i}`,
            description: `Service number ${i}`,
          })),
        },
      }
    }
    return { ok: true, state: 'success', data: {} }
  }
  const fetchImpl = async (url, init) => {
    fetches.push({ url, body: JSON.parse(init.body) })
    if (options.fetchImpl) return options.fetchImpl(url, init)
    return jsonResponse(200, {
      answers: {
        best_skill: { probabilities: { 'skill-3': 0.5, 'skill-7': 0.3, 'skill-1': 0.2 } },
        best_service: { probabilities: { 'svc-pin-2': 0.6, 'svc-pin-9': 0.4 } },
      },
    })
  }
  const runtime = makeRuntime(fetchImpl)
  applyCerebellumShortlists(ctx, { runtime, run })
  const payload = {
    agent: { ctx: {} },
    messages: [
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '把这张图转成 mp4' }] },
    ],
  }
  const baseMessages = [{ role: 'user', content: [{ type: 'text', text: 'base' }] }]
  const drive = async (decision = { kind: 'enter', messages: baseMessages.slice() }) =>
    handlers.reduce(
      (promise, handler) => promise.then((current) => handler(payload, () => Promise.resolve(current))),
      Promise.resolve(decision),
    )
  return { ctx, handlers, runs, fetches, drive, payload }
}

test('pre-step shortlist: cerebellum OFF appends NO message and fetches nothing', async () => {
  const handlers = []
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    on: (event, listener) => { if (event === 'agent/pre-step') handlers.push(listener); return () => {} },
    agentPresets: { composedPreset: () => 'oac-alice' },
  }
  let fetched = 0
  const runtime = bindCerebellumCore(undefined, { fetchImpl: async () => { fetched += 1; return jsonResponse(200, {}) } })
  let ran = 0
  applyCerebellumShortlists(ctx, { runtime, run: async () => { ran += 1; return { ok: true, state: 'success', data: {} } } })
  const decision = { kind: 'enter', messages: [{ role: 'user', content: [{ type: 'text', text: 'base' }] }] }
  const out = await handlers[0]({ agent: { ctx: {} }, messages: [] }, async () => decision)
  assert.equal(out.messages.length, 1, 'zero message delta')
  assert.equal(fetched, 0, 'no JEV call')
  assert.equal(ran, 0, 'no catalog fetch')
})

test('pre-step shortlist: one extra message beside the memory seat, both blocks, IDBots shapes', async () => {
  const h = shortlistHarness()
  const out = await h.drive()
  assert.equal(out.messages.length, 2, 'exactly one extra user-tail message')
  const added = out.messages[1]
  assert.equal(added.role, 'user')
  assert.equal(added.source.sections[0].name, 'oac:cerebellum-shortlist')
  const text = added.content[0].text
  assert.ok(text.includes('<skill_shortlist>'))
  assert.ok(text.includes('Suggested skill: `skill-3`.'))
  assert.ok(text.includes('<remote_service_shortlist>'))
  assert.ok(text.includes('Suggested service: `service-2`.'))
  // ONE /v1/systemone request for both rankings (turn-decision bundle).
  assert.equal(h.fetches.length, 1)
  const request = h.fetches[0].body
  assert.ok(request.questions.best_skill, 'skill question merged into one request')
  assert.ok(request.questions.best_service, 'service question merged into one request')
  assert.equal(request.state.current_message, '把这张图转成 mp4')
})

test('pre-step shortlist: skill-only when the service pool is below its floor', async () => {
  const h = shortlistHarness({ serviceCount: 3 })
  const out = await h.drive()
  const text = out.messages[1].content[0].text
  assert.ok(text.includes('<skill_shortlist>'))
  assert.ok(!text.includes('<remote_service_shortlist>'))
})

test('pre-step shortlist: JEV failure appends nothing (fail-open)', async () => {
  const h = shortlistHarness({ fetchImpl: async () => jsonResponse(500, {}) })
  const out = await h.drive()
  assert.equal(out.messages.length, 1, 'no extra message on failure')
})

test('pre-step shortlist: non-enter decisions and missing human text pass through', async () => {
  const h = shortlistHarness()
  const skipped = await h.drive({ kind: 'skip', messages: undefined })
  assert.equal(skipped.kind, 'skip')
  const emptyText = structuredClone(h.payload)
  emptyText.messages = [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '   ' }] }]
  const out = await h.handlers[0](emptyText, async () => ({ kind: 'enter', messages: [{ role: 'user', content: [{ type: 'text', text: 'base' }] }] }))
  assert.equal(out.messages.length, 1)
  assert.equal(h.fetches.length, 0)
})

// ---------------------------------------------------------------------------
// Spawned-agent effort resolver
// ---------------------------------------------------------------------------

const effortAnswers = (probabilities) => jsonResponse(200, {
  answers: { effort_level: { probabilities } },
})

test('effort resolver: explicit pick wins verbatim, selector never consulted', async () => {
  let fetched = 0
  const runtime = makeRuntime(async () => { fetched += 1; return effortAnswers({ max: 1 }) })
  const resolve = createSpawnedEffortResolver({ runtime })
  assert.equal(await resolve({ sessionKey: 'k1', promptText: 'do work', explicitEffort: 'low' }), 'low')
  assert.equal(await resolve({ sessionKey: 'k1', promptText: 'do work', explicitEffort: 'high' }), 'high')
  assert.equal(fetched, 0, 'explicit pick short-circuits the selector')
})

test('effort resolver: unattended auto → max (IDBots auto-means-max)', async () => {
  let fetched = 0
  const runtime = makeRuntime(async () => { fetched += 1; return effortAnswers({ off: 1 }) })
  const resolve = createSpawnedEffortResolver({ runtime })
  assert.equal(await resolve({ sessionKey: 'k1', promptText: 'work', explicitEffort: 'auto' }), 'max')
  assert.equal(await resolve({ sessionKey: 'k1', promptText: 'work', explicitEffort: 'Auto' }), 'max')
  assert.equal(fetched, 0)
})

test('effort resolver: cerebellum off / no verdict → null (existing default untouched)', async () => {
  const offRuntime = bindCerebellumCore(undefined, { fetchImpl: async () => effortAnswers({ max: 1 }) })
  const offResolve = createSpawnedEffortResolver({ runtime: offRuntime })
  assert.equal(await offResolve({ sessionKey: 'k1', promptText: 'work' }), null)

  let fetched = 0
  const failing = makeRuntime(async () => { fetched += 1; return jsonResponse(500, {}) })
  const failResolve = createSpawnedEffortResolver({ runtime: failing })
  assert.equal(await failResolve({ sessionKey: 'k1', promptText: 'work' }), null)
  assert.equal(fetched, 1)

  // Blank prompt never calls.
  const blank = makeRuntime(async () => { throw new Error('must not be called') })
  const blankResolve = createSpawnedEffortResolver({ runtime: blank })
  assert.equal(await blankResolve({ sessionKey: 'k1', promptText: '   ' }), null)
})

test('effort resolver: two-level policy (escalate iff P(high)+P(max) ≥ 0.5)', async () => {
  const escalate = makeRuntime(async () => effortAnswers({ off: 0.05, low: 0.1, high: 0.2, max: 0.65 }))
  const escalateResolve = createSpawnedEffortResolver({ runtime: escalate })
  assert.equal(await escalateResolve({ sessionKey: 'e1', promptText: 'refactor this module' }), 'max')

  const heavierHigh = makeRuntime(async () => effortAnswers({ off: 0.05, low: 0.05, high: 0.6, max: 0.3 }))
  assert.equal(
    await createSpawnedEffortResolver({ runtime: heavierHigh })({ sessionKey: 'e2', promptText: 'work' }),
    'high',
    'heavier of high/max when escalated',
  )

  const casual = makeRuntime(async () => effortAnswers({ off: 0.6, low: 0.2, high: 0.1, max: 0.1 }))
  assert.equal(
    await createSpawnedEffortResolver({ runtime: casual })({ sessionKey: 'e3', promptText: '在吗' }),
    'off',
    'below-threshold stays off (fast-first promise)',
  )
})

test('effort resolver: 10-minute session-sticky escalations', async () => {
  let probabilities = { off: 0.05, low: 0.1, high: 0.2, max: 0.65 }
  const runtime = makeRuntime(async () => effortAnswers(probabilities))
  const resolve = createSpawnedEffortResolver({ runtime })
  assert.equal(await resolve({ sessionKey: 'sticky', promptText: 'hard task' }), 'max')
  // Follow-up turn classifies low, but the fresh escalation sticks 10 min.
  probabilities = { off: 0.6, low: 0.3, high: 0.05, max: 0.05 }
  assert.equal(await resolve({ sessionKey: 'sticky', promptText: '继续' }), 'max', 'sticky sustains the escalated rung')
  // A different session key gets its own verdict.
  assert.equal(await resolve({ sessionKey: 'fresh', promptText: '继续' }), 'off')
})

test('effort resolver: never throws', async () => {
  const runtime = makeRuntime(async () => { throw new Error('boom') })
  const resolve = createSpawnedEffortResolver({ runtime })
  assert.equal(await resolve({ sessionKey: 'k', promptText: 'work' }), null)
})

// ---------------------------------------------------------------------------
// agents.create call sites: agentOptions mapping end-to-end
// ---------------------------------------------------------------------------

function scheduleHarness(effort) {
  const created = []
  const agents = {
    create: async (options) => {
      created.push(options)
      await options.setup?.({})
      const listeners = []
      return {
        agent: {
          session: { id: options.sessionId },
          followup: () => {},
          whenIdle: () => Promise.resolve(),
          cancel: () => {},
        },
      }
    },
  }
  const daemon = {
    heartbeat: async () => ({ ok: true, state: 'success', data: {} }),
    due: async () => ({
      ok: true,
      state: 'success',
      data: {
        due: [{
          slug: 'alice',
          tasks: [{
            id: 't1',
            name: 'Nightly backup',
            prompt: 'Refactor the parser and prove correctness.',
            workingDirectory: '/srv',
            channel: 'auto',
          }],
        }],
      },
    }),
    claim: async () => ({ ok: true, state: 'success', data: { run: { id: 'r1' } } }),
    complete: async () => ({ ok: true, state: 'success', data: {} }),
  }
  const run = async (args) => {
    if (args[0] === 'bot' && args[1] === 'list') {
      return { ok: true, state: 'success', data: { profiles: [{ slug: 'alice', dshLlmProvider: 'deepseek', dshLlmModel: 'deepseek-v4-flash' }] } }
    }
    return { ok: true, state: 'success', data: {} }
  }
  return {
    created,
    tick: () => plugin.runScheduleSchedulerTick({
      run,
      daemon,
      agents,
      agentPresets: { mount: async () => {} },
      modelPair: () => ({ provider: 'deepseek', model: 'deepseek-v4-flash' }),
      cwd: '/host',
      effort,
    }),
  }
}

test('schedule spawn: selector rung lands in agentOptions.reasoningEffort', async () => {
  const runtime = makeRuntime(async () => effortAnswers({ off: 0.05, low: 0.05, high: 0.2, max: 0.7 }))
  const h = scheduleHarness(createSpawnedEffortResolver({ runtime }))
  await h.tick()
  assert.equal(h.created.length, 1)
  assert.deepEqual(
    h.created[0].agentOptions,
    { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'max' },
  )
})

test('schedule spawn: null verdict keeps agentOptions untouched (no reasoningEffort key)', async () => {
  const offRuntime = bindCerebellumCore(undefined, { fetchImpl: async () => effortAnswers({ max: 1 }) })
  const h = scheduleHarness(createSpawnedEffortResolver({ runtime: offRuntime }))
  await h.tick()
  assert.deepEqual(
    h.created[0].agentOptions,
    { provider: 'deepseek', model: 'deepseek-v4-flash' },
    'byte-identical to the pre-PR-3 shape',
  )
})

test('schedule spawn: explicit bot pick wins over the selector', async () => {
  const runtime = makeRuntime(async () => effortAnswers({ max: 1 }))
  const effort = createSpawnedEffortResolver({ runtime })
  const created = []
  const agents = {
    create: async (options) => {
      created.push(options)
      await options.setup?.({})
      return { agent: { session: { id: options.sessionId }, followup: () => {}, whenIdle: () => Promise.resolve(), cancel: () => {} } }
    },
  }
  await plugin.runScheduleSchedulerTick({
    run: async (args) => (args[0] === 'bot' && args[1] === 'list'
      ? { ok: true, state: 'success', data: { profiles: [{ slug: 'alice', dshLlmProvider: 'deepseek', dshLlmModel: 'deepseek-v4-flash', dshLlmReasoningEffort: 'low' }] } }
      : { ok: true, state: 'success', data: {} }),
    daemon: {
      heartbeat: async () => ({ ok: true, state: 'success', data: {} }),
      due: async () => ({ ok: true, state: 'success', data: { due: [{ slug: 'alice', tasks: [{ id: 't1', name: 'n', prompt: 'p', workingDirectory: '', channel: 'auto' }] }] } }),
      claim: async () => ({ ok: true, state: 'success', data: { run: { id: 'r1' } } }),
      complete: async () => ({ ok: true, state: 'success', data: {} }),
    },
    agents,
    agentPresets: { mount: async () => {} },
    // Force the profile-carried pair (bot show supplies dshLlmReasoningEffort).
    modelPair: () => ({ provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'low' }),
    cwd: '/host',
    effort,
  })
  assert.equal(created[0].agentOptions.reasoningEffort, 'low')
})

function workerHarness(effort, profile = {}) {
  const created = []
  const ctx = {
    logger: { warn: () => {} },
    agentPresets: { mount: async () => {} },
    on: () => () => {},
    agents: (() => {
      const registryAgents = new Map()
      return {
        create: async (createOptions) => {
          created.push(createOptions)
          const session = { id: createOptions.sessionId }
          const agent = {
            id: createOptions.sessionId,
            ctx: { systemPrompt: { section: () => () => {} }, tools: { register: () => () => {} } },
            followup: (message) => {
              for (const listener of listeners) listener(session, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'done [DELIVERABLE] pin://x' }] } } })
            },
            whenIdle: async () => {},
            cancel: () => {},
            session,
          }
          registryAgents.set(agent.id, agent)
          return { agent, dispose: async () => {} }
        },
        get: (id) => registryAgents.get(id),
        list: () => [...registryAgents.values()],
      }
    })(),
  }
  const listeners = []
  ctx.on = (event, listener) => { if (event === 'session/event') listeners.push(listener); return () => {} }
  const run = async (args) => {
    if (args[0] === 'bot' && args[1] === 'show') {
      return { ok: true, state: 'success', data: { profile: { slug: 'carol', dshLlmProvider: 'deepseek', dshLlmModel: 'deepseek-chat', ...profile } } }
    }
    if (args[1] === 'work' && args[2] === 'claim') {
      return {
        ok: true,
        state: 'success',
        data: {
          request: {
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
          },
        },
      }
    }
    if (args[1] === 'work' && args[2] === 'submit') {
      return { ok: true, state: 'success', data: { status: 'completed', pinId: 'pin-reply' } }
    }
    return { ok: true, state: 'success', data: {} }
  }
  return {
    created,
    claimOnce: () => {
      const runner = plugin.applyGroupTaskWorkerSessions(ctx, { daemonAlive: async () => true, run, pollMs: 600_000, effort })
      return runner.claimOnce()
    },
  }
}

test('group-task worker spawn: selector consulted before agents.create, rung lands in agentOptions', async () => {
  const runtime = makeRuntime(async () => effortAnswers({ off: 0.05, low: 0.05, high: 0.75, max: 0.15 }))
  const h = workerHarness(createSpawnedEffortResolver({ runtime }))
  await h.claimOnce()
  assert.equal(h.created.length, 1)
  assert.equal(h.created[0].agentOptions.reasoningEffort, 'high')
})

test('group-task worker spawn: cerebellum off keeps the previous agentOptions shape', async () => {
  const offRuntime = bindCerebellumCore(undefined, { fetchImpl: async () => effortAnswers({ max: 1 }) })
  const h = workerHarness(createSpawnedEffortResolver({ runtime: offRuntime }))
  await h.claimOnce()
  assert.deepEqual(h.created[0].agentOptions, { provider: 'deepseek', model: 'deepseek-chat' })
})

test('group-task worker spawn: explicit worker pick wins over the selector', async () => {
  const runtime = makeRuntime(async () => effortAnswers({ max: 1 }))
  const h = workerHarness(createSpawnedEffortResolver({ runtime }), { dshLlmReasoningEffort: 'high' })
  await h.claimOnce()
  assert.equal(h.created[0].agentOptions.reasoningEffort, 'high')
})

test('group-task worker spawn: sticky sustains an escalation across a re-spawned session', async () => {
  let probabilities = { off: 0.05, low: 0.05, high: 0.1, max: 0.8 }
  const runtime = makeRuntime(async () => effortAnswers(probabilities))
  const resolve = createSpawnedEffortResolver({ runtime })
  const first = workerHarness(resolve)
  await first.claimOnce()
  assert.equal(first.created[0].agentOptions.reasoningEffort, 'max')

  // Same (task, worker) key, a fresh session spawn, now judging a light brief:
  // the 10-min sticky keeps the escalation (the ported IDBots semantic).
  probabilities = { off: 0.7, low: 0.2, high: 0.05, max: 0.05 }
  const second = workerHarness(resolve)
  await second.claimOnce()
  assert.equal(second.created[0].agentOptions.reasoningEffort, 'max')
})
