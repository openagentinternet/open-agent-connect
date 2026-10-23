import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
// Repo-mandated tracked temp root helper (tests/helpers/tempRoots.mjs):
// any temp directory this file creates goes through it, and teardown is
// registered for success, failure, and timeouts. The tests below never
// touch a real ~/.dsh profile — the CLI bridge is faked, so no daemon,
// wallet, or chain write ever runs.
import { mkdtempTempRootSync } from '../../tests/helpers/tempRoots.mjs'

const plugin = await import('../lib/private-chat-tools.js')

function fakeHost(overrides = {}) {
  const tools = []
  return {
    tools,
    ctx: {
      tools: { register: (definition) => tools.push(definition) },
      logger: { warn: () => undefined },
      ...overrides,
    },
  }
}

function fakeRun(result) {
  const calls = []
  return {
    calls,
    run: async (args, options) => {
      // runMetabotWithPayloadFile deletes its temp payload on return, so the
      // payload must be captured synchronously here.
      const flagIndex = args.indexOf('--request-file')
      const payload = flagIndex >= 0
        ? JSON.parse(readFileSync(args[flagIndex + 1], 'utf8'))
        : undefined
      calls.push({ args, options, payload })
      return result ?? {
        ok: true,
        state: 'success',
        data: { pinId: 'pm1', txids: ['tx-a', 'tx-b'], totalCost: 571, network: 'mvc' },
      }
    },
  }
}

function allowApproval() {
  const asked = []
  let outcome = 'allowed-once'
  return {
    asked,
    setOutcome(value) { outcome = value },
    approval: {
      request: async (req) => { asked.push(req); return outcome },
      overrideOf: () => undefined,
    },
  }
}

test('send_private_chat registers on the global layer', () => {
  const host = fakeHost()
  plugin.bindPrivateChatToolInstall(host.ctx)
  assert.deepEqual(host.tools.map((tool) => tool.name), ['send_private_chat'])
})

test('description documents reply_pin, the owner gate, and host-side encryption', () => {
  const host = fakeHost()
  plugin.bindPrivateChatToolInstall(host.ctx)
  const tool = host.tools[0]
  assert.match(tool.description, /encrypted private MetaWeb message/)
  assert.match(tool.description, /ECDH\+AES/)
  assert.match(tool.description, /reply_pin/)
  assert.match(tool.description, /owner_confirmed: true/)
  assert.match(tool.description, /never invent a globalMetaId/)
  const properties = tool.parameters.properties
  assert.deepEqual(tool.parameters.required, ['to', 'content'])
  assert.equal(properties.reply_pin.type, 'string')
  assert.equal(properties.owner_confirmed.type, 'boolean')
})

test('missing to or content refuses before any approval or CLI call', async () => {
  const { asked, approval } = allowApproval()
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const [tool] = plugin.buildPrivateChatToolDefinitions({
    host: host.ctx, hostAgent: { ctx: host.ctx }, approval, run,
  })
  const noTo = await tool.execute({ content: 'hi' }, {})
  assert.match(noTo, /requires `to`/)
  const noContent = await tool.execute({ to: 'idq1abc' }, {})
  assert.match(noContent, /requires `content`/)
  assert.equal(asked.length, 0, 'validation failures never ask the owner')
  assert.equal(calls.length, 0, 'validation failures never spawn the CLI')
})

test('approved send bridges `chat private --from <slug>` with reply_pin mapped to replyPin', async () => {
  const { asked, approval } = allowApproval()
  const { run, calls } = fakeRun()
  const host = fakeHost({ agentPresets: { composedPreset: () => 'oac-alice' } })
  const [tool] = plugin.buildPrivateChatToolDefinitions({
    host: host.ctx, hostAgent: { ctx: host.ctx }, approval, run,
  })
  const ok = await tool.execute(
    { to: 'idq1peer', content: 'hello there', reply_pin: 'ab12cd' },
    {},
  )
  assert.match(ok, /Private message sent\./)
  assert.match(ok, /- pinId: pm1/)
  assert.match(ok, /- txids: tx-a, tx-b/)
  assert.match(ok, /- cost: 571 sats/)
  assert.match(ok, /- network: mvc/)
  assert.match(ok, /- pin link: \[pin:\/\/pm1\]\(pin:\/\/pm1\)/)
  assert.equal(asked.length, 1, 'the send asks the owner exactly once')
  assert.equal(asked[0].toolName, 'send_private_chat')
  assert.match(asked[0].reason, /idq1peer/)
  assert.match(asked[0].reason, /hello there/)
  assert.deepEqual(calls[0].args.slice(0, 4), ['chat', 'private', '--from', 'alice'])
  assert.equal(calls[0].args[4], '--request-file', 'the payload rides the request-file flag')
  assert.deepEqual(calls[0].payload, { to: 'idq1peer', content: 'hello there', replyPin: 'ab12cd' })
})

