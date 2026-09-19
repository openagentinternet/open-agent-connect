import assert from 'node:assert/strict'
import test from 'node:test'

const plugin = await import('../lib/index.js')

test('currentMainViewSessionId prefers the mainView-retained row (DSH 0.1.6)', () => {
  const state = {
    byId: {
      'session-a': { id: 'session-a', retainedBy: { oac: 1 } },
      'session-b': { id: 'session-b', retainedBy: { mainView: 1, oac: 2 } },
      'session-c': { id: 'session-c', retainedBy: {} },
    },
  }
  assert.equal(plugin.currentMainViewSessionId(state), 'session-b')
})

test('currentMainViewSessionId falls back to the legacy current id (DSH ≤0.1.5)', () => {
  const state = {
    current: 'session-legacy',
    byId: {
      'session-legacy': { id: 'session-legacy' },
    },
  }
  assert.equal(plugin.currentMainViewSessionId(state), 'session-legacy')
})

test('currentMainViewSessionId returns undefined when nothing is current', () => {
  assert.equal(plugin.currentMainViewSessionId({ byId: {} }), undefined)
  assert.equal(plugin.currentMainViewSessionId({ byId: { a: { id: 'a', retainedBy: { oac: 1 } } } }), undefined)
  assert.equal(plugin.currentMainViewSessionId({}), undefined)
})
