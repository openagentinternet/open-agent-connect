import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const plugin = await import('../lib/omni-cast-tools.js')

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
      return result ?? { ok: true, state: 'success', data: { pinId: 'cast1', txids: ['t9'], totalCost: 700 } }
    },
  }
}

function makeApproval() {
  const asked = []
  let approve = true
  return {
    asked,
    setAppro(value) { approve = value },
    approval: {
      request: async (req) => {
        asked.push(req)
        return approve ? 'allowed-once' : 'rejected'
      },
      overrideOf: () => undefined,
    },
  }
}

test('omni_cast registers on the global layer', () => {
  const host = fakeHost()
  plugin.bindOmniCastToolInstall(host.ctx)
  assert.deepEqual(host.tools.map((tool) => tool.name), ['omni_cast'])
})

test('path and payload XOR are enforced before any CLI call', async () => {
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const [tool] = plugin.buildOmniCastToolDefinitions({ host: host.ctx, hostAgent: { ctx: host.ctx }, run })

  const noPath = await tool.execute({ payload: 'x' }, {})
  assert.match(noPath, /requires `path`/)
  const both = await tool.execute({ path: '/protocols/paylike', payload: 'x', payload_file: '/tmp/a.png' }, {})
  assert.match(both, /not both/)
  const neither = await tool.execute({ path: '/protocols/paylike' }, {})
  assert.match(neither, /exactly one of `payload` or `payload_file`/)
  const badNetwork = await tool.execute({ path: '/protocols/paylike', payload: 'x', network: 'eth' }, {})
  assert.match(badNetwork, /Invalid network "eth"/)
  const groupChat = await tool.execute({ path: '/protocols/simplegroupchat', payload: '{"groupId":"g1","content":"hi"}' }, {})
  assert.match(groupChat, /does not support \/protocols\/simplegroupchat/)
  assert.equal(calls.length, 0)
})

test('inline JSON payload is parsed and re-serialized through chain write', async () => {
  const { run, calls } = fakeRun()
  const host = fakeHost({ agentPresets: { composedPreset: () => 'oac-alice' } })
  const [tool] = plugin.buildOmniCastToolDefinitions({ host: host.ctx, hostAgent: { ctx: host.ctx }, run })

  const ok = await tool.execute({
    path: '/protocols/paylike',
    payload: '{ "isLike": 1,  "likeTo": "p9" }',
  }, {})
  assert.match(ok, /^Pin cast on-chain\./)
  assert.match(ok, /- pinId: cast1/)
  assert.match(ok, /- txid: t9/)
  assert.match(ok, /- cost: 700 sats/)
  assert.match(ok, /- view link: \[pin:\/\/cast1\]\(pin:\/\/cast1\)/)
  assert.deepEqual(calls[0].args.slice(0, 4), ['chain', 'write', '--from', 'alice'])
  assert.equal(calls[0].payload.path, '/protocols/paylike')
  assert.equal(calls[0].payload.operation, 'create')
  assert.equal(calls[0].payload.encryption, '0')
  assert.equal(calls[0].payload.version, '1.0')
  assert.equal(calls[0].payload.contentType, 'application/json')
  assert.equal(calls[0].payload.payload, '{"isLike":1,"likeTo":"p9"}', 'JSON payload is canonicalized')
  assert.equal(calls[0].payload.encoding, undefined, 'utf-8 default omits encoding')
})

test('invalid inline JSON fails before the CLI call', async () => {
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const [tool] = plugin.buildOmniCastToolDefinitions({ host: host.ctx, hostAgent: { ctx: host.ctx }, run })
  const err = await tool.execute({ path: '/protocols/paylike', payload: '{not json' }, {})
  assert.match(err, /payload is not valid JSON/)
  assert.equal(calls.length, 0)
})

test('binary content types auto-detect base64 without an explicit encoding', async () => {
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const [tool] = plugin.buildOmniCastToolDefinitions({ host: host.ctx, hostAgent: { ctx: host.ctx }, run })
  await tool.execute({ path: '/protocols/paylike', payload: 'AAAA', content_type: 'image/png' }, {})
  assert.equal(calls[0].payload.encoding, 'base64')
  assert.equal(calls[0].payload.contentType, 'image/png')

  await tool.execute({ path: '/protocols/paylike', payload: 'plain text', content_type: 'text/plain' }, {})
  assert.equal(calls[1].payload.encoding, undefined, 'text content stays utf-8')
})