test('declined approval never spawns the CLI write', async () => {
  const gate = allowApproval()
  gate.setOutcome('rejected')
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const [tool] = plugin.buildPrivateChatToolDefinitions({
    host: host.ctx, hostAgent: { ctx: host.ctx }, approval: gate.approval, run,
  })
  const denied = await tool.execute({ to: 'idq1peer', content: 'hello' }, {})
  assert.match(denied, /Send cancelled: the owner declined/)
  assert.match(denied, /Do not retry unless the owner explicitly asks again/)
  assert.equal(calls.length, 0, 'declined send never spawns the CLI write')
})

test('no approval surface: refused unless the owner confirmed in chat', async () => {
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const [tool] = plugin.buildPrivateChatToolDefinitions({
    host: host.ctx, hostAgent: { ctx: host.ctx }, run,
  })
  const refused = await tool.execute({ to: 'idq1peer', content: 'hello' }, {})
  assert.match(refused, /approval is not available/)
  assert.match(refused, /owner_confirmed: true/)
  assert.equal(calls.length, 0, 'refused send never spawns the CLI write')

  const confirmed = await tool.execute(
    { to: 'idq1peer', content: 'hello', owner_confirmed: true },
    {},
  )
  assert.match(confirmed, /Private message sent\./)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].payload, { to: 'idq1peer', content: 'hello' })
})

test('approval policy "never" skips the dialog and requires owner_confirmed', async () => {
  const approval = {
    request: async () => { throw new Error('the dialog must not spawn when prompts are disabled') },
    overrideOf: () => 'never',
  }
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const [tool] = plugin.buildPrivateChatToolDefinitions({
    host: host.ctx, hostAgent: { ctx: host.ctx }, approval, run,
  })
  const refused = await tool.execute({ to: 'idq1peer', content: 'hello' }, {})
  assert.match(refused, /owner_confirmed: true/)
  assert.equal(calls.length, 0)

  const confirmed = await tool.execute(
    { to: 'idq1peer', content: 'hello', owner_confirmed: true },
    {},
  )
  assert.match(confirmed, /Private message sent\./)
})

test('CLI failure and webhook warning surface in the tool output', async () => {
  const failing = fakeRun({ ok: false, state: 'failed', code: 'peer_not_found', message: 'No MetaID exists on chain for "idq1peer".' })
  const host = fakeHost()
  const [tool] = plugin.buildPrivateChatToolDefinitions({
    host: host.ctx, hostAgent: { ctx: host.ctx }, run: failing.run,
  })
  const refused = await tool.execute(
    { to: 'idq1peer', content: 'hello', owner_confirmed: true },
    {},
  )
  assert.match(refused, /Private message send failed: No MetaID exists on chain/)

  const warning = fakeRun({
    ok: true, state: 'success',
    data: { pinId: 'pm2', txids: [], totalCost: null, network: 'mvc', webhookWarning: 'no routine webhook' },
  })
  const [tool2] = plugin.buildPrivateChatToolDefinitions({
    host: host.ctx, hostAgent: { ctx: host.ctx }, run: warning.run,
  })
  const warned = await tool2.execute(
    { to: 'idq1peer', content: 'hello', owner_confirmed: true },
    {},
  )
  assert.match(warned, /NOTICE: no routine webhook/)
  assert.doesNotMatch(warned, /- cost:/, 'null cost is omitted, not printed as null')
})

test('filesystem hygiene: payload temp files self-clean and nothing else is written', async () => {
  // Tracked temp root: must stay empty — the whole send path (validation,
  // gate, bridge) writes nothing but the self-cleaning request payload that
  // runMetabotWithPayloadFile creates under os.tmpdir and removes in its
  // finally. Nothing here touches a real profile such as ~/.dsh.
  // The payload dirs asserted below are derived from this test's own recorded
  // CLI call args (dirname of each --request-file path), never by scanning
  // global os.tmpdir(): node --test runs files as concurrent processes, so
  // another file's in-flight oac-dsh-payload-* dir would leak into a global
  // before/after snapshot diff and flake the suite (merge regression §5).
  const root = mkdtempTempRootSync('pchat-hygiene-')
  const { approval } = allowApproval()
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const [tool] = plugin.buildPrivateChatToolDefinitions({
    host: host.ctx, hostAgent: { ctx: host.ctx }, approval, run,
  })
  for (let i = 0; i < 3; i += 1) {
    const ok = await tool.execute({ to: 'idq1peer', content: `msg ${i}` }, {})
    assert.match(ok, /Private message sent\./)
  }
  assert.equal(calls.length, 3)
  const payloadDirs = calls.map((call) => {
    const flagIndex = call.args.indexOf('--request-file')
    assert.ok(flagIndex >= 0, 'every send carries its payload on --request-file')
    return dirname(call.args[flagIndex + 1])
  })
  assert.equal(new Set(payloadDirs).size, 3, 'each send runs in its own payload temp dir')
  for (const dir of payloadDirs) {
    assert.match(basename(dir), /^oac-dsh-payload-/, 'the request file lives in a payload temp dir')
    assert.equal(existsSync(dir), false, `payload temp dir must be removed after the run: ${dir}`)
  }
  assert.deepEqual(readdirSync(root), [], 'the send path writes nothing into the temp root')
})
