import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const plugin = await import('../lib/index.js')

const PIN = `${'d'.repeat(64)}i0`

function fakeHub(snapshot, onCommand) {
  return {
    getSnapshot: () => snapshot,
    clientCount: () => (snapshot.open ? 1 : 0),
    open(uri, source = 'host') {
      return { uri, localUiUrl: `http://127.0.0.1:1/browser`, source }
    },
    requestCommand: async (command) => onCommand(command),
  }
}

function fakeAgent() {
  const tools = []
  return {
    tools,
    agent: {
      ctx: {
        tools: { register(definition) { tools.push(definition); return () => {} } },
        systemPrompt: { section() { return () => {} } },
      },
    },
  }
}

test('pre-step injection appends browser_context for oac presets only', async () => {
  const listeners = []
  const ctx = {
    listeners,
    on: (event, listener) => listeners.push({ event, listener }),
    agentPresets: { composedPreset: () => 'oac-alice' },
  }
  plugin.applyBrowserInjection(ctx, () => ({
    open: true,
    tabs: [{ id: 1, uri: `metaapp://${PIN}`, title: '半糖牌局', isActive: true }],
  }))
  assert.equal(listeners[0].event, 'agent/pre-step')
  const user = {
    role: 'user',
    content: [{ type: 'text', text: '那你能看到右边的应用是什么吗' }],
    source: { kind: 'user' },
  }
  const decision = await listeners[0].listener(
    { agent: { ctx: {} }, messages: [user], turn: 1, step: 0 },
    async () => ({ kind: 'enter', messages: [user] }),
  )
  assert.equal(decision.messages.length, 2)
  assert.equal(decision.messages[1].source.plugin, 'oac-dsh')
  assert.match(decision.messages[1].content[0].text, /半糖牌局/)
  assert.match(decision.messages[1].content[0].text, new RegExp(`metaapp://${PIN}`))
  assert.equal(typeof decision.messages[1].id, 'string')
})

test('bot_browser_tabs list uses the live snapshot and does not invent pages when closed', async () => {
  const { agent, tools } = fakeAgent()
  const closed = fakeHub({ open: false, tabs: [] }, async () => ({ requestId: 'x', ok: false }))
  for (const definition of plugin.buildBrowserToolDefinitions({
    slug: 'alice',
    hub: closed,
    cache: plugin.createBrowserSourceCache(),
    hostAgent: agent,
    run: async () => ({ ok: true, state: 'success', data: {} }),
  })) {
    agent.ctx.tools.register(definition)
  }
  const list = tools.find((tool) => tool.name === 'bot_browser_tabs')
  const closedText = await list.execute({ action: 'list' }, {})
  assert.match(closedText, /No open tabs/)

  const openHub = fakeHub({
    open: true,
    tabs: [{ id: 1, uri: `metaapp://${PIN}`, title: '半糖牌局', isActive: true }],
  }, async () => ({ requestId: 'x', ok: true, tabs: [] }))
  const { tools: openTools, agent: openAgent } = fakeAgent()
  for (const definition of plugin.buildBrowserToolDefinitions({
    slug: 'alice',
    hub: openHub,
    cache: plugin.createBrowserSourceCache(),
    hostAgent: openAgent,
    run: async () => ({ ok: true, state: 'success', data: {} }),
  })) {
    openAgent.ctx.tools.register(definition)
  }
  const listed = await openTools.find((tool) => tool.name === 'bot_browser_tabs').execute({ action: 'list' }, {})
  assert.match(listed, /半糖牌局/)
  assert.match(listed, new RegExp(`metaapp://${PIN}`))
})

test('search_metaapps formats CLI hits as markdown links', async () => {
  const { agent, tools } = fakeAgent()
  for (const definition of plugin.buildBrowserToolDefinitions({
    slug: 'alice',
    hub: fakeHub({ open: false, tabs: [] }, async () => ({ requestId: 'x', ok: false })),
    cache: plugin.createBrowserSourceCache(),
    hostAgent: agent,
    run: async (args) => {
      assert.deepEqual(args.slice(0, 2), ['metaapp', 'search'])
      return {
        ok: true,
        state: 'success',
        data: {
          items: [{
            pinId: PIN,
            title: '半糖牌局',
            publisherName: 'bob',
            publisherGlobalMetaId: 'idq1bob',
          }],
        },
      }
    },
  })) {
    agent.ctx.tools.register(definition)
  }
  const text = await tools.find((tool) => tool.name === 'search_metaapps').execute({ query: '牌局' }, {})
  assert.match(text, new RegExp(`\\[半糖牌局\\]\\(metaapp://${PIN}\\)`))
  assert.match(text, /\[bob\]\(metaid:\/\/idq1bob\)/)
})

