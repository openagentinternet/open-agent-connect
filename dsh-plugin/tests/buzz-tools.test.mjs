import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const plugin = await import('../lib/buzz-tools.js')

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
      return result ?? { ok: true, state: 'success', data: { pinId: 'bz1', txids: ['t1'], totalCost: 1200, attachments: ['metafile://fi0'] } }
    },
  }
}

test('post_buzz registers on the global layer', () => {
  const host = fakeHost()
  plugin.bindBuzzToolInstall(host.ctx)
  assert.deepEqual(host.tools.map((tool) => tool.name), ['post_buzz'])
})

test('post_buzz description documents the attachment path rules', () => {
  const host = fakeHost()
  plugin.bindBuzzToolInstall(host.ctx)
  const description = host.tools[0].description
  assert.match(description, /ABSOLUTE \(relative paths are rejected\)/)
  assert.match(description, /approval prompts are disabled .* auto-declined/)
  assert.match(description, /copy the file into the session workspace first/)
})

test('empty content is rejected before any CLI call', async () => {
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const [tool] = plugin.buildBuzzToolDefinitions({ host: host.ctx, hostAgent: { ctx: host.ctx }, run })
  const missing = await tool.execute({ content: '   ' }, {})
  assert.match(missing, /requires `content`/)
  assert.equal(calls.length, 0)
})

test('metafile URIs and in-workspace attachments post without asking; external files require approval', async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'bz-ws-'))
  const inside = path.join(workspace, 'shot.png')
  writeFileSync(inside, 'png')
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'bz-out-'))
  const outside = path.join(outsideDir, 'secret.png')
  writeFileSync(outside, 's')

  const asked = []
  let approve = true
  const approval = {
    request: async (req) => {
      asked.push(req)
      return approve ? 'allowed-once' : 'rejected'
    },
    overrideOf: () => undefined,
  }
  const { run, calls } = fakeRun()
  const host = fakeHost({ agentPresets: { composedPreset: () => 'oac-alice' } })
  const stagedCalls = []
  const stageExternalFiles = async (from, paths) => {
    stagedCalls.push({ from, paths })
    return {
      pathByOriginal: new Map(paths.map((item) => [item, path.join(workspace, `staged-${path.basename(item)}`)])),
      cleanup: async () => {},
    }
  }
  const [tool] = plugin.buildBuzzToolDefinitions({
    host: host.ctx,
    hostAgent: { ctx: host.ctx },
    approval,
    run,
    getWorkspaceDir: () => workspace,
    stageExternalFiles,
  })

  const ok = await tool.execute({
    content: 'hello chain', attachments: [inside, 'metafile://keep'], quote_pin: 'q9', content_type: 'text/markdown', network: 'doge',
  }, {})
  assert.match(ok, /pin:\/\/bz1/)
  assert.match(ok, /cost: 1200 sats/)
  assert.equal(asked.length, 0, 'in-workspace + metafile URIs never ask')
  assert.deepEqual(calls[0].args.slice(0, 4), ['buzz', 'post', '--from', 'alice'])
  assert.equal(calls[0].payload.content, 'hello chain')
  assert.equal(calls[0].payload.contentType, 'text/markdown')
  assert.equal(calls[0].payload.quotePin, 'q9')
  assert.equal(calls[0].payload.network, 'doge')
  assert.deepEqual(calls[0].payload.attachments, [inside, 'metafile://keep'])

  const external = await tool.execute({ content: 'see attachment', attachments: [outside] }, {})
  assert.match(external, /pin:\/\/bz1/)
  assert.equal(asked.length, 1)
  assert.match(asked[0].reason, /Upload these files on-chain as buzz attachments/)
  assert.deepEqual(stagedCalls[0]?.paths, [outside], 'approved external files are staged by the host')
  assert.equal(calls[1].payload.attachments[0], path.join(workspace, 'staged-secret.png'), 'post uses the staged in-workspace path')
  assert.equal(calls[1].payload.confirmExternalUpload, undefined, 'no caller-side consent flag may reach the daemon')

  approve = false
  const denied = await tool.execute({ content: 'again', attachments: [outside] }, {})
  assert.match(denied, /Owner declined/)
  assert.match(denied, /copy the file into the session workspace/)
  assert.match(denied, /Do not retry the same path/)
  assert.equal(calls.length, 2, 'declined post never spawns the CLI write')

  const relative = await tool.execute({ content: 'rel', attachments: ['./rel.png'] }, {})
  assert.match(relative, /ABSOLUTE local file paths/)
})

test('missing approval surface refuses external files; CLI failure surfaces the message; invalid network is rejected', async () => {
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'bz-out2-'))
  const outside = path.join(outsideDir, 'f.png')
  writeFileSync(outside, 'f')
  const { run } = fakeRun()
  const host = fakeHost()
  const [tool] = plugin.buildBuzzToolDefinitions({ host: host.ctx, hostAgent: { ctx: host.ctx }, run })
  const refused = await tool.execute({ content: 'c', attachments: [outside] }, {})
  assert.match(refused, /approval is not available/)

  const failing = fakeRun({ ok: false, state: 'failed', code: 'x', message: 'boom' })
  const [tool2] = plugin.buildBuzzToolDefinitions({ host: host.ctx, hostAgent: { ctx: host.ctx }, run: failing.run })
  const err = await tool2.execute({ content: 'c' }, {})
  assert.match(err, /Buzz post failed: boom/)

  const badNetwork = await tool2.execute({ content: 'c', network: 'ltc' }, {})
  assert.match(badNetwork, /Invalid network "ltc"/)
})
