import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const plugin = await import('../lib/comment-tools.js')

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
      return result ?? { ok: true, state: 'success', data: { pinId: 'c1', txids: ['t1'], totalCost: 90, targetPinId: 'tgt1' } }
    },
  }
}

test('comment_pin registers on the global layer', () => {
  const host = fakeHost()
  plugin.bindCommentToolInstall(host.ctx)
  assert.deepEqual(host.tools.map((tool) => tool.name), ['comment_pin'])
})

test('empty pin_id / content is rejected before any CLI call', async () => {
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const [tool] = plugin.buildCommentToolDefinitions({ host: host.ctx, hostAgent: { ctx: host.ctx }, run })

  const missingPin = await tool.execute({ content: 'hi' }, {})
  assert.match(missingPin, /requires `pin_id`/)
  const missingContent = await tool.execute({ pin_id: 'tgt1' }, {})
  assert.match(missingContent, /requires non-empty `content`/)
  const invalidNetwork = await tool.execute({ pin_id: 'tgt1', content: 'hi', network: 'eth' }, {})
  assert.match(invalidNetwork, /Invalid network "eth"/)
  assert.equal(calls.length, 0)
})

test('comment_pin maps args to the comment pin CLI request and renders the sheet', async () => {
  const { run, calls } = fakeRun()
  const host = fakeHost({ agentPresets: { composedPreset: () => 'oac-alice' } })
  const [tool] = plugin.buildCommentToolDefinitions({ host: host.ctx, hostAgent: { ctx: host.ctx }, run })

  const ok = await tool.execute({ pin_id: 'tgt1', content: 'a real answer' }, {})
  assert.match(ok, /Commented on pin tgt1 — comment published on-chain\./)
  assert.match(ok, /- comment pinId: c1/)
  assert.match(ok, /- txids: t1/)
  assert.match(ok, /- cost: 90 sats/)
  assert.match(ok, /- view link: \[pin:\/\/c1\]\(pin:\/\/c1\)/)
  assert.deepEqual(calls[0].args.slice(0, 4), ['comment', 'pin', '--from', 'alice'])
  assert.equal(calls[0].payload.pinId, 'tgt1')
  assert.equal(calls[0].payload.content, 'a real answer')
  assert.equal(calls[0].payload.network, undefined, 'network omitted unless explicitly set')
})

test('comment_pin forwards an explicit network through the request payload', async () => {
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const [tool] = plugin.buildCommentToolDefinitions({ host: host.ctx, hostAgent: { ctx: host.ctx }, run })
  const ok = await tool.execute({ pin_id: 'tgt1', content: 'hi', network: 'doge' }, {})
  assert.match(ok, /Commented on pin tgt1/)
  assert.equal(calls[0].payload.network, 'doge')
})

test('CLI failure surfaces the daemon message', async () => {
  const failing = fakeRun({ ok: false, state: 'failed', code: 'identity_missing', message: 'Create a local MetaBot identity before commenting.' })
  const host = fakeHost()
  const [tool] = plugin.buildCommentToolDefinitions({ host: host.ctx, hostAgent: { ctx: host.ctx }, run: failing.run })
  const err = await tool.execute({ pin_id: 'tgt1', content: 'hi' }, {})
  assert.match(err, /Comment publish failed: Create a local MetaBot identity before commenting\./)
})