test('payload_file in the workspace reads bytes base64 with inferred content type', async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'oc-ws-'))
  const inside = path.join(workspace, 'badge.png')
  writeFileSync(inside, Buffer.from('png bytes'))

  const { run, calls } = fakeRun()
  const { asked, approval } = makeApproval()
  const host = fakeHost()
  const [tool] = plugin.buildOmniCastToolDefinitions({
    host: host.ctx,
    hostAgent: { ctx: host.ctx },
    approval: approval,
    run,
    getWorkspaceDir: () => workspace,
  })

  const ok = await tool.execute({ path: '/file', payload_file: inside }, {})
  assert.match(ok, /^Pin cast on-chain\./)
  assert.equal(asked.length, 0, 'in-workspace files never ask')
  assert.equal(calls[0].payload.payload, Buffer.from('png bytes').toString('base64'))
  assert.equal(calls[0].payload.encoding, 'base64')
  assert.equal(calls[0].payload.contentType, 'image/png', 'content type inferred from extension')
  assert.equal(calls[0].payload.path, '/file')
})

test('payload_file outside the workspace requires owner approval; denial stops the cast', async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'oc-ws-'))
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'oc-out-'))
  const outside = path.join(outsideDir, 'secret.zip')
  writeFileSync(outside, Buffer.from('zip'))

  const { run, calls } = fakeRun()
  const { asked, approval, setAppro } = makeApproval()
  const host = fakeHost()
  const [tool] = plugin.buildOmniCastToolDefinitions({
    host: host.ctx,
    hostAgent: { ctx: host.ctx },
    approval,
    run,
    getWorkspaceDir: () => workspace,
  })

  setAppro(false)
  const denied = await tool.execute({ path: '/file', payload_file: outside }, {})
  assert.match(denied, /Owner declined to publish a file outside the session workspace/)
  assert.equal(calls.length, 0)
  assert.equal(asked.length, 1)
  assert.match(asked[0].reason, /Publish this file's bytes on-chain/)

  setAppro(true)
  const ok = await tool.execute({ path: '/file', payload_file: outside }, {})
  assert.match(ok, /^Pin cast on-chain\./)
  assert.equal(calls[0].payload.encoding, 'base64')
  assert.equal(calls[0].payload.contentType, 'application/zip')
})

test('payload_file rejects relative paths and missing files without a CLI call', async () => {
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const [tool] = plugin.buildOmniCastToolDefinitions({ host: host.ctx, hostAgent: { ctx: host.ctx }, run })

  const relative = await tool.execute({ path: '/file', payload_file: 'relative/x.png' }, {})
  assert.match(relative, /ABSOLUTE local path/)
  const missing = await tool.execute({ path: '/file', payload_file: '/tmp/definitely-missing-oc-cast.png' }, {})
  assert.match(missing, /payload file not found/)
  assert.equal(calls.length, 0)
})

test('operation modify/revoke passes through and CLI failures surface the daemon message', async () => {
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const [tool] = plugin.buildOmniCastToolDefinitions({ host: host.ctx, hostAgent: { ctx: host.ctx }, run })
  await tool.execute({ path: '/protocols/simplenote', payload: '{"v":2}', operation: 'modify', network: 'doge' }, {})
  assert.equal(calls[0].payload.operation, 'modify')
  assert.equal(calls[0].payload.network, 'doge')

  const failing = fakeRun({ ok: false, state: 'failed', code: 'chain_write_failed', message: 'Chain write path is required.' })
  const [failingTool] = plugin.buildOmniCastToolDefinitions({ host: host.ctx, hostAgent: { ctx: host.ctx }, run: failing.run })
  const err = await failingTool.execute({ path: '/protocols/paylike', payload: '{}' }, {})
  assert.match(err, /omni_cast failed: Chain write path is required\./)
})
