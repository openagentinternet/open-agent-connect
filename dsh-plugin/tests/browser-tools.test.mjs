import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const plugin = await import('../lib/index.js')

const PIN = `${'d'.repeat(64)}i0`

function fakeHub(snapshot, onCommand) {
  const opens = []
  return {
    opens,
    getSnapshot: () => snapshot,
    clientCount: () => (snapshot.open ? 1 : 0),
    open(uri, source = 'host') {
      opens.push({ uri, source })
      return { uri, localUiUrl: uri ? `http://127.0.0.1:1/browser` : 'http://127.0.0.1:1/browser', source }
    },
    publishCatalog() {},
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

test('search_metaapps retries once on abort then returns candidates', async () => {
  let calls = 0
  const { agent, tools } = fakeAgent()
  for (const definition of plugin.buildBrowserToolDefinitions({
    slug: 'alice',
    hub: fakeHub({ open: false, tabs: [] }, async () => ({ requestId: 'x', ok: false })),
    cache: plugin.createBrowserSourceCache(),
    hostAgent: agent,
    run: async () => {
      calls += 1
      if (calls === 1) {
        return { ok: false, state: 'failed', message: 'This operation was aborted' }
      }
      return {
        ok: true,
        state: 'success',
        data: {
          items: [{ pinId: PIN, title: '半糖牌局', publisherName: 'bob', publisherGlobalMetaId: 'idq1bob' }],
        },
      }
    },
  })) {
    agent.ctx.tools.register(definition)
  }
  const text = await tools.find((tool) => tool.name === 'search_metaapps').execute({ query: '牌局' }, {})
  assert.equal(calls, 2)
  assert.match(text, new RegExp(`\\[半糖牌局\\]\\(metaapp://${PIN}\\)`))
})

test('bot_browser_publish_app skips the native dialog when approval policy is never', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oac-dsh-publish-never-'))
  await writeFile(join(dir, 'APP.md'), 'A test app.\n', 'utf8')
  await writeFile(join(dir, 'index.html'), '<html></html>\n', 'utf8')
  const calls = []
  const asked = []
  const { agent, tools } = fakeAgent()
  agent.session = { events: [{ type: 'approval/policy', data: { policy: 'never' } }] }
  for (const definition of plugin.buildBrowserToolDefinitions({
    slug: 'alice',
    hub: fakeHub({ open: false, tabs: [] }, async () => ({ requestId: 'x', ok: false })),
    cache: plugin.createBrowserSourceCache(),
    hostAgent: agent,
    approval: {
      async request(req) {
        asked.push(req)
        return 'rejected'
      },
    },
    run: async (args) => {
      calls.push(args)
      return { ok: true, state: 'success', data: { firstPinId: PIN, metaappUri: `metaapp://${PIN}` } }
    },
  })) {
    agent.ctx.tools.register(definition)
  }
  const text = await tools.find((tool) => tool.name === 'bot_browser_publish_app').execute(
    { dir, title: 'Test App' },
    { agent },
  )
  assert.equal(asked.length, 0)
  assert.equal(calls.length, 1)
  assert.match(calls[0].join(' '), /publish-project/)
  assert.match(text, new RegExp(`metaapp://${PIN}`))
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

test('bindBrowserToolInstall registers bot_browser_open_uri on the host tools registry', () => {
  const tools = []
  plugin.bindBrowserToolInstall(
    {
      tools: { register(definition) { tools.push(definition); return () => {} } },
      systemPrompt: { section() { return () => {} } },
    },
    fakeHub({ open: false, tabs: [] }, async () => ({ requestId: 'x', ok: false })),
    plugin.createBrowserSourceCache(),
  )
  assert.equal(tools.some((tool) => tool.name === 'bot_browser_open_uri'), true)
})

test('installBrowserToolsOnAgent is idempotent on the same agent', () => {
  const { agent, tools } = fakeAgent()
  const hub = fakeHub({ open: false, tabs: [] }, async () => ({ requestId: 'x', ok: false }))
  const cache = plugin.createBrowserSourceCache()
  plugin.installBrowserToolsOnAgent(agent, 'alice', hub, cache)
  plugin.installBrowserToolsOnAgent(agent, 'alice', hub, cache)
  assert.equal(tools.filter((tool) => tool.name === 'bot_browser_open_uri').length, 1)
})

test('bot_browser_open_uri with no uri opens the Bot Browser homepage', async () => {
  const { agent, tools } = fakeAgent()
  const hub = fakeHub({ open: false, tabs: [] }, async () => ({ requestId: 'x', ok: false }))
  for (const definition of plugin.buildBrowserToolDefinitions({
    slug: 'alice',
    hub,
    cache: plugin.createBrowserSourceCache(),
    hostAgent: agent,
    run: async () => ({ ok: true, state: 'success', data: {} }),
  })) {
    agent.ctx.tools.register(definition)
  }
  const open = tools.find((tool) => tool.name === 'bot_browser_open_uri')
  const text = await open.execute({}, {})
  assert.match(text, /homepage/)
  assert.deepEqual(hub.opens, [{ uri: null, source: 'host' }])
  const homeAlias = await open.execute({ uri: 'home' }, {})
  assert.match(homeAlias, /homepage/)
  assert.equal(plugin.isBrowserHomeUri(''), true)
  assert.equal(plugin.isBrowserHomeUri('home'), true)
  assert.equal(plugin.isBrowserHomeUri(`metaapp://${PIN}`), false)
})

test('bot_browser_open_uri accepts public https and pinid hrefs', async () => {
  const { agent, tools } = fakeAgent()
  const hub = fakeHub({ open: false, tabs: [] }, async () => ({ requestId: 'x', ok: false }))
  for (const definition of plugin.buildBrowserToolDefinitions({
    slug: 'alice',
    hub,
    cache: plugin.createBrowserSourceCache(),
    hostAgent: agent,
    run: async () => ({ ok: true, state: 'success', data: {} }),
  })) {
    agent.ctx.tools.register(definition)
  }
  const open = tools.find((tool) => tool.name === 'bot_browser_open_uri')
  await open.execute({ uri: `https://openagentinternet.org/browser/metaapp/${PIN}` }, {})
  assert.deepEqual(hub.opens[0], { uri: `metaapp://${PIN}`, source: 'host' })
  await open.execute({ uri: `pinid://${PIN}` }, {})
  assert.deepEqual(hub.opens[1], { uri: `pin://${PIN}`, source: 'host' })
})

test('bot_browser_fork_current_app asks the live iframe when snapshot tabs are empty', async () => {
  const home = await mkdtemp(join(tmpdir(), 'oac-dsh-fork-'))
  const previousHome = process.env.HOME
  const previousLocal = process.env.OAC_DSH_NO_LOCAL_READ
  process.env.HOME = home
  process.env.OAC_DSH_NO_LOCAL_READ = '1'
  const commands = []
  const cli = []
  try {
    const { agent, tools } = fakeAgent()
    const hub = fakeHub({ open: true, tabs: [] }, async (command) => {
      commands.push(command)
      return {
        requestId: 'x',
        ok: true,
        action: 'get-tab-info',
        info: {
          id: 1,
          uri: `metaapp://${PIN}`,
          title: '番茄钟',
          isActive: true,
          current: null,
        },
      }
    })
    for (const definition of plugin.buildBrowserToolDefinitions({
      slug: 'alice',
      hub,
      cache: plugin.createBrowserSourceCache(),
      hostAgent: agent,
      run: async (args) => {
        cli.push(args)
        return {
          ok: true,
          state: 'success',
          data: { dir: join(home, 'fork'), indexFile: 'index.html', title: '番茄钟' },
        }
      },
    })) {
      agent.ctx.tools.register(definition)
    }
    const text = await tools.find((tool) => tool.name === 'bot_browser_fork_current_app').execute({}, {})
    assert.deepEqual(commands[0], { action: 'get-tab-info' })
    assert.equal(cli[0][1], 'source')
    assert.equal(cli[0][cli[0].indexOf('--pin-id') + 1], PIN)
    assert.match(text, /READ the files/)
    assert.match(text, /Do not use Bash/)
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousLocal === undefined) delete process.env.OAC_DSH_NO_LOCAL_READ
    else process.env.OAC_DSH_NO_LOCAL_READ = previousLocal
  }
})

test('approvalOf and bindBrowserToolInstall survive Cordis uninjected approval access', () => {
  const tools = []
  const cordisLike = {
    get approval() {
      throw new Error('cannot get property "approval" without inject')
    },
    get(name) {
      throw new Error(`cannot get property "${name}" without inject`)
    },
    tools: { register(definition) { tools.push(definition); return () => {} } },
    systemPrompt: { section() { return () => {} } },
  }
  assert.equal(plugin.approvalOf(cordisLike), undefined)
  plugin.bindBrowserToolInstall(
    cordisLike,
    fakeHub({ open: false, tabs: [] }, async () => ({ requestId: 'x', ok: false })),
    plugin.createBrowserSourceCache(),
  )
  assert.equal(tools.some((tool) => tool.name === 'bot_browser_open_uri'), true)
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
