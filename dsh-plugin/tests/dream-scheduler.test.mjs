import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test, { mock } from 'node:test'

const plugin = await import('../lib/index.js')

function fakeLlm(text = '{"daily_summary":"ok"}') {
  const requests = []
  return {
    requests,
    stream: (options) => {
      requests.push(options)
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'text-delta', index: 0, text }
        }
      }
    },
  }
}

test('scheduler tick dreams only dream-enabled bots with a DSH LLM, one date each due', async () => {
  const llm = fakeLlm()
  const run = async (args) => {
    const verb = args.slice(0, 2).join(' ')
    if (verb === 'bot list') {
      return {
        ok: true,
        state: 'success',
        data: {
          profiles: [
            { slug: 'alice', dshLlmProvider: 'deepseek', dshLlmModel: 'deepseek-v4-flash' },
            { slug: 'bob', dshLlmProvider: 'deepseek', dshLlmModel: 'deepseek-v4-flash' },
            { slug: 'nollm' },
            { slug: 'idle', dshLlmProvider: 'deepseek', dshLlmModel: 'deepseek-v4-flash' },
          ],
        },
      }
    }
    if (verb === 'memory policy') {
      const slug = args[args.indexOf('--from') + 1]
      return {
        ok: true,
        state: 'success',
        data: { effective: { dreamEnabled: slug !== 'bob' } },
      }
    }
    if (verb === 'dream due') {
      const slug = args[args.indexOf('--from') + 1]
      return {
        ok: true,
        state: 'success',
        data: slug === 'alice' ? { dueDates: ['2026-08-18', '2026-08-19'], repairDates: ['2026-08-10'] } : { dueDates: [], repairDates: [] },
      }
    }
    if (verb === 'dream plan') {
      return { ok: true, state: 'success', data: { kind: 'prompt', system: 's', user: 'u' } }
    }
    if (verb === 'dream commit') {
      const fileFlag = args.indexOf('--payload-file')
      const file = JSON.parse(await readFile(args[fileFlag + 1], 'utf8'))
      return { ok: true, state: 'success', data: { ok: true, isRepair: file.isRepair === true } }
    }
    return { ok: true, state: 'success', data: {} }
  }
  const outcomes = await plugin.runDreamSchedulerTick({ run, llm })
  const alice = outcomes.find((outcome) => outcome.slug === 'alice')
  const bob = outcomes.find((outcome) => outcome.slug === 'bob')
  const nollm = outcomes.find((outcome) => outcome.slug === 'nollm')
  const idle = outcomes.find((outcome) => outcome.slug === 'idle')
  assert.deepEqual(alice.dreamed.sort(), ['2026-08-10', '2026-08-18', '2026-08-19'])
  assert.deepEqual(bob.dreamed, []) // dreamEnabled=false
  assert.equal(bob.skipped, 'dream disabled by policy')
  assert.deepEqual(nollm.dreamed, []) // no DSH LLM configured
  assert.equal(nollm.skipped, 'no DSH LLM configured on Bot')
  assert.deepEqual(idle.dreamed, []) // nothing due
  assert.equal(idle.skipped, 'no due dates')
  // Two due dreams + one repair, each one LLM call.
  assert.equal(llm.requests.length, 3)
})

test('scheduler tick skips bots with no due dates and never throws on per-bot failure', async () => {
  const llm = fakeLlm()
  const run = async (args) => {
    const verb = args.slice(0, 2).join(' ')
    if (verb === 'bot list') {
      return {
        ok: true,
        state: 'success',
        data: { profiles: [{ slug: 'alice', dshLlmProvider: 'p', dshLlmModel: 'm' }] },
      }
    }
    if (verb === 'memory policy') return { ok: true, state: 'success', data: { effective: { dreamEnabled: true } } }
    if (verb === 'dream due') return { ok: false, state: 'failed', code: 'boom', message: 'due exploded' }
    return { ok: true, state: 'success', data: {} }
  }
  const outcomes = await plugin.runDreamSchedulerTick({ run, llm })
  assert.equal(outcomes.length, 1)
  assert.deepEqual(outcomes[0].dreamed, [])
  assert.equal(outcomes[0].error, 'due exploded') // a failed `dream due` is no longer silent
  assert.equal(llm.requests.length, 0)
})

