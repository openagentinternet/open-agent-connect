import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test, { mock } from 'node:test'

const plugin = await import('../lib/index.js')

const DUE_OK = {
  ok: true,
  state: 'success',
  data: {
    due: [{
      slug: 'alice',
      tasks: [{
        id: 't1',
        name: 'Nightly backup',
        prompt: 'Run the nightly backup and verify the checksums.',
        workingDirectory: '/srv/backups',
        channel: 'auto',
      }],
    }],
  },
}

function fakeRegistry(overrides = {}) {
  const calls = { created: [], followedUp: [], cancelled: [] }
  const registry = {
    calls,
    create: async (options) => {
      calls.created.push(options)
      // The DSH factory runs setup as part of create; mirror that so preset
      // mounts can be asserted after the tick.
      await options.setup?.({})
      const agent = {
        session: { snapshotEvents: () => [] },
        followup: (message) => { calls.followedUp.push(message) },
        whenIdle: () => Promise.resolve(),
        cancel: (reason) => { calls.cancelled.push(reason) },
        ...(overrides.agent ?? {}),
      }
      return { agent, dispose: async () => {} }
    },
  }
  return registry
}

function fakeDaemon(overrides = {}) {
  const calls = { heartbeat: [], due: [], claim: [], complete: [] }
  const defaultOk = () => ({ ok: true, state: 'success', data: {} })
  const claimed = () => ({ ok: true, state: 'success', data: { run: { id: 'r1' } } })
  // An override may return null (daemon unreachable), so distinguish
  // "no override" (undefined) from an explicit null verdict.
  const via = (key, fallback, ...args) => {
    const value = overrides[key]?.(...args)
    return value === undefined ? fallback() : value
  }
  return {
    calls,
    heartbeat: async (slug, host) => { calls.heartbeat.push([slug, host]); return via('heartbeat', defaultOk, slug, host) },
    due: async (from) => { calls.due.push(from); return via('due', defaultOk, from) },
    claim: async (from, id, executor) => { calls.claim.push([from, id, executor]); return via('claim', claimed, from, id, executor) },
    complete: async (from, runId, input) => { calls.complete.push([from, runId, input]); return via('complete', defaultOk, from, runId, input) },
  }
}

const MODEL_PAIR = () => ({ provider: 'deepseek', model: 'deepseek-v4-flash' })

async function runStub(args) {
  const verb = args.slice(0, 2).join(' ')
  if (verb === 'bot list') {
    return { ok: true, state: 'success', data: { profiles: [{ slug: 'alice' }] } }
  }
  return { ok: true, state: 'success', data: {} }
}

test('schedule tick heartbeats, claims due auto tasks, runs a DSH session, and settles success', async () => {
  const daemon = fakeDaemon({ due: () => DUE_OK })
  const registry = fakeRegistry()
  const mounted = []
  const outcomes = await plugin.runScheduleSchedulerTick({
    run: runStub,
    daemon,
    agents: registry,
    agentPresets: { mount: async (agentCtx, id) => { mounted.push(id) } },
    modelPair: MODEL_PAIR,
    cwd: '/host',
  })
  assert.deepEqual(daemon.calls.heartbeat, [['alice', 'dsh']])
  assert.deepEqual(daemon.calls.due, ['alice'])
  assert.deepEqual(daemon.calls.claim, [['alice', 't1', 'host']])
  assert.equal(daemon.calls.complete.length, 1)
  const [completeFrom, completeRunId, completeInput] = daemon.calls.complete[0]
  assert.equal(completeFrom, 'alice')
  assert.equal(completeRunId, 'r1')
  assert.equal('error' in completeInput, false)
  assert.ok(completeInput.durationMs >= 0)

  assert.equal(outcomes.length, 1)
  assert.deepEqual(outcomes[0], { slug: 'alice', claimed: 1, ran: 1, failed: 0 })

  // The session spawn mirrors local_worker_delegate: preset mount + model pair
  // + cwd from the task's workingDirectory.
  assert.equal(registry.calls.created.length, 1)
  const created = registry.calls.created[0]
  assert.deepEqual(created.meta, { agentPreset: 'oac-alice', cwd: '/srv/backups' })
  assert.deepEqual(created.agentOptions, { provider: 'deepseek', model: 'deepseek-v4-flash' })
  assert.equal(typeof created.setup, 'function')
  assert.deepEqual(mounted, ['oac-alice'])
  assert.equal(registry.calls.followedUp.length, 1)
  const message = registry.calls.followedUp[0]
  assert.equal(message.role, 'user')
  assert.equal(message.source.form, 'scheduled-task')
  assert.equal(message.content[0].text, '[Scheduled] Nightly backup: Run the nightly backup and verify the checksums.')
  assert.ok(message.id)
})

