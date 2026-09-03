import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test, { mock } from 'node:test'

const plugin = await import('../lib/index.js')

function fakeLlm(text = 'gist text') {
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

function failingLlm(message = 'primary down') {
  const requests = []
  return {
    requests,
    stream: (options) => {
      requests.push(options)
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'finish', reason: { kind: 'error', failure: { message } } }
        }
      }
    },
  }
}

function userText(request) {
  return request.messages.find((message) => message.role === 'user').content[0].text
}

function systemText(request) {
  return request.messages.find((message) => message.role === 'system').content[0].text
}

const WRITE_ITEM = {
  kind: 'write',
  pinId: 'w1',
  path: '/protocols/simplenote',
  contentText: 'a'.repeat(900),
  occurredAtMs: 1,
}
const READ_ITEM = {
  kind: 'read',
  pinId: 'r1',
  path: '/protocols/simplebuzz',
  protocol: 'simplebuzz',
  title: 'Buzz title',
  contentText: 'b'.repeat(900),
  occurredAtMs: 2,
}

/**
 * Fake RunFn: serves `bot list` from `profiles`, `chainhistory summary
 * pending` from `pendingBySlug`, and captures `chainhistory summary apply`
 * payloads into `applied`.
 */
function fakeRun({ profiles, pendingBySlug = {}, applied }) {
  return async (args) => {
    if (args.slice(0, 2).join(' ') === 'bot list') {
      return { ok: true, state: 'success', data: { profiles } }
    }
    const verb = args.slice(0, 3).join(' ')
    if (verb === 'chainhistory summary pending') {
      const slug = args[args.indexOf('--from') + 1]
      const entry = pendingBySlug[slug]
      if (entry instanceof Error) {
        return { ok: false, state: 'failed', code: 'boom', message: entry.message }
      }
      return {
        ok: true,
        state: 'success',
        data: { items: entry?.items ?? [], summarizedToday: entry?.summarizedToday ?? 0 },
      }
    }
    if (verb === 'chainhistory summary apply') {
      const fileFlag = args.indexOf('--payload-file')
      applied.push(JSON.parse(await readFile(args[fileFlag + 1], 'utf8')))
      return { ok: true, state: 'success', data: { applied: true } }
    }
    return { ok: true, state: 'success', data: {} }
  }
}

test('tick drains pending candidates and applies done outcomes', async () => {
  const llm = fakeLlm('gist text')
  const applied = []
  const run = fakeRun({
    profiles: [
      { slug: 'alice', dshLlmProvider: 'deepseek', dshLlmModel: 'deepseek-v4-flash' },
      { slug: 'nollm' },
    ],
    pendingBySlug: { alice: { items: [WRITE_ITEM, READ_ITEM], summarizedToday: 0 } },
    applied,
  })
  const outcomes = await plugin.runChainHistorySummaryTick({ run, llm })
  const alice = outcomes.find((outcome) => outcome.slug === 'alice')
  const nollm = outcomes.find((outcome) => outcome.slug === 'nollm')
  assert.equal(alice.done, 2)
  assert.equal(alice.failed, 0)
  assert.equal(nollm.skipped, 'no DSH LLM configured on Bot')
  assert.deepEqual(applied, [
    { kind: 'write', pinId: 'w1', outcome: 'done', summary: 'gist text' },
    { kind: 'read', pinId: 'r1', outcome: 'done', summary: 'gist text' },
  ])
  assert.equal(llm.requests.length, 2)
  assert.equal(llm.requests[0].maxTokens, 512)
  assert.equal(llm.requests[0].provider, 'deepseek')
  assert.equal(llm.requests[0].model, 'deepseek-v4-flash')
  assert.ok(userText(llm.requests[0]).includes('a'.repeat(900)))
  assert.ok(userText(llm.requests[1]).includes('title: Buzz title'))
})

