import assert from 'node:assert/strict'
import test from 'node:test'

const plugin = await import('../lib/memory-tools.js')

function fakeRun(result) {
  const calls = []
  const full = {
    ok: true,
    state: 'success',
    data: {
      session: {
        sessionId: 'session-abc',
        botSlug: 'bob',
        channel: 'dsh',
        peerGlobalMetaId: null,
        peerName: null,
        messageCount: 2,
        firstMessageAt: 1_700_000_000_000,
        lastMessageAt: 1_700_000_001_000,
      },
      turns: [
        { role: 'user', text: 'hello', ts: 1_700_000_000_000 },
        { role: 'assistant', text: 'hi there', ts: 1_700_000_001_000 },
      ],
    },
  }
  return {
    calls,
    run: async (args, options) => {
      calls.push({ args, options })
      if (result) return result
      const limitIndex = args.indexOf('--limit')
      const limit = limitIndex !== -1 ? Number(args[limitIndex + 1]) : undefined
      const payload = limit !== undefined && Number.isFinite(limit)
        ? { ...full.data, turns: full.data.turns.slice(-limit) }
        : full.data
      return { ...full, data: payload }
    },
  }
}

function sessionTools(run) {
  return plugin.buildMemoryToolDefinitions('bob', run).filter((tool) => tool.name.startsWith('oac_session_'))
}

test('oac_session_read_all reads the transcript verb cross-bot and formats the log', async () => {
  const fake = fakeRun()
  const readAll = sessionTools(fake.run).find((tool) => tool.name === 'oac_session_read_all')
  assert.ok(readAll)
  const text = await readAll.execute({ sessionId: 'session:session-abc' })
  assert.deepEqual(fake.calls[0].args, [
    'memory', 'transcript', 'read', '--session', 'session:session-abc', '--from', 'bob', '--any-bot',
  ])
  assert.match(text, /- session: session-abc/)
  assert.match(text, /owner bot: bob/)
  assert.match(text, /channel: dsh/)
  assert.match(text, /messages: 2/)
  assert.match(text, /\[2023-11-14 22:13\] user: hello/)
  assert.match(text, /\[2023-11-14 22:13\] assistant: hi there/)
})

test('oac_session_read_latest caps the read at one turn', async () => {
  const fake = fakeRun()
  const readLatest = sessionTools(fake.run).find((tool) => tool.name === 'oac_session_read_latest')
  assert.ok(readLatest)
  const text = await readLatest.execute({ sessionId: 'session-abc' })
  assert.deepEqual(fake.calls[0].args, [
    'memory', 'transcript', 'read', '--session', 'session-abc', '--from', 'bob', '--any-bot', '--limit', '1',
  ])
  assert.match(text, /- session: session-abc/)
  assert.match(text, /assistant: hi there/)
  assert.doesNotMatch(text, /user: hello/)
})

test('session read tools surface the CLI failure envelope as an error', async () => {
  const fake = fakeRun({ ok: false, state: 'failed', code: 'session_not_found', message: 'No session found for id: missing' })
  const readAll = sessionTools(fake.run).find((tool) => tool.name === 'oac_session_read_all')
  await assert.rejects(() => readAll.execute({ sessionId: 'missing' }), /No session found/)
})

test('a missing sessionId is rejected before any CLI call', async () => {
  const fake = fakeRun()
  const readAll = sessionTools(fake.run).find((tool) => tool.name === 'oac_session_read_all')
  await assert.rejects(() => readAll.execute({}), /sessionId is required/)
  assert.equal(fake.calls.length, 0)
})

// Global knowledge tools: knowledge_upsert/knowledge_recall exist on the host
// global layer so the learning-loop prompt never advertises a phantom tool
// (KB problem report category A). Acting Bot resolves per exec: session
// oac-* agent first, then the injected machine-default fallback.
function globalKnowledgeSetup(payloadResult) {
  const calls = []
  const run = async (args, options) => {
    calls.push({ args, options })
    if (payloadResult instanceof Error) throw payloadResult
    return payloadResult ?? { ok: true, state: 'success', data: { text: 'Saved knowledge point "kb-tools" (v1).' } }
  }
  return { calls, run }
}

test('bindGlobalKnowledgeToolInstall registers the knowledge pair on the global layer', () => {
  const tools = []
  const ctx = { tools: { register: (definition) => tools.push(definition) } }
  plugin.bindGlobalKnowledgeToolInstall(ctx)
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['knowledge_recall', 'knowledge_upsert'])
})

test('global knowledge_upsert resolves the Twin fallback when the session has no oac agent', async () => {
  const { calls, run } = globalKnowledgeSetup()
  const host = {}
  const defs = plugin.buildGlobalKnowledgeToolDefinitions({ host, resolveFallbackSlug: async () => 'twin-bot', run })
  const upsert = defs.find((tool) => tool.name === 'knowledge_upsert')

  const text = await upsert.execute({ topic: 'kb tools', summary: 'string errors only' }, {})
  assert.equal(typeof text, 'string')
  assert.match(text, /Saved knowledge point/)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args.slice(0, 5), ['memory', 'knowledge', 'upsert', '--from', 'twin-bot'])
  assert.equal(calls[0].args[5], '--payload-file')
})

test('global knowledge_upsert prefers the session oac agent over the fallback', async () => {
  const { calls, run } = globalKnowledgeSetup()
  const host = { agentPresets: { composedPreset: () => 'oac-alice' } }
  const defs = plugin.buildGlobalKnowledgeToolDefinitions({ host, resolveFallbackSlug: async () => 'twin-bot', run })
  const upsert = defs.find((tool) => tool.name === 'knowledge_upsert')

  await upsert.execute({ topic: 't', summary: 's' }, { agent: { ctx: {} } })
  assert.deepEqual(calls[0].args.slice(0, 5), ['memory', 'knowledge', 'upsert', '--from', 'alice'])
})

test('global knowledge tools without any resolvable Bot return a string error, not a phantom-tool failure', async () => {
  const { calls, run } = globalKnowledgeSetup()
  const defs = plugin.buildGlobalKnowledgeToolDefinitions({ host: {}, resolveFallbackSlug: async () => undefined, run })
  const upsert = defs.find((tool) => tool.name === 'knowledge_upsert')
  const recall = defs.find((tool) => tool.name === 'knowledge_recall')

  const upsertResult = await upsert.execute({ topic: 't', summary: 's' }, {})
  assert.equal(typeof upsertResult, 'string')
  assert.match(upsertResult, /^knowledge_upsert failed: /)
  assert.match(upsertResult, /Twin Bot/)
  assert.equal(calls.length, 0, 'no CLI call without a profile')

  const recallResult = await recall.execute({ query: 'x' }, {})
  assert.equal(typeof recallResult, 'string')
  assert.match(recallResult, /^knowledge_recall failed: /)
})
