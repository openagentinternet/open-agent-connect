process.env.OAC_DSH_NO_LOCAL_READ = '1'

import assert from 'node:assert/strict'
import test from 'node:test'

const { applyMcpServerRegistration, MCP_SERVER_NAME, MCP_SESSION_NAME } = await import('../lib/index.js')

/** Fake host context: records effects/injects so tests drive and dispose them. */
function harness() {
  const events = []
  const cleanups = []
  const injected = []
  let injectCallback = null
  const ctx = {
    logger: { warn: () => {} },
    effect(fn, label) {
      cleanups.push({ dispose: fn(), label })
    },
    inject(services, callback) {
      injected.push({ services, callback })
      injectCallback = callback
      return () => {}
    },
  }
  return {
    ctx,
    events,
    cleanups,
    injected,
    /** Simulate the host mounting the manager: fire the pending inject. */
    fireInject(manager) {
      injectCallback({ mcpManager: manager })
    },
  }
}

const cliResolution = () => ({
  cliPath: '/cli/dist/cli/main.js',
  oacPath: null,
  nodePath: '/opt/node/bin/node',
  nodeVersion: '24.13.1',
})

test('mcp register: registers the metabot mcp stdio server under the oac name', () => {
  const h = harness()
  const registered = []
  applyMcpServerRegistration(h.ctx, {
    resolve: cliResolution,
    onEvent: (event) => h.events.push(event),
  })
  assert.equal(h.injected.length, 1, 'one pending inject')
  assert.deepEqual(h.injected[0].services, 'mcpManager')
  assert.equal(registered.length, 0, 'nothing registered before the host mounts the manager')
  h.fireInject({ register: (name, entry) => { registered.push({ name, entry }); return () => {} } })
  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, 'oac')
  assert.equal(registered[0].entry.transport, 'stdio')
  assert.equal(registered[0].entry.command, '/opt/node/bin/node')
  assert.deepEqual(registered[0].entry.args, ['/cli/dist/cli/main.js', 'mcp', '--name', 'dsh'])
  assert.equal(registered[0].entry.toolCallTimeoutMs, 120_000, 'check_inbox long-polls need headroom')
  assert.deepEqual(h.events, [{
    kind: 'registered',
    server: 'oac',
    command: '/opt/node/bin/node /cli/dist/cli/main.js mcp',
  }])
})

test('mcp register: skips cleanly when the CLI is unresolvable', () => {
  const h = harness()
  applyMcpServerRegistration(h.ctx, {
    resolve: () => { throw new Error('metabot CLI not found') },
    onEvent: (event) => h.events.push(event),
  })
  h.fireInject({ register: () => { throw new Error('must not register') } })
  assert.deepEqual(h.events, [{ kind: 'skipped', reason: 'metabot CLI not found' }])
})

test('mcp register: skips when the scope lacks a usable manager', () => {
  const h = harness()
  applyMcpServerRegistration(h.ctx, { resolve: cliResolution, onEvent: (event) => h.events.push(event) })
  h.fireInject(undefined)
  h.fireInject({})
  assert.deepEqual(h.events.map((event) => event.kind), ['skipped', 'skipped'])
  assert.match(h.events[0].reason, /mcpManager/)
})

test('mcp register: a refused registration is reported and does not crash', () => {
  const h = harness()
  applyMcpServerRegistration(h.ctx, { resolve: cliResolution, onEvent: (event) => h.events.push(event) })
  h.fireInject({
    register: () => { throw new Error('servers.oac: a plugin already registers this server name — rename the entry key') },
  })
  assert.equal(h.events.length, 1)
  assert.equal(h.events[0].kind, 'register_failed')
  assert.match(h.events[0].error, /already registers/)
})

test('mcp register: a late second inject callback registers at most once', () => {
  const h = harness()
  const registered = []
  applyMcpServerRegistration(h.ctx, { resolve: cliResolution })
  h.fireInject({ register: (name) => { registered.push(name); return () => {} } })
  h.fireInject({ register: (name) => { registered.push(name); return () => {} } })
  assert.deepEqual(registered, ['oac'])
})

test('mcp register: dispose stops the inject and unregisters the server', () => {
  const h = harness()
  let unregisterCalls = 0
  applyMcpServerRegistration(h.ctx, { resolve: cliResolution })
  h.fireInject({ register: () => () => { unregisterCalls += 1 } })
  const effect = h.cleanups[0]
  assert.ok(effect, 'the registration mounts through ctx.effect')
  effect.dispose()
  // A late inject after dispose must not register again.
  h.fireInject({ register: () => { unregisterCalls += 99; return () => {} } })
  assert.equal(unregisterCalls, 1, 'exactly one unregister, no late registration')
})

test('mcp register: a never-fired inject disposes safely', () => {
  const h = harness()
  applyMcpServerRegistration(h.ctx, { resolve: cliResolution })
  const effect = h.cleanups[0]
  assert.doesNotThrow(() => effect.dispose())
})

test('mcp register: defaults are the oac server and the dsh identity', () => {
  assert.equal(MCP_SERVER_NAME, 'oac')
  assert.equal(MCP_SESSION_NAME, 'dsh')
})
