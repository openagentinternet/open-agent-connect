import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const plugin = await import('../lib/simplenote-tools.js')

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
      calls.push({ args, options })
      return result ?? { ok: true, state: 'success', data: { pinId: 'np1', formatted: 'Note published on-chain.\n- pinId: np1' } }
    },
  }
}

test('post_simplenote registers on the global layer', () => {
  const host = fakeHost()
  plugin.bindSimpleNoteToolInstall(host.ctx)
  assert.deepEqual(host.tools.map((tool) => tool.name), ['post_simplenote'])
})

test('metafile URIs and in-workspace files publish without asking; external files require approval', async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'sn-ws-'))
  const inside = path.join(workspace, 'cover.png')
  writeFileSync(inside, 'png')
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'sn-out-'))
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
  const host = fakeHost()
  const [tool] = plugin.buildSimpleNoteToolDefinitions({
    host: host.ctx,
    hostAgent: { ctx: host.ctx },
    approval,
    run,
    getWorkspaceDir: () => workspace,
  })

  const ok = await tool.execute({
    title: 'T', content: 'B', cover: inside, attachments: ['metafile://keep'], tags: ['x'],
  }, {})
  assert.match(ok, /pinId: np1/)
  assert.equal(asked.length, 0, 'in-workspace + metafile URIs never ask')
  assert.deepEqual(calls[0].args.slice(0, 2), ['simplenote', 'post'])

  const external = await tool.execute({ title: 'T', content: 'B', cover: outside }, {})
  assert.match(external, /pinId: np1/)
  assert.equal(asked.length, 1)
  assert.match(asked[0].reason, /Publish these files on-chain/)

  approve = false
  const denied = await tool.execute({ title: 'T', content: 'B', cover: outside }, {})
  assert.match(denied, /Owner declined/)
  assert.equal(calls.length, 2, 'declined publish never spawns the CLI write')

  const relative = await tool.execute({ title: 'T', content: 'B', cover: './rel.png' }, {})
  assert.match(relative, /ABSOLUTE local file paths/)
})

test('missing approval surface refuses external files; CLI failure surfaces the message', async () => {
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'sn-out2-'))
  const outside = path.join(outsideDir, 'f.png')
  writeFileSync(outside, 'f')
  const { run } = fakeRun()
  const host = fakeHost()
  const [tool] = plugin.buildSimpleNoteToolDefinitions({
    host: host.ctx,
    hostAgent: { ctx: host.ctx },
    run,
  })
  const refused = await tool.execute({ title: 'T', content: 'B', cover: outside }, {})
  assert.match(refused, /approval is not available/)

  const failing = fakeRun({ ok: false, state: 'failed', code: 'x', message: 'boom' })
  const [tool2] = plugin.buildSimpleNoteToolDefinitions({
    host: host.ctx,
    hostAgent: { ctx: host.ctx },
    approval: { request: async () => 'allowed-once', overrideOf: () => undefined },
    run: failing.run,
  })
  const err = await tool2.execute({ title: 'T', content: 'B' }, {})
  assert.match(err, /Note publish failed: boom/)
})