test('schedule tick settles a timed-out run as error and cancels the worker', async () => {
  const daemon = fakeDaemon({ due: () => DUE_OK })
  const registry = fakeRegistry({
    agent: { whenIdle: () => new Promise(() => {}) },
  })
  const outcomes = await plugin.runScheduleSchedulerTick({
    run: runStub,
    daemon,
    agents: registry,
    agentPresets: { mount: async () => {} },
    modelPair: MODEL_PAIR,
    runTimeoutMs: 50,
  })
  assert.equal(outcomes[0].failed, 1)
  assert.deepEqual(registry.calls.cancelled, [{ kind: 'timeout' }])
  const [, , completeInput] = daemon.calls.complete[0]
  assert.match(completeInput.error, /timed out after/)
})

test('schedule tick falls back to the CLI verbs when the daemon is unreachable', async () => {
  const daemon = fakeDaemon({
    heartbeat: () => null,
    due: () => null,
    claim: () => null,
    complete: () => null,
  })
  const registry = fakeRegistry()
  const cli = []
  const run = async (args) => {
    cli.push(args)
    const verb = args.slice(0, 2).join(' ')
    if (verb === 'bot list') {
      return { ok: true, state: 'success', data: { profiles: [{ slug: 'alice' }] } }
    }
    if (verb === 'schedule due') {
      return DUE_OK
    }
    if (verb === 'schedule claim') {
      return { ok: true, state: 'success', data: { run: { id: 'r9' } } }
    }
    if (verb === 'schedule complete') {
      return { ok: true, state: 'success', data: {} }
    }
    return { ok: true, state: 'success', data: {} }
  }
  const outcomes = await plugin.runScheduleSchedulerTick({
    run,
    daemon,
    agents: registry,
    agentPresets: { mount: async () => {} },
    modelPair: MODEL_PAIR,
  })
  assert.equal(outcomes[0].ran, 1)
  const verbs = cli.map((args) => args.slice(0, 2).join(' '))
  assert.deepEqual(verbs, ['bot list', 'schedule due', 'schedule claim', 'schedule complete'])
  assert.deepEqual(cli[1], ['schedule', 'due', '--from', 'alice'])
  assert.deepEqual(cli[2], ['schedule', 'claim', '--id', 't1', '--from', 'alice', '--executor', 'host'])
  assert.equal(cli[3][0], 'schedule')
  assert.equal(cli[3][1], 'complete')
  assert.ok(cli[3].includes('--run-id'))
  assert.ok(cli[3].includes('r9'))
  assert.ok(cli[3].includes('--from'))
  assert.ok(cli[3].includes('alice'))
  assert.ok(cli[3].includes('--duration-ms'))
})

test('schedule tick leaves daemon-channel tasks to the daemon and only claims auto/host', async () => {
  const daemon = fakeDaemon({
    due: () => ({
      ok: true,
      state: 'success',
      data: {
        due: [{
          slug: 'alice',
          tasks: [
            { id: 't1', name: 'Auto', prompt: 'p', workingDirectory: '', channel: 'auto' },
            { id: 't2', name: 'Host', prompt: 'p', workingDirectory: '', channel: 'host' },
            { id: 't3', name: 'Daemon', prompt: 'p', workingDirectory: '', channel: 'daemon' },
          ],
        }],
      },
    }),
  })
  const registry = fakeRegistry()
  const outcomes = await plugin.runScheduleSchedulerTick({
    run: runStub,
    daemon,
    agents: registry,
    agentPresets: { mount: async () => {} },
    modelPair: MODEL_PAIR,
  })
  assert.equal(outcomes[0].claimed, 2)
  assert.equal(outcomes[0].ran, 2)
  assert.deepEqual(daemon.calls.claim.map((entry) => entry[1]), ['t1', 't2'])
  assert.equal(registry.calls.created.length, 2)
})

test('schedule tick skips tasks whose claim is already taken', async () => {
  const daemon = fakeDaemon({
    due: () => DUE_OK,
    claim: () => ({ ok: false, state: 'failed', code: 'already_running', message: 'already claimed' }),
  })
  const registry = fakeRegistry()
  const outcomes = await plugin.runScheduleSchedulerTick({
    run: runStub,
    daemon,
    agents: registry,
    agentPresets: { mount: async () => {} },
    modelPair: MODEL_PAIR,
  })
  assert.equal(outcomes[0].claimed, 0)
  assert.equal(outcomes[0].ran, 0)
  assert.equal(outcomes[0].failed, 0)
  assert.equal(outcomes[0].error, undefined)
  assert.equal(registry.calls.created.length, 0)
  assert.equal(daemon.calls.complete.length, 0)
})

