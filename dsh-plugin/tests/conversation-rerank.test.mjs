/**
 * Cerebellum conversation_search re-rank tests — Round 3 PR-2 (design doc
 * design-assistant-cerebellum-port.md §2.2 B5 / §3 PR-2 test strategy).
 *
 * Proves, with injected fetches only (no network):
 *   - a score map below the 0.8 answer-coverage floor is discarded → the
 *     keyword order is kept VERBATIM (same records, same order);
 *   - full scores reorder: noul replaces recency as the rank key, missing
 *     ids sink below scored ones;
 *   - disabled config (the shipped default) → original order untouched,
 *     ZERO JEV calls;
 *   - blank query / pool < 2 (CEREBELLUM_CONVERSATION_RANK_MIN_POOL) → no
 *     JEV call, order kept;
 *   - the request carries chat_<i> questions over composite
 *     `sessionId#index` candidate ids, ≤10 candidates, 700-char text cap,
 *     and the IDBots Title/Human/Assistant candidate format;
 *   - the tool-level `conversation_search` renders the re-ranked order and
 *     stays byte-identical without a runtime.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const writeGateModule = await import('../lib/cerebellum-write-gate.js')
const { rerankConversationSearch } = writeGateModule
const { bindCerebellumCore } = await import('../lib/cerebellum/client.js')
const convQuestions = await import('../lib/cerebellum/questions/conversationSearchRank.js')
const plugin = await import('../lib/index.js')

/** The plugin-config cerebellum SECTION — bindCerebellumCore takes the
 *  section itself (index.ts passes `config.cerebellum`), not the envelope. */
const ENABLED_SECTION = {
  enabled: true,
  provider: 'typesafe-jev',
  apiKey: 'sk-test',
  baseUrl: 'https://jev.example',
  model: 'jev-test-model',
}

const RECORDS = [
  { sessionId: 'sess-a', role: 'user', text: '最近的那次咖啡豆讨论', peerName: '阿明', ts: 3000 },
  { sessionId: 'sess-b', role: 'assistant', text: '烘焙度建议是中浅', peerName: '阿明', ts: 2000 },
  { sessionId: 'sess-a', role: 'assistant', text: '我们最后选了耶加雪菲', peerName: '阿明', ts: 1000 },
]

/** A JEV fake that answers chat_<i> noul values from the request's own chats. */
function rankerFetch(noulByIndex) {
  return async (_url, init) => {
    const body = JSON.parse(init.body)
    const answers = {}
    for (let index = 0; index < body.state.chats.length; index += 1) {
      const noul = noulByIndex(index, body)
      if (noul !== undefined) answers[`chat_${index}`] = { noul }
    }
    return { ok: true, status: 200, json: async () => ({ answers }) }
  }
}

function rankerRuntime(fetchImpl, onCall) {
  return bindCerebellumCore(ENABLED_SECTION, {
    fetchImpl: async (url, init) => {
      const result = await fetchImpl(url, init)
      onCall?.({ url, body: JSON.parse(init.body) })
      return result
    },
  })
}

test('rerank: score map below the 0.8 coverage floor → keyword order kept VERBATIM', async () => {
  const jevCalls = []
  const runtime = rankerRuntime(rankerFetch((index) => (index === 0 ? 0.9 : undefined)), (call) => jevCalls.push(call))
  const ordered = await rerankConversationSearch({
    runtime,
    query: '咖啡豆',
    records: RECORDS,
  })
  assert.equal(jevCalls.length, 1, 'one JEV call was made')
  assert.equal(ordered.length, RECORDS.length)
  assert.deepEqual(ordered, RECORDS, 'coverage-floor null keeps the input order verbatim')
  assert.equal(ordered[0], RECORDS[0], 'the same record objects, not copies')
})

test('rerank: full scores reorder — noul replaces recency as the rank key', async () => {
  const runtime = rankerRuntime(rankerFetch((index) => [0.2, 0.9, 0.5][index]))
  const ordered = await rerankConversationSearch({ runtime, query: '咖啡豆', records: RECORDS })
  assert.deepEqual(
    ordered.map((record) => record.text),
    ['烘焙度建议是中浅', '我们最后选了耶加雪菲', '最近的那次咖啡豆讨论'],
    '0.9 first, 0.5 second, 0.2 last',
  )
})

