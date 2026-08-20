import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

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
  assert.deepEqual(alice.dreamed.sort(), ['2026-08-10', '2026-08-18', '2026-08-19'])
  assert.deepEqual(bob.dreamed, []) // dreamEnabled=false
  assert.deepEqual(nollm.dreamed, []) // no DSH LLM configured
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
  assert.equal(llm.requests.length, 0)
})
