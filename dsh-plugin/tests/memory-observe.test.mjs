import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const plugin = await import('../lib/index.js')

function fakeCtx(preset) {
  const listeners = []
  return {
    listeners,
    ctx: {
      on: (event, listener, options) => listeners.push({ event, listener, options }),
      agentPresets: {
        composedPreset: () => preset,
      },
    },
  }
}

const USER_MESSAGE = {
  role: 'user',
  content: [{ type: 'text', text: '帮我想想上次说的咖啡' }],
  source: { kind: 'user' },
}

test('pre-step injection appends the memory block for oac presets only', async () => {
  const { ctx, listeners } = fakeCtx('oac-alice')
  plugin.applyMemoryInjection(ctx, {
    run: async (args) => {
      assert.equal(args[0], 'memory')
      assert.equal(args[1], 'blocks')
      return { ok: true, state: 'success', data: { xml: '<ownerMemories>\n- 我喜欢美式咖啡\n</ownerMemories>' } }
    },
  })
  assert.equal(listeners.length, 1)
  assert.equal(listeners[0].event, 'agent/pre-step')
  const decision = await listeners[0].listener(
    { agent: { ctx: {} }, messages: [USER_MESSAGE], turn: 1, step: 0 },
    async () => ({ kind: 'enter', messages: [USER_MESSAGE] }),
  )
  assert.equal(decision.messages.length, 2)
  assert.equal(decision.messages[1].source.plugin, 'oac-dsh')
  assert.match(decision.messages[1].content[0].text, /美式咖啡/)
  // The injected message is persisted as a `user/message` session event; DSH
  // refuses to reload any session whose user/message events lack an id.
  assert.equal(typeof decision.messages[1].id, 'string')
  assert.notEqual(decision.messages[1].id, '')

  // Non-oac presets pass through untouched.
  const other = fakeCtx('standard')
  plugin.applyMemoryInjection(other.ctx, { run: async () => ({ ok: true, data: { xml: 'x' } }) })
  const passthrough = await other.listeners[0].listener(
    { agent: { ctx: {} }, messages: [USER_MESSAGE], turn: 1, step: 0 },
    async () => ({ kind: 'enter', messages: [USER_MESSAGE] }),
  )
  assert.equal(passthrough.messages.length, 1)

  // A rejected decision is passed through without any CLI call.
  const rejected = await listeners[0].listener(
    { agent: { ctx: {} }, messages: [USER_MESSAGE], turn: 1, step: 0 },
    async () => ({ kind: 'reject' }),
  )
  assert.equal(rejected.kind, 'reject')
})

test('post-turn extraction mirrors transcripts and extracts once per completed turn', async () => {
  const calls = []
  const { ctx, listeners } = fakeCtx(null)
  plugin.applyMemoryExtraction(ctx, {
    run: async (args) => {
      const fileFlag = args.indexOf('--payload-file')
      const file = fileFlag >= 0 ? JSON.parse(await readFile(args[fileFlag + 1], 'utf8')) : null
      calls.push({ args, file })
      return { ok: true, state: 'success', data: {} }
    },
  })
  const listener = listeners.find((entry) => entry.event === 'session/event').listener
  const session = {
    id: 'sess-1',
    header: { agentPreset: 'oac-alice' },
    events: [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: USER_MESSAGE },
      { type: 'assistant/message', data: { turn: 1, step: 0, message: { content: [{ type: 'text', text: '好的' }] } } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ],
  }
  listener(session, { type: 'agent-preset/selected', data: { agentPreset: 'oac-alice' } })
  listener(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  // The per-session queue drains asynchronously; poll until it lands.
  const waitFor = async (predicate, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  await waitFor(() => calls.filter((call) => call.args[1] === 'extract').length >= 1)
  const transcripts = calls.filter((call) => call.args[1] === 'transcript')
  const extracts = calls.filter((call) => call.args[1] === 'extract')
  assert.equal(transcripts.length, 2)
  assert.equal(extracts.length, 1)
  assert.equal(extracts[0].file.userText, '帮我想想上次说的咖啡')
  assert.equal(extracts[0].file.channel, 'dsh')

  // Interrupted turns and non-oac sessions are ignored.
  calls.length = 0
  listener(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'aborted' } } })
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(calls.length, 0)
})

test('memory tools bridge to the CLI with the expected names and formatting', async () => {
  const tools = plugin.buildMemoryToolDefinitions('alice', async (args) => {
    if (args[1] === 'knowledge') {
      return { ok: true, state: 'success', data: { text: 'Saved new knowledge point: 「t」 (kind=know_how, version=1).', entry: { version: 1 } } }
    }
    if (args[1] === 'list') {
      return { ok: true, state: 'success', data: { entries: [{ id: 'mem_1', usageClass: 'preference', text: '我喜欢美式咖啡' }] } }
    }
    return { ok: true, state: 'success', data: { entries: [] } }
  })
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ['conversation_search', 'experience_recall', 'knowledge_recall', 'knowledge_upsert', 'memory_user_edits', 'recent_chats'].sort(),
  )
  const edits = tools.find((tool) => tool.name === 'memory_user_edits')
  const listResult = await edits.execute({ action: 'list' }, {})
  assert.match(listResult, /美式咖啡/)
  const upsert = tools.find((tool) => tool.name === 'knowledge_upsert')
  const upsertResult = await upsert.execute({ topic: 't', summary: 's' }, {})
  assert.match(upsertResult, /Saved new knowledge point/)

  assert.match(plugin.MEMORY_STRATEGY_TEXT, /## Memory Strategy/)
  assert.match(plugin.MEMORY_STRATEGY_TEXT, /conversation_search/)
  assert.match(plugin.MEMORY_STRATEGY_TEXT, /experience_recall/)
})
