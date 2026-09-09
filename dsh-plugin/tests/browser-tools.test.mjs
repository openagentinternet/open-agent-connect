import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const plugin = await import('../lib/index.js')

const PIN = `${'d'.repeat(64)}i0`
/** A pin never published by any test in this file — the module-level publish
 * ledger would otherwise vouch for PIN (published in earlier tests). */
const FOREIGN_PIN = `${'f'.repeat(64)}i0`

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

test('search_online_bots formats CLI presence as markdown links and publishes the catalog', async () => {
  const { agent, tools } = fakeAgent()
  const catalogs = []
  const hub = fakeHub({ open: false, tabs: [] }, async () => ({ requestId: 'x', ok: false }))
  hub.publishCatalog = (apps) => catalogs.push(apps)
  for (const definition of plugin.buildBrowserToolDefinitions({
    slug: 'alice',
    hub,
    cache: plugin.createBrowserSourceCache(),
    hostAgent: agent,
    run: async (args) => {
      assert.deepEqual(args, ['network', 'bots', '--online', '--limit', '20'])
      return {
        ok: true,
        state: 'success',
        data: {
          bots: [{ globalMetaId: 'idq1alice', name: 'TestBot', goal: 'help users', lastSeenAgoSeconds: 12 }],
        },
      }
    },
  })) {
    agent.ctx.tools.register(definition)
  }
  const text = await tools.find((tool) => tool.name === 'search_online_bots').execute({}, {})
  assert.match(text, /\[TestBot\]\(metaid:\/\/idq1alice\)/)
  assert.match(text, /help users/)
  assert.match(text, /last seen: 12s/)
  assert.equal(catalogs.length, 1)
  assert.deepEqual(catalogs[0], [{ title: 'TestBot', href: 'metaid://idq1alice', uri: 'metaid://idq1alice' }])
})

test('search_online_bots reports empty presence honestly and publishes no catalog', async () => {
  const { agent, tools } = fakeAgent()
  const catalogs = []
  const hub = fakeHub({ open: false, tabs: [] }, async () => ({ requestId: 'x', ok: false }))
  hub.publishCatalog = (apps) => catalogs.push(apps)
  for (const definition of plugin.buildBrowserToolDefinitions({
    slug: 'alice',
    hub,
    cache: plugin.createBrowserSourceCache(),
    hostAgent: agent,
    run: async () => ({ ok: true, state: 'success', data: { bots: [] } }),
  })) {
    agent.ctx.tools.register(definition)
  }
  const text = await tools.find((tool) => tool.name === 'search_online_bots').execute({}, {})
  assert.match(text, /No online Bots/)
  assert.equal(catalogs.length, 0)
})