test('empty LLM output applies a failed outcome for the item', async () => {
  const llm = {
    requests: [],
    stream: (options) => {
      llm.requests.push(options)
      return { async *[Symbol.asyncIterator]() { /* no chunks at all */ } }
    },
  }
  const applied = []
  const run = fakeRun({
    profiles: [{ slug: 'alice', dshLlmProvider: 'deepseek', dshLlmModel: 'deepseek-v4-flash' }],
    pendingBySlug: { alice: { items: [WRITE_ITEM], summarizedToday: 0 } },
    applied,
  })
  const outcomes = await plugin.runChainHistorySummaryTick({ run, llm })
  assert.equal(outcomes[0].done, 0)
  assert.equal(outcomes[0].failed, 1)
  assert.deepEqual(applied, [{ kind: 'write', pinId: 'w1', outcome: 'failed' }])
})

test('a failed main brain is retried once on the Bot fallback pair', async () => {
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
          yield { type: 'text-delta', index: 0, text: 'fallback gist' }
        },
      }
    },
  }
  const applied = []
  const run = fakeRun({
    profiles: [{
      slug: 'alice',
      dshLlmProvider: 'deepseek',
      dshLlmModel: 'deepseek-v4-flash',
      dshLlmFallbackProvider: 'ollama',
      dshLlmFallbackModel: 'qwen3',
    }],
    pendingBySlug: { alice: { items: [WRITE_ITEM], summarizedToday: 0 } },
    applied,
  })
  const outcomes = await plugin.runChainHistorySummaryTick({ run, llm })
  assert.equal(outcomes[0].done, 1)
  assert.equal(outcomes[0].failed, 0)
  assert.equal(requests.length, 2)
  assert.equal(requests[0].provider, 'deepseek')
  assert.equal(requests[0].model, 'deepseek-v4-flash')
  assert.equal(requests[1].provider, 'ollama')
  assert.equal(requests[1].model, 'qwen3')
  assert.deepEqual(applied, [{ kind: 'write', pinId: 'w1', outcome: 'done', summary: 'fallback gist' }])
})

test('the perTick global budget caps attempts across bots', async () => {
  const llm = fakeLlm()
  const applied = []
  const limits = []
  const run = async (args) => {
    if (args.slice(0, 2).join(' ') === 'bot list') {
      return {
        ok: true,
        state: 'success',
        data: {
          profiles: [
            { slug: 'alice', dshLlmProvider: 'p', dshLlmModel: 'm' },
            { slug: 'bob', dshLlmProvider: 'p', dshLlmModel: 'm' },
          ],
        },
      }
    }
    const verb = args.slice(0, 3).join(' ')
    if (verb === 'chainhistory summary pending') {
      limits.push(args[args.indexOf('--limit') + 1])
      const slug = args[args.indexOf('--from') + 1]
      // Deliberately returns 2 items even when the limit is smaller: the tick
      // itself must stop at the remaining global budget.
      return {
        ok: true,
        state: 'success',
        data: {
          items: [
            { kind: 'write', pinId: `${slug}-1`, path: null, contentText: 'x'.repeat(900), occurredAtMs: 1 },
            { kind: 'write', pinId: `${slug}-2`, path: null, contentText: 'y'.repeat(900), occurredAtMs: 2 },
          ],
          summarizedToday: 0,
        },
      }
    }
    if (verb === 'chainhistory summary apply') {
      const fileFlag = args.indexOf('--payload-file')
      applied.push(JSON.parse(await readFile(args[fileFlag + 1], 'utf8')))
      return { ok: true, state: 'success', data: { applied: true } }
    }
    return { ok: true, state: 'success', data: {} }
  }
  const outcomes = await plugin.runChainHistorySummaryTick({ run, llm, perTick: 3, dailyCap: 40 })
  assert.equal(outcomes.find((outcome) => outcome.slug === 'alice').done, 2)
  assert.equal(outcomes.find((outcome) => outcome.slug === 'bob').done, 1)
  assert.equal(llm.requests.length, 3)
  assert.equal(applied.length, 3)
  assert.deepEqual(limits, ['3', '3'])
})

