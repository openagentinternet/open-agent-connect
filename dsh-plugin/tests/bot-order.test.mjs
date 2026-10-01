import assert from 'node:assert/strict'
import test from 'node:test'

const plugin = await import('../lib/index.js')

test('sortBotsTwinFirst keeps the Twin Bot first even when it is the newest profile', () => {
  const rows = [
    { slug: 'worker-new', createdAt: 300, botType: 'worker' },
    { slug: 'twin', createdAt: 200, botType: 'twin' },
    { slug: 'worker-old', createdAt: 100, botType: 'worker' },
  ]
  assert.deepEqual(
    plugin.sortBotsTwinFirst(rows).map((row) => row.slug),
    ['twin', 'worker-old', 'worker-new'],
  )
})

test('sortBotsTwinFirst orders workers oldest-first and treats a missing botType as worker', () => {
  const rows = [
    { slug: 'b', createdAt: 20 },
    { slug: 'a', createdAt: 10, botType: null },
    { slug: 'twin', createdAt: 5, botType: 'twin' },
  ]
  assert.deepEqual(
    plugin.sortBotsTwinFirst(rows).map((row) => row.slug),
    ['twin', 'a', 'b'],
  )
})

test('sortAvailableBotsTwinFirst drops unavailable Bots, Twin first, then oldest-first', () => {
  const llm = { dshLlmProvider: 'p', dshLlmModel: 'm' }
  const rows = [
    { slug: 'worker-new', createdAt: 300, botType: 'worker', ...llm },
    { slug: 'twin', createdAt: 200, botType: 'twin', ...llm },
    { slug: 'worker-off', createdAt: 50, botType: 'worker', isAvailable: false, ...llm },
    { slug: 'worker-nollm', createdAt: 100, botType: 'worker' },
    { slug: 'worker-old', createdAt: 150, botType: 'worker', ...llm },
  ]
  assert.deepEqual(
    plugin.sortAvailableBotsTwinFirst(rows).map((row) => row.slug),
    ['twin', 'worker-old', 'worker-new'],
  )
  // Input not mutated.
  assert.equal(rows.length, 5)
})

test('pickDefaultAvailableBotSlug picks the available Twin, then the first available', () => {
  const llm = { dshLlmProvider: 'p', dshLlmModel: 'm' }
  assert.equal(plugin.pickDefaultAvailableBotSlug([
    { slug: 'w1', ...llm },
    { slug: 'twin', botType: 'twin', ...llm },
  ]), 'twin')
  // An unavailable Twin is skipped.
  assert.equal(plugin.pickDefaultAvailableBotSlug([
    { slug: 'twin-off', botType: 'twin', isAvailable: false, ...llm },
    { slug: 'w1', ...llm },
  ]), 'w1')
  assert.equal(plugin.pickDefaultAvailableBotSlug([{ slug: 'w1', isAvailable: false, ...llm }]), '')
  assert.equal(plugin.pickDefaultAvailableBotSlug([]), '')
})

test('sortBotsTwinFirst does not mutate the input array', () => {
  const rows = [
    { slug: 'worker', createdAt: 10, botType: 'worker' },
    { slug: 'twin', createdAt: 20, botType: 'twin' },
  ]
  const sorted = plugin.sortBotsTwinFirst(rows)
  assert.deepEqual(rows.map((row) => row.slug), ['worker', 'twin'])
  assert.notEqual(sorted, rows)
})