test('bot_browser_publish_app under policy never requires a same-session preview', async () => {
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
  const publish = tools.find((tool) => tool.name === 'bot_browser_publish_app')

  // Without a preview record in this session: refused, no CLI spawn.
  const refused = await publish.execute({ dir, title: 'Test App' }, { agent })
  assert.match(refused, /was not previewed here/)
  assert.equal(calls.length, 0)

  // Preview in the same session unlocks the publish (policy never: no dialog).
  // The flow dry-runs the project WITHOUT --confirm first, then writes with it.
  const preview = tools.find((tool) => tool.name === 'bot_browser_preview_local')
  await preview.execute({ path: dir }, { agent })
  const text = await publish.execute({ dir, title: 'Test App' }, { agent })
  assert.equal(asked.length, 0)
  assert.equal(calls.length, 2)
  assert.match(calls[0].join(' '), /publish-project/)
  assert.ok(!calls[0].includes('--confirm'))
  assert.match(calls[1].join(' '), /publish-project/)
  assert.ok(calls[1].includes('--confirm'))
  assert.match(text, new RegExp(`metaapp://${PIN}`))

  // A DIFFERENT directory still needs its own preview.
  const otherDir = await mkdtemp(join(tmpdir(), 'oac-dsh-publish-never2-'))
  await writeFile(join(otherDir, 'APP.md'), 'Other.\n', 'utf8')
  await writeFile(join(otherDir, 'index.html'), '<html></html>\n', 'utf8')
  const refused2 = await publish.execute({ dir: otherDir, title: 'Other' }, { agent })
  assert.match(refused2, /was not previewed here/)
  assert.equal(calls.length, 2)
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
  // Only the no-confirm preflight ran; the chain write was never attempted.
  assert.equal(calls.length, 1)
  assert.ok(!calls[0].includes('--confirm'))
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

test('bot_browser_publish_app shows entry file, package size, and fork provenance in the approval dialog', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oac-dsh-publish-reason-'))
  await writeFile(join(dir, 'APP.md'), 'A test app.\n', 'utf8')
  await writeFile(join(dir, 'index.html'), '<html></html>\n', 'utf8')
  await writeFile(join(dir, '.metaapp-fork.json'), JSON.stringify({ sourcePinId: PIN, sourceUri: `metaapp://${PIN}` }), 'utf8')
  const calls = []
  const asked = []
  const { agent, tools } = fakeAgent()
  for (const definition of plugin.buildBrowserToolDefinitions({
    slug: 'alice',
    hub: fakeHub({ open: false, tabs: [] }, async () => ({ requestId: 'x', ok: false })),
    cache: plugin.createBrowserSourceCache(),
    hostAgent: agent,
    approval: {
      async request(req) {
        asked.push(req)
        return 'allowed-once'
      },
    },
    run: async (args) => {
      calls.push(args)
      if (!args.includes('--confirm')) {
        return {
          ok: true,
          state: 'awaiting_confirmation',
          data: {
            plan: { indexFile: 'index.html' },
            manifest: { title: 'Test App' },
            archivePreview: { bytes: 4321, sha256: 'deadbeef', entries: ['index.html'] },
          },
        }
      }
      return { ok: true, state: 'success', data: { firstPinId: PIN, metaappUri: `metaapp://${PIN}`, totalCost: 7 } }
    },
  })) {
    agent.ctx.tools.register(definition)
  }
  const text = await tools.find((tool) => tool.name === 'bot_browser_publish_app').execute(
    { dir, title: 'Test App' },
    { agent },
  )
  assert.equal(asked.length, 1)
  assert.match(asked[0].reason, /Entry file: index\.html/)
  assert.match(asked[0].reason, /Package size: 4321 bytes/)
  assert.match(asked[0].reason, new RegExp(`Forked from: metaapp://${PIN}`))
  assert.match(asked[0].reason, /APP\.md: present/)
  assert.match(text, /Cost: 7 sats/)
  assert.equal(calls.length, 2)
  assert.ok(calls[1].includes('--confirm'))
})

test('bot_browser_publish_app surfaces project inspection failures before any approval dialog', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oac-dsh-publish-broken-'))
  await writeFile(join(dir, 'APP.md'), 'A test app.\n', 'utf8')
  const asked = []
  const { agent, tools } = fakeAgent()
  for (const definition of plugin.buildBrowserToolDefinitions({
    slug: 'alice',
    hub: fakeHub({ open: false, tabs: [] }, async () => ({ requestId: 'x', ok: false })),
    cache: plugin.createBrowserSourceCache(),
    hostAgent: agent,
    approval: {
      async request(req) {
        asked.push(req)
        return 'allowed-once'
      },
    },
    run: async () => ({ ok: false, state: 'manual_action_required', code: 'metaapp_artifact_missing', message: 'The project does not have a detected runtime artifact directory.' }),
  })) {
    agent.ctx.tools.register(definition)
  }
  await assert.rejects(
    () => tools.find((tool) => tool.name === 'bot_browser_publish_app').execute({ dir, title: 'Broken' }, { agent }),
    /runtime artifact directory/,
  )
  assert.equal(asked.length, 0)
})

const UPDATE_PIN = `${'e'.repeat(64)}i0`