test('the per-bot daily cap derives from summarizedToday', async () => {
  const llm = fakeLlm()
  const applied = []
  const run = fakeRun({
    profiles: [
      { slug: 'alice', dshLlmProvider: 'p', dshLlmModel: 'm' },
      { slug: 'bob', dshLlmProvider: 'p', dshLlmModel: 'm' },
    ],
    pendingBySlug: {
      alice: {
        items: [
          { kind: 'write', pinId: 'a1', path: null, contentText: 'x'.repeat(900), occurredAtMs: 1 },
          { kind: 'write', pinId: 'a2', path: null, contentText: 'y'.repeat(900), occurredAtMs: 2 },
        ],
        summarizedToday: 4,
      },
      bob: { items: [{ kind: 'write', pinId: 'b1', path: null, contentText: 'z'.repeat(900), occurredAtMs: 1 }], summarizedToday: 5 },
    },
    applied,
  })
  const outcomes = await plugin.runChainHistorySummaryTick({ run, llm, perTick: 10, dailyCap: 5 })
  const alice = outcomes.find((outcome) => outcome.slug === 'alice')
  const bob = outcomes.find((outcome) => outcome.slug === 'bob')
  assert.equal(alice.done, 1) // only one slot left: 5 - 4
  assert.equal(bob.skipped, 'daily summary cap reached')
  assert.equal(llm.requests.length, 1)
  assert.deepEqual(applied, [{ kind: 'write', pinId: 'a1', outcome: 'done', summary: 'gist text' }])
})

test('one failing item never interrupts the rest of the batch', async () => {
  let calls = 0
  const llm = {
    requests: [],
    stream: (options) => {
      llm.requests.push(options)
      calls += 1
      if (calls === 1) {
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'finish', reason: { kind: 'error', failure: { message: 'boom' } } }
          },
        }
      }
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'text-delta', index: 0, text: 'gist' }
        },
      }
    },
  }
  const applied = []
  const run = fakeRun({
    profiles: [{ slug: 'alice', dshLlmProvider: 'p', dshLlmModel: 'm' }],
    pendingBySlug: {
      alice: {
        items: [
          { kind: 'write', pinId: 'w1', path: null, contentText: 'x'.repeat(900), occurredAtMs: 1 },
          { kind: 'write', pinId: 'w2', path: null, contentText: 'y'.repeat(900), occurredAtMs: 2 },
        ],
        summarizedToday: 0,
      },
    },
    applied,
  })
  const outcomes = await plugin.runChainHistorySummaryTick({ run, llm })
  assert.equal(outcomes[0].done, 1)
  assert.equal(outcomes[0].failed, 1)
  assert.deepEqual(applied, [
    { kind: 'write', pinId: 'w1', outcome: 'failed' },
    { kind: 'write', pinId: 'w2', outcome: 'done', summary: 'gist' },
  ])
})

test('bots whose pending fetch fails are skipped with the CLI error as reason', async () => {
  const llm = fakeLlm()
  const run = fakeRun({
    profiles: [{ slug: 'alice', dshLlmProvider: 'p', dshLlmModel: 'm' }],
    pendingBySlug: { alice: new Error('pending exploded') },
    applied: [],
  })
  const outcomes = await plugin.runChainHistorySummaryTick({ run, llm })
  assert.equal(outcomes[0].skipped, 'pending exploded')
  assert.equal(llm.requests.length, 0)
})

test('applyChainHistorySummaryScheduler mounts nothing when disabled or llm is missing', () => {
  const effects = []
  const ctx = { llm: fakeLlm(), effect: (fn, label) => { effects.push(label) } }
  plugin.applyChainHistorySummaryScheduler(ctx, { enabled: false })
  assert.deepEqual(effects, [])
  plugin.applyChainHistorySummaryScheduler({ effect: (fn, label) => { effects.push(label) } }, {})
  assert.deepEqual(effects, [])
})