test('rerank: missing score sinks below scored ones (original relative order kept)', async () => {
  // chat_1 is missing from the answers but the floor is met (2/3 ≥ 0.8×3?
  // no: 2 < 2.4 → discarded). Use 5 records with 4 answers (4 ≥ 0.8×5 is
  // 4 ≥ 4 → exactly at the floor → kept) to exercise the sink semantics.
  const five = [
    { sessionId: 's1', role: 'user', text: 'r0' },
    { sessionId: 's2', role: 'user', text: 'r1' },
    { sessionId: 's3', role: 'user', text: 'r2' },
    { sessionId: 's4', role: 'user', text: 'r3' },
    { sessionId: 's5', role: 'user', text: 'r4' },
  ]
  const runtime = rankerFetch((index) => (index === 3 ? undefined : [0.1, 0.9, 0.5, undefined, 0.3][index]))
  const wrapped = rankerRuntime(runtime)
  const ordered = await rerankConversationSearch({ runtime: wrapped, query: 'q', records: five })
  assert.deepEqual(
    ordered.map((record) => record.text),
    ['r1', 'r2', 'r4', 'r0', 'r3'],
    'scored desc first, then the unscored (r3) and the 0.1 (r0) sink in original order',
  )
})

test('rerank: disabled config → original order untouched, ZERO JEV calls', async () => {
  const jevCalls = []
  const runtime = bindCerebellumCore(
    { enabled: false, provider: 'typesafe-jev', apiKey: 'sk-test' },
    {
      fetchImpl: async (url, init) => {
        jevCalls.push({ url, init })
        return rankerFetch(() => 0.9)(url, init)
      },
    },
  )
  const ordered = await rerankConversationSearch({ runtime, query: '咖啡豆', records: RECORDS })
  assert.equal(jevCalls.length, 0)
  assert.deepEqual(ordered, RECORDS)
})

test('rerank: blank query → no JEV call; pool below min 2 → no JEV call', async () => {
  const jevCalls = []
  const runtime = rankerRuntime(rankerFetch(() => 0.9), (call) => jevCalls.push(call))
  const blank = await rerankConversationSearch({ runtime, query: '   ', records: RECORDS })
  assert.deepEqual(blank, RECORDS)
  const solo = await rerankConversationSearch({ runtime, query: '咖啡豆', records: [RECORDS[0]] })
  assert.deepEqual(solo, [RECORDS[0]])
  assert.equal(jevCalls.length, 0, 'neither path reached JEV')
})

test('rerank: runtime failure → original order (never throws)', async () => {
  const ordered = await rerankConversationSearch({
    runtime: {
      client: {},
      resolveCallContext: async () => {
        throw new Error('runtime exploded')
      },
    },
    query: '咖啡豆',
    records: RECORDS,
  })
  assert.deepEqual(ordered, RECORDS)
})