function updateToolRun(calls, { owned = true, listFails = false } = {}) {
  return async (args) => {
    calls.push(args)
    if (args[1] === 'list') {
      if (listFails) return { ok: false, state: 'failed', code: 'metaapp_list_failed', message: 'index unreachable' }
      return {
        ok: true,
        state: 'success',
        data: { records: owned ? [{ pinId: PIN, firstPinId: PIN, title: 'My App' }] : [], nextCursor: '' },
      }
    }
    if (!args.includes('--confirm')) {
      return {
        ok: true,
        state: 'awaiting_confirmation',
        data: { plan: { indexFile: 'index.html' }, manifest: { title: 'My App' }, archivePreview: { bytes: 2048 } },
      }
    }
    return { ok: true, state: 'success', data: { pinId: UPDATE_PIN, firstPinId: PIN, totalCost: 9 } }
  }
}

function registerUpdateTools({ run, approval, agentSession } = {}) {
  const { agent, tools } = fakeAgent()
  if (agentSession) agent.session = agentSession
  for (const definition of plugin.buildBrowserToolDefinitions({
    slug: 'alice',
    hub: fakeHub({ open: false, tabs: [] }, async () => ({ requestId: 'x', ok: false })),
    cache: plugin.createBrowserSourceCache(),
    hostAgent: agent,
    approval: approval ?? { async request() { return 'allowed-once' } },
    run,
  })) {
    agent.ctx.tools.register(definition)
  }
  return { agent, tools }
}

test('bot_browser_update_app refuses to update without APP.md', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oac-dsh-update-empty-'))
  const calls = []
  const { agent, tools } = registerUpdateTools({ run: updateToolRun(calls) })
  await assert.rejects(
    () => tools.find((tool) => tool.name === 'bot_browser_update_app').execute({ dir, targetPinId: PIN }, { agent }),
    /APP\.md is required/,
  )
  assert.equal(calls.length, 0)
})

test('bot_browser_update_app needs a target when neither targetPinId nor a fork marker exists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oac-dsh-update-notarget-'))
  await writeFile(join(dir, 'APP.md'), 'A test app.\n', 'utf8')
  await writeFile(join(dir, 'index.html'), '<html></html>\n', 'utf8')
  const calls = []
  const { agent, tools } = registerUpdateTools({ run: updateToolRun(calls) })
  await assert.rejects(
    () => tools.find((tool) => tool.name === 'bot_browser_update_app').execute({ dir }, { agent }),
    /needs the target app/,
  )
  assert.equal(calls.length, 0)
})

test('bot_browser_update_app resolves the target from the fork marker and refuses apps the Bot does not own', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oac-dsh-update-notowned-'))
  await writeFile(join(dir, 'APP.md'), 'A test app.\n', 'utf8')
  await writeFile(join(dir, 'index.html'), '<html></html>\n', 'utf8')
  await writeFile(join(dir, '.metaapp-fork.json'), JSON.stringify({ sourcePinId: FOREIGN_PIN }), 'utf8')
  const calls = []
  const { agent, tools } = registerUpdateTools({ run: updateToolRun(calls, { owned: false }) })
  const update = tools.find((tool) => tool.name === 'bot_browser_update_app')
  const text = await update.execute({ dir }, { agent })
  assert.match(text, /not among this Bot's published apps/)
  assert.match(text, /index may lag/, 'the refusal distinguishes index lag from foreign ownership')
  assert.match(text, /bot_browser_publish_app/)
  // Only the ownership check ran — no preflight, no write.
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1], 'list')

  // A foreign pin passed explicitly is refused the same way.
  const dir2 = await mkdtemp(join(tmpdir(), 'oac-dsh-update-foreign-'))
  await writeFile(join(dir2, 'APP.md'), 'A test app.\n', 'utf8')
  await writeFile(join(dir2, 'index.html'), '<html></html>\n', 'utf8')
  const calls2 = []
  const second = registerUpdateTools({ run: updateToolRun(calls2, { owned: false }) })
  const refused = await second.tools.find((tool) => tool.name === 'bot_browser_update_app')
    .execute({ dir: dir2, targetPinId: FOREIGN_PIN }, { agent: second.agent })
  assert.match(refused, /not among this Bot's published apps/)
  assert.equal(calls2.length, 1)
})

