import assert from 'node:assert/strict'
import test from 'node:test'

const plugin = await import('../lib/index.js')
const {
  isA2aReplyAgent,
  markA2aReplyAgent,
  unmarkA2aReplyAgent,
  withA2aReplyGuard,
} = await import('../lib/a2a-reply-guard.js')
const { buildMediaDescriptionToolDefinitions } = await import('../lib/vision-tools.js')

function fakeEventCtx() {
  const listeners = []
  return {
    listeners,
    ctx: {
      on: (event, listener) => {
        if (event === 'session/event') listeners.push(listener)
        return () => {
          const index = listeners.indexOf(listener)
          if (index >= 0) listeners.splice(index, 1)
        }
      },
    },
    fire(session, event) {
      for (const listener of [...listeners]) listener(session, event)
    },
  }
}

test('a2a reply guard marks and unmarks agents', () => {
  const agent = { ctx: {} }
  assert.equal(isA2aReplyAgent(agent), false)
  assert.equal(isA2aReplyAgent(undefined), false)
  assert.equal(isA2aReplyAgent(null), false)
  markA2aReplyAgent(agent)
  assert.equal(isA2aReplyAgent(agent), true)
  unmarkA2aReplyAgent(agent)
  assert.equal(isA2aReplyAgent(agent), false)
})

test('withA2aReplyGuard refuses gated tools only for marked reply agents', async () => {
  const calls = []
  const definition = {
    name: 'describe_image',
    description: 'x',
    parameters: {},
    output: { schema: {}, render: () => [] },
    execute: async () => { calls.push(1); return 'secret file content' },
  }
  const guarded = withA2aReplyGuard(definition)
  const replyAgent = { ctx: {} }
  markA2aReplyAgent(replyAgent)
  const refused = await guarded.execute({}, { agent: replyAgent })
  assert.match(String(refused), /not available while replying to a remote chat peer/)
  assert.equal(calls.length, 0, 'the wrapped tool must not execute for a reply agent')
  // Normal sessions (including exec without an agent) run unchanged.
  assert.equal(await guarded.execute({}, { agent: { ctx: {} } }), 'secret file content')
  assert.equal(await guarded.execute({}, {}), 'secret file content')
  assert.equal(calls.length, 2)
})

test('withA2aReplyGuard leaves ungated tools untouched', () => {
  const definition = {
    name: 'search_metaweb',
    description: 'x',
    parameters: {},
    output: { schema: {}, render: () => [] },
    execute: async () => 'ok',
  }
  assert.equal(withA2aReplyGuard(definition), definition)
})

test('gated tool families refuse for reply agents when wrapped at registration', async () => {
  const control = {
    describeImage: async () => 'image-bytes-disclosed',
    describeVideo: async () => 'video-bytes-disclosed',
    describeAudio: async () => 'audio-bytes-disclosed',
  }
  const replyAgent = { ctx: {} }
  markA2aReplyAgent(replyAgent)
  for (const definition of buildMediaDescriptionToolDefinitions(control).map(withA2aReplyGuard)) {
    const result = await definition.execute(
      { image_path: '/etc/passwd', video_path: '/etc/passwd', audio: '/etc/passwd' },
      { agent: replyAgent },
    )
    assert.match(String(result), /not available while replying to a remote chat peer/)
  }
})

test('host agent turn runner marks the session for the turn only, then unmarks', async () => {
  const bus = fakeEventCtx()
  let capturedAgent
  let markedDuringTurn = null
  let capturedMeta = null
  bus.ctx.get = (key) => (key === 'agents'
    ? {
        create: async (options) => {
          capturedMeta = options.meta
          const session = { id: options.sessionId }
          const agent = {
            session,
            followup: () => {
              capturedAgent = agent
              markedDuringTurn = isA2aReplyAgent(agent)
              bus.fire(session, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '回信' }] } } })
            },
            whenIdle: () => Promise.resolve(),
          }
          return { agent, dispose: async () => {} }
        },
      }
    : undefined)
  const runner = plugin.createHostAgentTurnRunner(bus.ctx)
  const text = await runner({ prompt: '写一句回复', provider: 'p', model: 'm', cwd: '/tmp', timeoutMs: 5000 })
  assert.equal(text, '回信')
  assert.equal(markedDuringTurn, true, 'the reply agent must be marked while the turn runs')
  assert.equal(isA2aReplyAgent(capturedAgent), false, 'the mark is lifted after the turn')
  assert.equal(capturedMeta?.oacOrigin, 'a2a-reply')
})