test('rerank: request shape — chat_<i> ids, composite sessionId#index, candidate format, ≤10 pool', async () => {
  const jevBodies = []
  const runtime = rankerRuntime(rankerFetch((index) => (index === 0 ? 0.9 : 0.1)), (call) => jevBodies.push(call))
  await rerankConversationSearch({ runtime, query: ' 咖啡豆 ', records: RECORDS })
  assert.equal(jevBodies.length, 1)
  const body = jevBodies[0].body
  assert.equal(body.model, 'jev-test-model')
  assert.equal(body.state.search_query, '咖啡豆', 'query collapsed and trimmed')
  assert.deepEqual(
    body.state.chats.map((chat) => chat.id),
    ['sess-a#0', 'sess-b#1', 'sess-a#2'],
    'composite ids are unique per record even when a session repeats',
  )
  assert.equal(
    body.state.chats[0].text,
    'Title: 阿明 Human: 最近的那次咖啡豆讨论 Assistant: (empty)',
    'IDBots candidate text format, role-split',
  )
  assert.equal(
    body.state.chats[1].text,
    'Title: 阿明 Human: (empty) Assistant: 烘焙度建议是中浅',
  )
  assert.equal(Object.keys(body.questions).length, 3)
  assert.equal(body.questions.chat_0.type, 'noul')
  assert.equal(
    body.questions.chat_0.instructions,
    convQuestions.CEREBELLUM_CONVERSATION_RANK_INSTRUCTIONS.replaceAll('{{INDEX}}', '0'),
    'byte-synced instruction with the index substituted',
  )

  // ≤10 pool: 12 records produce 10 candidates.
  const twelve = Array.from({ length: 12 }, (_row, index) => ({ sessionId: `s${index}`, role: 'user', text: `t${index}` }))
  const bodies2 = []
  const runtime2 = rankerRuntime(rankerFetch(() => 0.5), (call) => bodies2.push(call))
  await rerankConversationSearch({ runtime: runtime2, query: 'q', records: twelve })
  assert.equal(bodies2.length, 1)
  assert.equal(bodies2[0].body.state.chats.length, 10, 'the pool is capped at 10 candidates')
  assert.equal(Object.keys(bodies2[0].body.questions).length, 10, 'one chat_<i> question per candidate')
})

test('rerank: long candidate text is capped at 700 chars', async () => {
  const bodies = []
  const runtime = rankerRuntime(rankerFetch(() => 0.5), (call) => bodies.push(call))
  await rerankConversationSearch({
    runtime,
    query: 'q',
    records: [
      { sessionId: 's', role: 'user', text: '长'.repeat(2000) },
      { sessionId: 't', role: 'user', text: '短' },
    ],
  })
  assert.equal(bodies.length, 1)
  assert.ok(
    bodies[0].body.state.chats[0].text.length <= convQuestions.CEREBELLUM_CONVERSATION_TEXT_MAX_CHARS,
    'the candidate text never exceeds the 700-char cap',
  )
})

test('tool-level: conversation_search renders the re-ranked order via buildMemoryToolDefinitions', async () => {
  const definitions = plugin.buildMemoryToolDefinitions
    ? plugin.buildMemoryToolDefinitions
    : null
  assert.ok(definitions, 'plugin re-exports buildMemoryToolDefinitions')
  const runtime = rankerRuntime(rankerFetch((index) => [0.1, 0.9][index]))
  const tool = definitions('alice', async (args) => {
    const fileFlag = args.indexOf('--payload-file')
    const file = fileFlag >= 0 ? JSON.parse(await readFile(args[fileFlag + 1], 'utf8')) : null
    assert.equal(args[0], 'memory')
    assert.equal(args[1], 'search')
    return {
      ok: true,
      state: 'success',
      data: { records: [
        { sessionId: 'sess-old', role: 'user', text: '旧命中', ts: 2000, peerName: '阿明' },
        { sessionId: 'sess-new', role: 'user', text: '新命中', ts: 3000, peerName: '阿明' },
      ] },
    }
  }, { cerebellumRuntime: runtime }).find((definition) => definition.name === 'conversation_search')
  assert.ok(tool)
  const output = await tool.execute({ query: '命中' })
  const lines = output.split('\n')
  assert.match(lines[0], /新命中/)
  assert.match(lines[1], /旧命中/)
})

test('tool-level: without a runtime the tool renders the search order untouched', async () => {
  const definitions = plugin.buildMemoryToolDefinitions
  const tool = definitions('alice', async () => ({
    ok: true,
    state: 'success',
    data: { records: [
      { sessionId: 'sess-old', role: 'user', text: '旧命中', ts: 2000, peerName: '阿明' },
      { sessionId: 'sess-new', role: 'user', text: '新命中', ts: 3000, peerName: '阿明' },
    ] },
  })).find((definition) => definition.name === 'conversation_search')
  const output = await tool.execute({ query: '命中' })
  const lines = output.split('\n')
  assert.match(lines[0], /旧命中/, 'input order (recency) preserved without a runtime')
  assert.match(lines[1], /新命中/)
})