test('bot_browser_update_app refuses while ownership is unverifiable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oac-dsh-update-unverifiable-'))
  await writeFile(join(dir, 'APP.md'), 'A test app.\n', 'utf8')
  await writeFile(join(dir, 'index.html'), '<html></html>\n', 'utf8')
  const calls = []
  const { agent, tools } = registerUpdateTools({ run: updateToolRun(calls, { listFails: true }) })
  await assert.rejects(
    () => tools.find((tool) => tool.name === 'bot_browser_update_app').execute({ dir, targetPinId: PIN }, { agent }),
    /Unable to verify that this Bot owns/,
  )
})

test('bot_browser_update_app cancels cleanly in the approval dialog', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oac-dsh-update-cancel-'))
  await writeFile(join(dir, 'APP.md'), 'A test app.\n', 'utf8')
  await writeFile(join(dir, 'index.html'), '<html></html>\n', 'utf8')
  const calls = []
  const asked = []
  const { agent, tools } = registerUpdateTools({
    run: updateToolRun(calls),
    approval: {
      async request(req) {
        asked.push(req)
        return 'rejected'
      },
    },
  })
  const text = await tools.find((tool) => tool.name === 'bot_browser_update_app').execute(
    { dir, targetPinId: PIN, title: 'My App' },
    { agent },
  )
  assert.match(text, /cancelled/)
  assert.match(text, /Do not retry/)
  assert.equal(asked.length, 1)
  assert.match(asked[0].reason, /new version of MetaApp "My App"/)
  assert.match(asked[0].reason, new RegExp(`Target app: metaapp://${PIN}`))
  assert.match(asked[0].reason, /Package size: 2048 bytes/)
  // list + preflight ran; the --confirm write did not.
  assert.equal(calls.length, 2)
  assert.ok(!calls.some((args) => args.includes('--confirm')))
})

test('bot_browser_update_app publishes a new version under the stable app URI', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oac-dsh-update-ok-'))
  await writeFile(join(dir, 'APP.md'), 'A test app.\n', 'utf8')
  await writeFile(join(dir, 'index.html'), '<html></html>\n', 'utf8')
  const calls = []
  const { agent, tools } = registerUpdateTools({
    run: updateToolRun(calls),
    agentSession: { events: [{ type: 'approval/policy', data: { policy: 'never' } }] },
  })
  // policy never: same-session preview is the gate.
  const update = tools.find((tool) => tool.name === 'bot_browser_update_app')
  const refused = await update.execute({ dir, targetPinId: PIN }, { agent })
  assert.match(refused, /was not previewed here/)
  await tools.find((tool) => tool.name === 'bot_browser_preview_local').execute({ path: dir }, { agent })
  const text = await update.execute({ dir, targetPinId: PIN }, { agent })
  assert.match(text, new RegExp(`Updated on-chain: metaapp://${PIN}`))
  assert.match(text, new RegExp(`new version pin ${UPDATE_PIN}`))
  assert.match(text, /Cost: 9 sats/)
  const confirm = calls.find((args) => args.includes('--confirm'))
  assert.ok(confirm)
  assert.deepEqual(confirm.slice(0, 4), ['metaapp', 'update-project', '--project-dir', dir])
  assert.ok(confirm.includes('--target-pin-id'))
  assert.ok(confirm.includes(PIN))
})
// ---------------------------------------------------------------------------
// Smoke-test R2 fixes (docs/OAC-dsh-plugin-修复需求-2026-09-09)
// ---------------------------------------------------------------------------

const PUBLISH_R2_PIN = `${'a'.repeat(64)}i0`
const UPDATE_R2_PIN = `${'b'.repeat(64)}i0`