test('schedule tick settles a turn that died with an error as error', async () => {
  const daemon = fakeDaemon({ due: () => DUE_OK })
  const registry = fakeRegistry({
    agent: {
      session: {
        snapshotEvents: () => [{
          type: 'turn/end',
          data: { reason: { kind: 'error', error: { message: 'no model available' } } },
        }],
      },
    },
  })
  const outcomes = await plugin.runScheduleSchedulerTick({
    run: runStub,
    daemon,
    agents: registry,
    agentPresets: { mount: async () => {} },
    modelPair: MODEL_PAIR,
  })
  assert.equal(outcomes[0].failed, 1)
  const [, , completeInput] = daemon.calls.complete[0]
  assert.equal(completeInput.error, 'no model available')
})

test('schedule tick settles as error when no LLM model route exists for the bot', async () => {
  const daemon = fakeDaemon({ due: () => DUE_OK })
  const registry = fakeRegistry()
  const outcomes = await plugin.runScheduleSchedulerTick({
    run: runStub,
    daemon,
    agents: registry,
    agentPresets: { mount: async () => {} },
    modelPair: () => null,
  })
  assert.equal(outcomes[0].failed, 1)
  assert.equal(registry.calls.created.length, 0)
  const [, , completeInput] = daemon.calls.complete[0]
  assert.match(completeInput.error, /No LLM model/)
})

test('applyScheduleScheduler runs a boot tick and reports outcomes', async (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  t.after(() => mock.timers.reset())
  const warnings = []
  const infos = []
  const daemon = fakeDaemon({ due: () => DUE_OK })
  const registry = fakeRegistry()
  const mounted = []
  let onTick
  const ticked = new Promise((resolve) => { onTick = resolve })
  const ctx = {
    logger: { warn: (message) => warnings.push(message), info: (message) => infos.push(message) },
    effect: (fn) => { fn() },
  }
  plugin.applyScheduleScheduler(ctx, {
    run: runStub,
    daemon,
    agents: registry,
    agentPresets: { mount: async (_agentCtx, id) => { mounted.push(id) } },
    modelPair: MODEL_PAIR,
    onTick,
  })
  mock.timers.tick(20_000) // fire the boot catch-up pass
  const outcomes = await ticked
  assert.equal(outcomes[0].slug, 'alice')
  assert.equal(outcomes[0].ran, 1)
  assert.deepEqual(mounted, ['oac-alice'])
  assert.deepEqual(warnings, [])
  assert.ok(infos.some((message) => message.includes('alice') && message.includes('ran 1')))
})

test('applyScheduleScheduler no-ops when the host cannot spawn sessions', () => {
  // No agents registry, no presets: nothing to tick, no throw.
  assert.doesNotThrow(() => plugin.applyScheduleScheduler({}, {}))
  assert.doesNotThrow(() => plugin.applyScheduleScheduler({ effect: () => {} }, { agents: { create: null } }))
})

test('daemon schedule transport posts/gets the documented routes', async (t) => {
  const requests = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, state: 'success', data: { echoed: body } }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const port = server.address().port
  const transport = plugin.createDaemonScheduleTransport(async () => `http://127.0.0.1:${port}`)

  await transport.heartbeat('alice', 'dsh')
  await transport.due('bob')
  await transport.claim('bob', 't1', 'host')
  await transport.complete('bob', 'r1', { error: 'boom', durationMs: 123 })

  assert.deepEqual(requests.map((entry) => entry.method), ['POST', 'GET', 'POST', 'POST'])
  assert.equal(requests[0].url, '/api/schedule/heartbeat')
  assert.deepEqual(JSON.parse(requests[0].body), { slug: 'alice', host: 'dsh' })
  assert.equal(requests[1].url, '/api/schedule/due?from=bob')
  assert.equal(requests[2].url, '/api/schedule/claim')
  assert.deepEqual(JSON.parse(requests[2].body), { from: 'bob', id: 't1', executor: 'host' })
  assert.equal(requests[3].url, '/api/schedule/complete')
  assert.deepEqual(JSON.parse(requests[3].body), { from: 'bob', runId: 'r1', error: 'boom', durationMs: 123 })
})

test('daemon schedule transport returns null on a missing daemon or a non-envelope body', async (t) => {
  const requests = []
  const server = createServer((req, res) => {
    requests.push(req.url)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"nope":true}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const port = server.address().port
  const transport = plugin.createDaemonScheduleTransport(async () => `http://127.0.0.1:${port}`)
  assert.equal(await transport.due('bob'), null)
  assert.equal(requests.length, 1)

  const offline = plugin.createDaemonScheduleTransport(async () => null)
  assert.equal(await offline.heartbeat('alice', 'dsh'), null)
  assert.equal(await offline.due('alice'), null)
  assert.equal(await offline.claim('alice', 't1', 'host'), null)
  assert.equal(await offline.complete('alice', 'r1', {}), null)
})