test('applyChainHistorySummaryScheduler logs per-bot outcomes after the boot tick', async (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  t.after(() => mock.timers.reset())
  const warnings = []
  const infos = []
  const llm = fakeLlm()
  const applied = []
  const run = fakeRun({
    profiles: [
      { slug: 'alice', dshLlmProvider: 'p', dshLlmModel: 'm' },
      { slug: 'nollm' },
    ],
    pendingBySlug: { alice: { items: [WRITE_ITEM], summarizedToday: 0 } },
    applied,
  })
  let onTick
  const ticked = new Promise((resolve) => { onTick = resolve })
  const ctx = {
    llm,
    logger: { warn: (message) => warnings.push(message), info: (message) => infos.push(message) },
    effect: (fn) => { fn() },
  }
  plugin.applyChainHistorySummaryScheduler(ctx, { run, llm, onTick })
  mock.timers.tick(20_000) // fire the boot pass
  const outcomes = await ticked
  assert.equal(outcomes.find((outcome) => outcome.slug === 'alice').done, 1)
  assert.equal(outcomes.find((outcome) => outcome.slug === 'nollm').skipped, 'no DSH LLM configured on Bot')
  assert.deepEqual(warnings, [])
  assert.ok(infos.some((message) => message.startsWith('[oac-dsh] chain-history summary:')
    && message.includes('alice') && message.includes('summarized 1')))
  assert.ok(infos.some((message) => message.startsWith('[oac-dsh] chain-history summary:')
    && message.includes('nollm') && message.includes('no DSH LLM configured on Bot')))
})

test('provider prompt carries the kind lead line, context, and content', async () => {
  const llm = fakeLlm('gist')
  const provider = plugin.createDshLlmSummarizerProvider(llm, { provider: 'p', model: 'm' })

  await provider.summarize({ kind: 'write', title: null, path: '/protocols/simplenote', content: 'WRITE_CONTENT' })
  assert.ok(systemText(llm.requests[0]).includes('compact memory notes'))
  assert.ok(systemText(llm.requests[0]).includes('SAME language as the content'))
  assert.ok(userText(llm.requests[0]).startsWith('You published the following content on-chain (path: /protocols/simplenote):'))
  assert.ok(userText(llm.requests[0]).includes('<content>\nWRITE_CONTENT\n</content>'))
  assert.ok(userText(llm.requests[0]).endsWith('Summarize what you published.'))

  await provider.summarize({ kind: 'read', title: 'T', path: '/p', content: 'READ_CONTENT' })
  assert.ok(userText(llm.requests[1]).startsWith('You read the following on-chain content (title: T, path: /p):'))
  assert.ok(userText(llm.requests[1]).includes('<content>\nREAD_CONTENT\n</content>'))
  assert.ok(userText(llm.requests[1]).endsWith('Summarize the central idea of what you read.'))

  // No context suffix when neither title nor path is present.
  await provider.summarize({ kind: 'write', title: null, path: null, content: 'C' })
  assert.ok(userText(llm.requests[2]).startsWith('You published the following content on-chain:'))
})

test('provider trims the output and caps it at 500 chars', async () => {
  const llm = fakeLlm(`  ${'x'.repeat(600)}  `)
  const provider = plugin.createDshLlmSummarizerProvider(llm, { provider: 'p', model: 'm' })
  const summary = await provider.summarize({ kind: 'write', title: null, path: null, content: 'c' })
  assert.equal(summary.length, 500)
  assert.equal(summary, 'x'.repeat(500))
})

test('provider surfaces the primary error when no fallback brain is configured', async () => {
  const llm = failingLlm('primary down')
  const provider = plugin.createDshLlmSummarizerProvider(llm, { provider: 'p', model: 'm' })
  await assert.rejects(provider.summarize({ kind: 'write', title: null, path: null, content: 'c' }), /primary down/)
  assert.equal(llm.requests.length, 1)
})