function publishToolSetup(calls, publishData) {
  const { agent, tools } = fakeAgent()
  for (const definition of plugin.buildBrowserToolDefinitions({
    slug: 'alice',
    hub: fakeHub({ open: false, tabs: [] }, async () => ({ requestId: 'x', ok: false })),
    cache: plugin.createBrowserSourceCache(),
    hostAgent: agent,
    approval: { async request() { return 'allowed-once' } },
    run: async (args) => {
      calls.push(args)
      if (!args.includes('--confirm')) {
        return {
          ok: true,
          state: 'awaiting_confirmation',
          data: { plan: { indexFile: 'index.html' }, manifest: { title: 'R2' }, archivePreview: { bytes: 128 } },
        }
      }
      return { ok: true, state: 'success', data: publishData }
    },
  })) {
    agent.ctx.tools.register(definition)
  }
  return { agent, tools }
}

test('publish -> immediate update bridges the MAN index lag via the publish ledger (FIX-1)', async () => {
  const publishCalls = []
  const published = publishToolSetup(publishCalls, {
    pinId: PUBLISH_R2_PIN,
    firstPinId: PUBLISH_R2_PIN,
    metaappUri: `metaapp://${PUBLISH_R2_PIN}`,
    chainWrite: { totalCost: 555 },
  })
  const dir = await mkdtemp(join(tmpdir(), 'oac-dsh-r2-publish-'))
  await writeFile(join(dir, 'APP.md'), 'R2.\n', 'utf8')
  await writeFile(join(dir, 'index.html'), '<html></html>\n', 'utf8')
  const publish = published.tools.find((tool) => tool.name === 'bot_browser_publish_app')
  const publishText = await publish.execute({ dir, title: 'R2' }, { agent: published.agent })
  assert.match(publishText, new RegExp(`metaapp://${PUBLISH_R2_PIN}`))
  assert.match(publishText, /Cost: 555 sats/, 'fee rides at data.chainWrite.totalCost (FIX-5)')

  // Same-minute update: the MAN owner list (metaapp list) is EMPTY for the new
  // app — the local publish ledger must vouch for it instead of refusing.
  const updateCalls = []
  const updateRun = async (args) => {
    updateCalls.push(args)
    if (args[1] === 'list') {
      return { ok: true, state: 'success', data: { records: [], nextCursor: '' } }
    }
    if (!args.includes('--confirm')) {
      return {
        ok: true,
        state: 'awaiting_confirmation',
        data: { plan: { indexFile: 'index.html' }, manifest: { title: 'R2' }, archivePreview: { bytes: 128 } },
      }
    }
    return { ok: true, state: 'success', data: { pinId: UPDATE_R2_PIN, firstPinId: PUBLISH_R2_PIN, chainWrite: { totalCost: 42 } } }
  }
  const { agent, tools } = registerUpdateTools({ run: updateRun })
  const updateDir = await mkdtemp(join(tmpdir(), 'oac-dsh-r2-update-'))
  await writeFile(join(updateDir, 'APP.md'), 'R2.\n', 'utf8')
  await writeFile(join(updateDir, 'index.html'), '<html></html>\n', 'utf8')
  const text = await tools.find((tool) => tool.name === 'bot_browser_update_app')
    .execute({ dir: updateDir, targetPinId: PUBLISH_R2_PIN }, { agent })
  assert.match(text, /Updated on-chain/, 'the ledger vouches for the just-published pin')
  assert.match(text, /Cost: 42 sats/)
  assert.ok(updateCalls.some((args) => args.includes('--confirm') && args.includes(PUBLISH_R2_PIN)))
})

test('publish with no fee figure reports Cost: unavailable instead of silence (FIX-5)', async () => {
  const calls = []
  const { agent, tools } = publishToolSetup(calls, {
    pinId: `${'c'.repeat(64)}i0`,
    firstPinId: `${'c'.repeat(64)}i0`,
  })
  const dir = await mkdtemp(join(tmpdir(), 'oac-dsh-r2-nocost-'))
  await writeFile(join(dir, 'APP.md'), 'R2.\n', 'utf8')
  await writeFile(join(dir, 'index.html'), '<html></html>\n', 'utf8')
  const text = await tools.find((tool) => tool.name === 'bot_browser_publish_app')
    .execute({ dir, title: 'R2' }, { agent })
  assert.match(text, /Cost: unavailable/)
})