test('bot_browser_publish_app asks DSH approval and skips CLI when cancelled', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oac-dsh-publish-'))
  await writeFile(join(dir, 'APP.md'), 'A test app.\n', 'utf8')
  await writeFile(join(dir, 'index.html'), '<html></html>\n', 'utf8')
  const calls = []
  const { agent, tools } = fakeAgent()
  for (const definition of plugin.buildBrowserToolDefinitions({
    slug: 'alice',
    hub: fakeHub({ open: false, tabs: [] }, async () => ({ requestId: 'x', ok: false })),
    cache: plugin.createBrowserSourceCache(),
    hostAgent: agent,
    approval: {
      async request(req) {
        assert.equal(req.toolName, 'bot_browser_publish_app')
        assert.match(req.reason, /Publish MetaApp/)
        return 'rejected'
      },
    },
    run: async (args) => {
      calls.push(args)
      return { ok: true, state: 'success', data: {} }
    },
  })) {
    agent.ctx.tools.register(definition)
  }
  const text = await tools.find((tool) => tool.name === 'bot_browser_publish_app').execute(
    { dir, title: 'Test App' },
    { agent },
  )
  assert.match(text, /cancelled/)
  assert.equal(calls.length, 0)
})

test('bot_browser_publish_app refuses to publish without APP.md', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oac-dsh-publish-empty-'))
  const { agent, tools } = fakeAgent()
  for (const definition of plugin.buildBrowserToolDefinitions({
    slug: 'alice',
    hub: fakeHub({ open: false, tabs: [] }, async () => ({ requestId: 'x', ok: false })),
    cache: plugin.createBrowserSourceCache(),
    hostAgent: agent,
    approval: { async request() { return 'allowed-once' } },
    run: async () => ({ ok: true, state: 'success', data: {} }),
  })) {
    agent.ctx.tools.register(definition)
  }
  await assert.rejects(
    () => tools.find((tool) => tool.name === 'bot_browser_publish_app').execute({ dir }, { agent }),
    /APP.md is required/,
  )
})

test('hub command roundtrip resolves when a client posts the result', async () => {
  const hub = new plugin.BrowserEventHub({ METABOT_DAEMON_BASE_URL: '' })
  const frames = []
  const off = hub.addClient((frame) => frames.push(frame))
  try {
    const pending = hub.requestCommand({ action: 'list' })
    assert.equal(frames.length, 1)
    assert.equal(frames[0].event, 'browser-command')
    const requestId = frames[0].data.requestId
    hub.completeCommand({
      requestId,
      ok: true,
      action: 'list',
      tabs: [{ id: 1, uri: `metaapp://${PIN}`, title: 'Desk', isActive: true }],
    })
    const result = await pending
    assert.equal(result.ok, true)
    assert.equal(result.tabs[0].title, 'Desk')
  } finally {
    off()
    hub.stop()
  }
})

test('browser/state and command-result routes update the hub', async () => {
  const routes = []
  const ctx = {
    webRuntime: { trustedHosts: [] },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    effect(fn) {
      fn()
    },
  }
  await plugin.apply(ctx, { skipBootstrap: true })
  const route = routes[0]
  const state = capture()
  await route.handler(
    request('POST', '/oac/api/browser/state', {
      open: true,
      tabs: [{ id: 1, uri: `metaapp://${PIN}`, title: '半糖牌局', isActive: true }],
    }),
    state.res,
  )
  assert.equal(state.status, 200)
  const body = JSON.parse(state.body)
  assert.equal(body.ok, true)
  assert.equal(body.data.tabs[0].title, '半糖牌局')
})

test('browser tools are skipped on standard created, then installed when the session switches to oac-*', () => {
  const { agent, tools } = fakeAgent()
  agent.id = 'sess-1'
  const listeners = []
  let preset = 'standard'
  plugin.bindBrowserToolInstall(
    {
      on: (event, listener) => listeners.push({ event, listener }),
      agentPresets: { composedPreset: () => preset },
    },
    fakeHub({ open: false, tabs: [] }, async () => ({ requestId: 'x', ok: false })),
    plugin.createBrowserSourceCache(),
  )
  const created = listeners.find((entry) => entry.event === 'agent/created')
  const selected = listeners.find((entry) => entry.event === 'session/event')
  const selectedDirect = listeners.find((entry) => entry.event === 'agent-preset/selected')
  assert.ok(created)
  assert.ok(selected)
  assert.ok(selectedDirect)

  created.listener({ agent })
  assert.equal(tools.some((tool) => tool.name === 'bot_browser_open_uri'), false)

  preset = 'oac-alice'
  selected.listener(
    { id: 'sess-1' },
    { type: 'agent-preset/selected', data: { agentPreset: 'oac-alice' } },
  )
  assert.equal(tools.some((tool) => tool.name === 'bot_browser_open_uri'), true)

  const count = tools.length
  selectedDirect.listener('sess-1', 'oac-alice')
  assert.equal(tools.length, count)
})

test('installBrowserToolsOnAgent is idempotent on the same agent', () => {
  const { agent, tools } = fakeAgent()
  const hub = fakeHub({ open: false, tabs: [] }, async () => ({ requestId: 'x', ok: false }))
  const cache = plugin.createBrowserSourceCache()
  plugin.installBrowserToolsOnAgent(agent, 'alice', hub, cache)
  plugin.installBrowserToolsOnAgent(agent, 'alice', hub, cache)
  assert.equal(tools.filter((tool) => tool.name === 'bot_browser_open_uri').length, 1)
})

function request(method, url, payload) {
  return {
    method,
    url,
    headers: { host: '127.0.0.1:8787' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(payload ?? {}))
    },
  }
}

function capture() {
  const box = { status: 0, body: '', res: null }
  box.res = {
    statusCode: 0,
    writeHead(status) {
      box.status = status
    },
    end(body) {
      box.body = body === undefined ? '' : String(body)
    },
  }
  return box
}
