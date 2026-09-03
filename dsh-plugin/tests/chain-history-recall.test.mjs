import assert from 'node:assert/strict'
import test from 'node:test'

const {
  buildChainHistoryRecallToolDefinitions,
  DEFAULT_CHAIN_HISTORY_RECALL_LIMIT,
  MAX_CHAIN_HISTORY_RECALL_LIMIT,
  formatChainHistoryRecallResults,
  resolveChainHistoryRecallQuery,
} = await import('../lib/chain-history-recall.js')

// Pure-block cases ported from IDBots tests/chainHistoryRecallBlocks.test.mjs.
// Deviation: the OAC port resolves validated YYYY-MM-DD strings (dateFrom /
// dateTo) instead of local-midnight ms — the CLI handler converts them — and
// the ledger has no write origin field, so no `via <origin>` segment exists.

test('resolveChainHistoryRecallQuery applies defaults and clamps', () => {
  const resolved = resolveChainHistoryRecallQuery({})
  assert.equal(resolved.query, null)
  assert.equal(resolved.kind, 'both')
  assert.equal(resolved.dateFrom, null)
  assert.equal(resolved.dateTo, null)
  assert.equal(resolved.limit, DEFAULT_CHAIN_HISTORY_RECALL_LIMIT)

  assert.equal(resolveChainHistoryRecallQuery({ kind: 'write' }).kind, 'write')
  assert.equal(resolveChainHistoryRecallQuery({ kind: 'read' }).kind, 'read')
  assert.equal(resolveChainHistoryRecallQuery({ kind: 'bogus' }).kind, 'both', 'unknown kind falls back to both')
  assert.equal(resolveChainHistoryRecallQuery({ query: '  ' }).query, null, 'blank query is treated as absent')
  assert.equal(resolveChainHistoryRecallQuery({ query: ' meta web ' }).query, 'meta web')
  assert.equal(resolveChainHistoryRecallQuery({ limit: 0 }).limit, 1)
  assert.equal(resolveChainHistoryRecallQuery({ limit: 999 }).limit, MAX_CHAIN_HISTORY_RECALL_LIMIT)
})

test('resolveChainHistoryRecallQuery keeps valid date strings and ignores bad dates', () => {
  const resolved = resolveChainHistoryRecallQuery({ date_from: '2026-09-01', date_to: '2026-09-02' })
  assert.equal(resolved.dateFrom, '2026-09-01')
  assert.equal(resolved.dateTo, '2026-09-02')
  assert.deepEqual(
    resolveChainHistoryRecallQuery({ date_from: 'yesterday', date_to: '2026/13/99' }),
    { query: null, kind: 'both', dateFrom: null, dateTo: null, limit: DEFAULT_CHAIN_HISTORY_RECALL_LIMIT },
    'malformed dates are dropped, not fatal',
  )
})

const write = (overrides = {}) => ({
  pinId: 'w1',
  path: '/protocols/simplebuzz',
  operation: 'create',
  contentText: '今天发布了新功能',
  summary: null,
  occurredAtMs: Date.parse('2026-09-01T02:00:00.000Z'),
  ...overrides,
})

const read = (overrides = {}) => ({
  pinId: 'r1',
  path: '/protocols/simplenote',
  protocol: 'simplenote',
  title: 'MetaWeb 指南',
  authorGlobalMetaId: 'gm-author',
  contentExcerpt: '指南正文',
  summary: '介绍基本用法',
  savedToKb: true,
  lastReadAtMs: Date.parse('2026-09-01T05:00:00.000Z'),
  readCount: 3,
  ...overrides,
})

test('formatChainHistoryRecallResults renders writes and reads with pin ids and gists', () => {
  const text = formatChainHistoryRecallResults([write()], [read()])
  assert.ok(text.includes('[write] pinId=w1'), 'write line carries the pinId')
  assert.ok(text.includes('/protocols/simplebuzz'))
  assert.ok(text.includes('今天发布了新功能'), 'write without summary falls back to stored text')
  assert.ok(!text.includes(' via '), 'no origin field exists in the OAC ledger')
  assert.ok(text.includes('[read] pinId=r1'), 'read line carries the pinId')
  assert.ok(text.includes('「MetaWeb 指南」'))
  assert.ok(text.includes('author=gm-author'))
  assert.ok(text.includes('saved to knowledge base'), 'KB flag is surfaced')
  assert.ok(text.includes('read 3 times'), 'repeat reads are surfaced')
  assert.ok(text.includes('介绍基本用法'), 'read gist prefers the summary over the excerpt')
  assert.ok(text.includes('read_metaweb_pin'), 're-open hint present')
  assert.ok(
    text.indexOf('[write]') < text.indexOf('[read]'),
    'writes render before reads',
  )
  assert.ok(text.includes('2026-09-01T02:00:00.000Z'), 'write timestamp is ISO')
  assert.ok(text.includes('2026-09-01T05:00:00.000Z'), 'read timestamp is ISO')
})

