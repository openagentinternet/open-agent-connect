// Surf host routes + the pre-dream surf hook in the dream scheduler.
import assert from 'node:assert/strict'
import test from 'node:test'

const plugin = await import('../lib/index.js')

const { dispatchSurfRoutes } = plugin

function resultOf(ok, data) {
  return { ok, state: ok ? 'success' : 'failed', ...(data !== undefined ? { data } : {}) }
}

test('surf routes forward to the metabot surf CLI verbs', async () => {
  const calls = []
  const run = async (args) => {
    calls.push(args)
    return resultOf(true, { ok: true })
  }

  const status = await dispatchSurfRoutes('surf/status', { from: 'alice', limit: 8 }, { run })
  assert.equal(status.ok, true)
  assert.deepEqual(calls[0], ['surf', 'status', '--from', 'alice', '--limit', '8'])

  const started = await dispatchSurfRoutes('surf/run', { from: 'alice' }, { run })
  assert.equal(started.ok, true)
  assert.deepEqual(calls[1], ['surf', 'run', '--from', 'alice', '--trigger', 'manual-ui'])

  const preDream = await dispatchSurfRoutes('surf/run', { from: 'alice', trigger: 'pre-dream' }, { run })
  assert.equal(preDream.ok, true)
  assert.deepEqual(calls[2], ['surf', 'run', '--from', 'alice', '--trigger', 'pre-dream'])

  // Unknown triggers normalize to manual-ui (never trusted from the client).
  const weird = await dispatchSurfRoutes('surf/run', { from: 'alice', trigger: 'evil' }, { run })
  assert.equal(weird.ok, true)
  assert.deepEqual(calls[3], ['surf', 'run', '--from', 'alice', '--trigger', 'manual-ui'])

  await dispatchSurfRoutes('surf/enable', { from: 'alice' }, { run })
  assert.deepEqual(calls[4], ['surf', 'enable', '--from', 'alice'])

  await dispatchSurfRoutes('surf/disable', { from: 'alice' }, { run })
  assert.deepEqual(calls[5], ['surf', 'disable', '--from', 'alice'])

  await dispatchSurfRoutes('surf/budget', { from: 'alice', budget: 30 }, { run })
  assert.deepEqual(calls[6], ['surf', 'budget', '--from', 'alice', '30'])
})

test('surf/budget rejects out-of-range values host-side', async () => {
  const run = async () => resultOf(true)
  const bad = await dispatchSurfRoutes('surf/budget', { from: 'alice', budget: 101 }, { run })
  assert.equal(bad.ok, false)
  assert.equal(bad.code, 'invalid_budget')
  const fractional = await dispatchSurfRoutes('surf/budget', { from: 'alice', budget: 2.5 }, { run })
  assert.equal(fractional.ok, false)
})

test('unknown methods keep dispatching', async () => {
  const run = async () => resultOf(true)
  assert.equal(await dispatchSurfRoutes('surf/nope', {}, { run }), undefined)
  assert.equal(await dispatchSurfRoutes('memory/list', {}, { run }), undefined)
})

test('dream scheduler: pre-dream surf runs before the dream when due, never blocks it', async () => {
  const llm = {
    stream: () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'text-delta', index: 0, text: '{"daily_summary":"ok"}' }
      },
    }),
  }
  const surfCalls = []
  const dreamCalls = []
  const run = async (args) => {
    const verb = args.slice(0, 2).join(' ')
    if (verb === 'bot list') {
      return resultOf(true, {
        profiles: [{ slug: 'alice', dshLlmProvider: 'deepseek', dshLlmModel: 'deepseek-v4-flash' }],
      })
    }
    if (verb === 'memory policy') {
      return resultOf(true, { effective: { dreamEnabled: true } })
    }
    if (verb === 'dream due') {
      return resultOf(true, { dueDates: ['2026-09-15'] })
    }
    if (verb === 'dream plan') {
      dreamCalls.push(args)
      return resultOf(true, { kind: 'prompt', system: 's', user: 'u' })
    }
    if (verb === 'dream commit') {
      return resultOf(true, { ok: true })
    }
    if (verb === 'memory hygiene') {
      return resultOf(true, { due: false })
    }
    if (verb === 'surf status') {
      surfCalls.push(args.join(' '))
      return resultOf(true, { preDreamDue: true })
    }
    if (verb === 'surf run') {
      surfCalls.push(args.join(' '))
      return resultOf(true, { runId: 'r1', status: 'done' })
    }
    return resultOf(true, {})
  }

  const outcomes = await plugin.runDreamSchedulerTick({ run, llm })
  assert.equal(outcomes.length, 1)
  assert.equal(outcomes[0].surfRan, true)
  assert.equal(outcomes[0].dreamed.length, 1)
  // The surf ran BEFORE the dream plan was built.
  assert.ok(surfCalls.indexOf('surf run --from alice --trigger pre-dream --wait') >= 0)
  assert.ok(surfCalls.some((entry) => entry.startsWith('surf status')))

  // A failing surf never fails the dream.
  const runFailSurf = async (args) => {
    const verb = args.slice(0, 2).join(' ')
    if (verb === 'surf run') {
      return { ok: false, state: 'failed', message: 'daemon down' }
    }
    return run(args)
  }
  const outcomes2 = await plugin.runDreamSchedulerTick({ run: runFailSurf, llm })
  assert.equal(outcomes2[0].surfError, 'daemon down')
  assert.equal(outcomes2[0].dreamed.length, 1)
  assert.equal(outcomes2[0].error, undefined)

  // Not due → skipped quietly.
  const runNotDue = async (args) => {
    const verb = args.slice(0, 2).join(' ')
    if (verb === 'surf status') {
      return resultOf(true, { preDreamDue: false })
    }
    return run(args)
  }
  const outcomes3 = await plugin.runDreamSchedulerTick({ run: runNotDue, llm })
  assert.equal(outcomes3[0].surfRan, undefined)
  assert.match(outcomes3[0].surfSkipped ?? '', /not due/)

  // Hook disabled → no surf calls at all.
  const outcomes4 = await plugin.runDreamSchedulerTick({ run, llm, surfBeforeDream: false })
  assert.equal(outcomes4[0].surfRan, undefined)
  assert.equal(outcomes4[0].surfSkipped, undefined)
})
