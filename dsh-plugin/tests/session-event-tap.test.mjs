import assert from 'node:assert/strict'
import test from 'node:test'

const plugin = await import('../lib/index.js')
const { tapSessionEvents, tappedOrSnapshot } = await import('../lib/session-event-tap.js')

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

test('tapSessionEvents returns null without the cordis event surface', () => {
  assert.equal(tapSessionEvents({}, 's1'), null)
})

test('tapSessionEvents collects only the tapped session and stops after dispose', () => {
  const bus = fakeEventCtx()
  const tap = tapSessionEvents(bus.ctx, 's1')
  const other = tapSessionEvents(bus.ctx, 's2')
  bus.fire({ id: 's1' }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'a' }] } } })
  bus.fire({ id: 's2' }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'b' }] } } })
  bus.fire(undefined, { type: 'assistant/message', data: {} })
  assert.equal(tap.events.length, 1)
  assert.equal(other.events.length, 1)
  tap.dispose()
  bus.fire({ id: 's1' }, { type: 'turn/end', data: {} })
  assert.equal(tap.events.length, 1)
  bus.fire({ id: 's2' }, { type: 'turn/end', data: {} })
  assert.equal(other.events.length, 2)
  other.dispose()
})

test('tappedOrSnapshot prefers the tap and falls back to the legacy reads', () => {
  const tap = { events: [{ type: 'turn/end' }], dispose: () => {} }
  assert.equal(tappedOrSnapshot(tap, undefined), tap.events)
  const viaSnapshot = [{ type: 'assistant/message' }]
  assert.equal(tappedOrSnapshot(null, { snapshotEvents: () => viaSnapshot }), viaSnapshot)
  const viaEvents = [{ type: 'turn/start' }]
  assert.equal(tappedOrSnapshot(null, { events: viaEvents }), viaEvents)
  assert.deepEqual(tappedOrSnapshot(null, undefined), [])
})

test('host agent turn runner answers from the live event stream', async () => {
  const bus = fakeEventCtx()
  const created = []
  const disposed = []
  bus.ctx.get = (key) => (key === 'agents'
    ? {
        create: async (options) => {
          created.push(options)
          const session = { id: options.sessionId }
          return {
            agent: {
              session,
              followup: () => {
                bus.fire(session, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '巴黎回信' }] } } })
              },
              whenIdle: () => Promise.resolve(),
            },
            dispose: async () => { disposed.push(options.sessionId) },
          }
        },
      }
    : undefined)
  const runner = plugin.createHostAgentTurnRunner(bus.ctx)
  assert.equal(typeof runner, 'function')
  const text = await runner({
    prompt: '写一句回复',
    provider: 'deepseek',
    model: 'deepseek-chat',
    cwd: '/tmp',
    timeoutMs: 5000,
  })
  assert.equal(text, '巴黎回信')
  assert.equal(disposed.length, 1, 'the ephemeral session is disposed after the turn')
  assert.equal(bus.listeners.length, 0, 'the tap is disposed after the turn')
})

test('host agent turn runner surfaces the turn error from the stream', async () => {
  const bus = fakeEventCtx()
  bus.ctx.get = (key) => (key === 'agents'
    ? {
        create: async (options) => {
          const session = { id: options.sessionId }
          return {
            agent: {
              session,
              followup: () => {
                bus.fire(session, { type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'no model' } } } })
              },
              whenIdle: () => Promise.resolve(),
            },
            dispose: async () => {},
          }
        },
      }
    : undefined)
  const runner = plugin.createHostAgentTurnRunner(bus.ctx)
  await assert.rejects(
    runner({ prompt: 'x', provider: 'p', model: 'm', cwd: '/tmp', timeoutMs: 5000 }),
    /produced no reply — no model/,
  )
  assert.equal(bus.listeners.length, 0, 'the tap is disposed even on failure')
})