test('scheduler retries a failed dream once on the Bot fallback LLM pair', async () => {
  const requests = []
  const llm = {
    requests,
    stream: (options) => {
      requests.push(options)
      if (options.provider === 'deepseek') {
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'finish', reason: { kind: 'error', failure: { message: 'primary down' } } }
          },
        }
      }
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'text-delta', index: 0, text: '{"daily_summary":"ok"}' }
        },
      }
    },
  }
  const run = async (args) => {
    const verb = args.slice(0, 2).join(' ')
    if (verb === 'bot list') {
      return {
        ok: true,
        state: 'success',
        data: {
          profiles: [{
            slug: 'alice',
            dshLlmProvider: 'deepseek',
            dshLlmModel: 'deepseek-v4-flash',
            dshLlmFallbackProvider: 'ollama',
            dshLlmFallbackModel: 'qwen3',
          }],
        },
      }
    }
    if (verb === 'memory policy') return { ok: true, state: 'success', data: { effective: { dreamEnabled: true } } }
    if (verb === 'dream due') return { ok: true, state: 'success', data: { dueDates: ['2026-08-18'], repairDates: [] } }
    if (verb === 'dream plan') return { ok: true, state: 'success', data: { kind: 'prompt', system: 's', user: 'u' } }
    return { ok: true, state: 'success', data: {} }
  }
  const outcomes = await plugin.runDreamSchedulerTick({ run, llm })
  assert.deepEqual(outcomes[0].dreamed, ['2026-08-18'])
  assert.equal(outcomes[0].error, undefined)
  // The whole plan → llm → commit attempt reran on the fallback pair.
  assert.equal(requests.length, 2)
  assert.equal(requests[0].provider, 'deepseek')
  assert.equal(requests[1].provider, 'ollama')
})

test('scheduler surfaces the primary error when no fallback LLM is configured', async () => {
  const llm = {
    stream: () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'primary down' } } }
      },
    }),
  }
  const run = async (args) => {
    const verb = args.slice(0, 2).join(' ')
    if (verb === 'bot list') {
      return {
        ok: true,
        state: 'success',
        data: { profiles: [{ slug: 'alice', dshLlmProvider: 'deepseek', dshLlmModel: 'deepseek-v4-flash' }] },
      }
    }
    if (verb === 'bot show') return { ok: true, state: 'success', data: { profile: {} } }
    if (verb === 'memory policy') return { ok: true, state: 'success', data: { effective: { dreamEnabled: true } } }
    if (verb === 'dream due') return { ok: true, state: 'success', data: { dueDates: ['2026-08-18'], repairDates: [] } }
    if (verb === 'dream plan') return { ok: true, state: 'success', data: { kind: 'prompt', system: 's', user: 'u' } }
    return { ok: true, state: 'success', data: {} }
  }
  const outcomes = await plugin.runDreamSchedulerTick({ run, llm })
  assert.deepEqual(outcomes[0].dreamed, [])
  assert.equal(outcomes[0].error, 'primary down')
})

test('applyDreamScheduler logs per-bot outcomes after the boot tick', async (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  t.after(() => mock.timers.reset())
  const warnings = []
  const infos = []
  const llm = fakeLlm()
  const run = async (args) => {
    const verb = args.slice(0, 2).join(' ')
    if (verb === 'bot list') {
      return {
        ok: true,
        state: 'success',
        data: {
          profiles: [
            { slug: 'alice', dshLlmProvider: 'deepseek', dshLlmModel: 'deepseek-v4-flash' },
            { slug: 'bob', dshLlmProvider: 'deepseek', dshLlmModel: 'deepseek-v4-flash' },
            { slug: 'nollm' },
          ],
        },
      }
    }
    if (verb === 'memory policy') {
      const slug = args[args.indexOf('--from') + 1]
      return { ok: true, state: 'success', data: { effective: { dreamEnabled: slug !== 'bob' } } }
    }
    if (verb === 'dream due') return { ok: true, state: 'success', data: { dueDates: ['2026-08-18'], repairDates: [] } }
    if (verb === 'dream plan') return { ok: true, state: 'success', data: { kind: 'prompt', system: 's', user: 'u' } }
    return { ok: true, state: 'success', data: {} }
  }
  let onTick
  const ticked = new Promise((resolve) => { onTick = resolve })
  const ctx = {
    llm,
    logger: { warn: (message) => warnings.push(message), info: (message) => infos.push(message) },
    effect: (fn) => { fn() },
  }
  plugin.applyDreamScheduler(ctx, { run, llm, onTick })
  mock.timers.tick(15_000) // fire the boot catch-up pass
  const outcomes = await ticked
  assert.equal(outcomes.find((outcome) => outcome.slug === 'bob').skipped, 'dream disabled by policy')
  assert.deepEqual(warnings, [])
  assert.ok(infos.some((message) => message.includes('alice') && message.includes('dreamed 2026-08-18')))
  assert.ok(infos.some((message) => message.includes('bob') && message.includes('dream disabled by policy')))
  assert.ok(infos.some((message) => message.includes('nollm') && message.includes('no DSH LLM configured on Bot')))
})
