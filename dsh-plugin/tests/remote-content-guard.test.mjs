import assert from 'node:assert/strict'
import test from 'node:test'

const plugin = await import('../lib/index.js')
const {
  isRemoteContentAgent,
  markRemoteContentAgent,
  unmarkRemoteContentAgent,
  withRemoteContentGuard,
} = await import('../lib/remote-content-guard.js')
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

test('remote content guard marks and unmarks agents', () => {
  const agent = { ctx: {} }
  assert.equal(isRemoteContentAgent(agent), false)
  assert.equal(isRemoteContentAgent(undefined), false)
  assert.equal(isRemoteContentAgent(null), false)
  markRemoteContentAgent(agent)
  assert.equal(isRemoteContentAgent(agent), true)
  unmarkRemoteContentAgent(agent)
  assert.equal(isRemoteContentAgent(agent), false)
})

test('withRemoteContentGuard refuses gated tools only for marked reply agents', async () => {
  const calls = []
  const definition = {
    name: 'describe_image',
    description: 'x',
    parameters: {},
    output: { schema: {}, render: () => [] },
    execute: async () => { calls.push(1); return 'secret file content' },
  }
  const guarded = withRemoteContentGuard(definition)
  const replyAgent = { ctx: {} }
  markRemoteContentAgent(replyAgent)
  const refused = await guarded.execute({}, { agent: replyAgent })
  assert.match(String(refused), /not available while answering remote-driven content/)
  assert.equal(calls.length, 0, 'the wrapped tool must not execute for a reply agent')
  // Normal sessions (including exec without an agent) run unchanged.
  assert.equal(await guarded.execute({}, { agent: { ctx: {} } }), 'secret file content')
  assert.equal(await guarded.execute({}, {}), 'secret file content')
  assert.equal(calls.length, 2)
})

test('withRemoteContentGuard leaves ungated tools untouched', () => {
  const definition = {
    name: 'search_metaweb',
    description: 'x',
    parameters: {},
    output: { schema: {}, render: () => [] },
    execute: async () => 'ok',
  }
  assert.equal(withRemoteContentGuard(definition), definition)
})

test('gated tool families refuse for reply agents when wrapped at registration', async () => {
  const control = {
    describeImage: async () => 'image-bytes-disclosed',
    describeVideo: async () => 'video-bytes-disclosed',
    describeAudio: async () => 'audio-bytes-disclosed',
  }
  const replyAgent = { ctx: {} }
  markRemoteContentAgent(replyAgent)
  // Per-agent tools (installed only on oac-<slug> sessions) are gated too.
  const perAgent = withRemoteContentGuard({
    name: 'oac_session_read_all',
    description: 'x',
    parameters: {},
    output: { schema: {}, render: () => [] },
    execute: async () => 'other-bot-session-transcript',
  })
  const refusedPerAgent = await perAgent.execute({}, { agent: replyAgent })
  assert.match(String(refusedPerAgent), /not available while answering remote-driven content/)
  for (const definition of buildMediaDescriptionToolDefinitions(control).map(withRemoteContentGuard)) {
    const result = await definition.execute(
      { image_path: '/etc/passwd', video_path: '/etc/passwd', audio: '/etc/passwd' },
      { agent: replyAgent },
    )
    assert.match(String(result), /not available while answering remote-driven content/)
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
              markedDuringTurn = isRemoteContentAgent(agent)
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
  assert.equal(isRemoteContentAgent(capturedAgent), false, 'the mark is lifted after the turn')
  assert.equal(capturedMeta?.oacOrigin, 'a2a-reply')
})