test('preview credential survives agent object replacement (FIX-2)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oac-dsh-r2-preview-'))
  await writeFile(join(dir, 'APP.md'), 'R2.\n', 'utf8')
  await writeFile(join(dir, 'index.html'), '<html></html>\n', 'utf8')
  const calls = []
  const { agent, tools } = registerUpdateTools({
    run: updateToolRun(calls),
    agentSession: { events: [{ type: 'approval/policy', data: { policy: 'never' } }] },
  })
  // The host replaced the agent object between the preview and the publish
  // (sidebar reload / recompose): different reference, same acting Bot.
  const replacementAgent = { ...agent, ctx: agent.ctx, session: agent.session }
  const preview = tools.find((tool) => tool.name === 'bot_browser_preview_local')
  await preview.execute({ path: dir }, { agent })
  const update = tools.find((tool) => tool.name === 'bot_browser_update_app')
  const text = await update.execute({ dir, targetPinId: PIN }, { agent: replacementAgent })
  assert.match(text, /Updated on-chain/, 'the slug-keyed preview record outlives the agent object')
  const confirm = calls.find((args) => args.includes('--confirm'))
  assert.ok(confirm)
})

test('open_uri waits for the navigation commit before reporting tabs (FIX-3)', async () => {
  // The command result carries a pre-navigation tab list; the live client
  // state fills the URI in shortly after. The returned text must show the
  // requested URI (or explicitly say navigation is in progress), never
  // "(untitled) — (no uri)" for the freshly opened tab.
  let reads = 0
  const hub = {
    getSnapshot: () => {
      reads += 1
      return reads < 3
        ? { open: true, tabs: [{ id: 2, uri: null, title: null, isActive: true }] }
        : { open: true, tabs: [{ id: 2, uri: `metaapp://${PIN}`, title: 'R2 App', isActive: true }] }
    },
    clientCount: () => 1,
    open: () => ({ uri: '', localUiUrl: 'x' }),
    publishCatalog() {},
    requestCommand: async () => ({
      requestId: 'x',
      ok: true,
      action: 'open-tab',
      tabs: [{ id: 2, uri: null, title: null, isActive: true }],
    }),
  }
  const { agent, tools } = fakeAgent()
  for (const definition of plugin.buildBrowserToolDefinitions({
    slug: 'alice',
    hub,
    cache: plugin.createBrowserSourceCache(),
    hostAgent: agent,
    run: async () => ({ ok: true, state: 'success', data: {} }),
  })) {
    agent.ctx.tools.register(definition)
  }
  const text = await tools.find((tool) => tool.name === 'bot_browser_open_uri')
    .execute({ uri: `metaapp://${PIN}` }, { agent })
  assert.match(text, new RegExp(`metaapp://${PIN}`))
  assert.match(text, /R2 App/)
  assert.doesNotMatch(text, /\(no uri\)/)
})

test('open_uri reports navigation-in-progress when the commit never lands (FIX-3)', async () => {
  const hub = {
    getSnapshot: () => ({ open: true, tabs: [{ id: 2, uri: null, title: null, isActive: true }] }),
    clientCount: () => 1,
    open: () => ({ uri: '', localUiUrl: 'x' }),
    publishCatalog() {},
    requestCommand: async () => ({
      requestId: 'x',
      ok: true,
      action: 'open-tab',
      tabs: [{ id: 2, uri: null, title: null, isActive: true }],
    }),
  }
  const { agent, tools } = fakeAgent()
  for (const definition of plugin.buildBrowserToolDefinitions({
    slug: 'alice',
    hub,
    cache: plugin.createBrowserSourceCache(),
    hostAgent: agent,
    run: async () => ({ ok: true, state: 'success', data: {} }),
  })) {
    agent.ctx.tools.register(definition)
  }
  const text = await tools.find((tool) => tool.name === 'bot_browser_open_uri')
    .execute({ uri: `metaapp://${PIN}` }, { agent })
  assert.match(text, /navigation in progress/)
  assert.match(text, /Do not open it again/)
})