test('formatChainHistoryRecallResults prefers summaries and degrades gracefully', () => {
  const summarized = write({ summary: '发布了一篇长文', contentText: 'x'.repeat(1000) })
  const binary = write({ pinId: 'w2', contentText: null })
  const noExcerpt = read({
    pinId: 'r2', title: null, path: null, protocol: null, contentExcerpt: null,
    summary: null, authorGlobalMetaId: null, savedToKb: false, readCount: 1,
  })
  const text = formatChainHistoryRecallResults([summarized, binary], [noExcerpt])
  assert.ok(text.includes('发布了一篇长文'), 'summary wins over full text')
  assert.ok(!text.includes('x'.repeat(1000)))
  assert.ok(text.includes('(binary content)'), 'binary writes degrade to a marker')
  assert.ok(text.includes('(no excerpt)') && text.includes('(unknown)'), 'bare reads stay readable')
  assert.ok(!text.includes('read 1 times'), 'single reads carry no count')
})

test('formatChainHistoryRecallResults caps long gists and reports empty results', () => {
  const longGist = write({ summary: '摘'.repeat(500) })
  const text = formatChainHistoryRecallResults([longGist], [])
  assert.ok(!text.includes('摘'.repeat(500)), 'gist is truncated')
  assert.ok(text.includes('…'))
  assert.ok(
    formatChainHistoryRecallResults([], []).includes('No matching records'),
    'empty results get an explicit message',
  )
})

// Tool execute: fake RunFn captures CLI args; the host resolves oac-alice.
const WRITE_RECORD = write()
const READ_RECORD = read()

function makeRun(calls, data) {
  return async (args, options) => {
    calls.push({ args, options })
    if (data instanceof Error) return { ok: false, state: 'failed', code: 'boom', message: data.message }
    return { ok: true, state: 'success', data }
  }
}

function buildTool(run, preset = 'oac-alice') {
  const host = { agentPresets: { composedPreset: () => preset } }
  const tools = buildChainHistoryRecallToolDefinitions({ host, hostAgent: { ctx: { marker: true } }, run })
  return tools.find((tool) => tool.name === 'chain_history_recall')
}

test('chain_history_recall execute builds CLI args from the resolved query and formats output', async () => {
  const calls = []
  const tool = buildTool(makeRun(calls, { writes: [WRITE_RECORD], reads: [READ_RECORD] }))

  const result = await tool.execute(
    { query: ' 指南 ', kind: 'read', date_from: '2026-09-01', date_to: '2026-09-03', limit: 5 },
    {},
  )

  assert.deepEqual(calls[0].args, [
    'chainhistory', 'recall', '--from', 'alice',
    '--query', '指南', '--kind', 'read', '--from-date', '2026-09-01', '--to-date', '2026-09-03', '--limit', '5',
  ])
  assert.equal(calls[0].options.timeoutMs, 30_000)
  assert.match(result, /\[write\] pinId=w1/)
  assert.match(result, /\[read\] pinId=r1 「MetaWeb 指南」/)
  assert.match(result, /saved to knowledge base/)
  assert.match(result, /read_metaweb_pin/)
})

test('chain_history_recall bare execute forwards only the slug and default limit', async () => {
  const calls = []
  const tool = buildTool(makeRun(calls, { writes: [], reads: [] }))

  const result = await tool.execute({}, {})

  assert.deepEqual(calls[0].args, ['chainhistory', 'recall', '--from', 'alice', '--limit', '20'])
  assert.match(result, /No matching records/)
})

test('chain_history_recall drops malformed tool dates instead of failing', async () => {
  const calls = []
  const tool = buildTool(makeRun(calls, { writes: [], reads: [] }))

  const result = await tool.execute({ date_from: 'last week', date_to: '2026/13/99' }, {})

  assert.deepEqual(calls[0].args, ['chainhistory', 'recall', '--from', 'alice', '--limit', '20'])
  assert.match(result, /No matching records/)
})

test('chain_history_recall surfaces CLI failure as a tool error string', async () => {
  const calls = []
  const tool = buildTool(makeRun(calls, new Error('no such bot')))

  const result = await tool.execute({}, {})
  assert.deepEqual(result, { error: 'no such bot' })

  const throwing = buildTool(async () => { throw new Error('cli down') })
  assert.deepEqual(await throwing.execute({}, {}), { error: 'cli down' })
})

test('chain_history_recall without a resolvable slug returns a friendly error', async () => {
  const calls = []
  const tool = buildTool(makeRun(calls, { writes: [], reads: [] }), null)

  const result = await tool.execute({}, { agent: undefined })
  assert.match(result.error, /no Bot slug resolved/)
  assert.equal(calls.length, 0, 'no CLI call is attempted without a slug')
})
