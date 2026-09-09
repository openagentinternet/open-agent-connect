import assert from 'node:assert/strict'
import test from 'node:test'

const { generateLlmText, resolveDreamLlmProfile } = await import('../lib/llm-generate.js')

const baseOptions = {
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  system: 'sys',
  user: 'hi',
}

test('generateLlmText collects text deltas from a healthy stream', async () => {
  const llm = {
    stream: () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'text-delta', index: 0, text: 'hello' }
        yield { type: 'text-delta', index: 1, text: ' world' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }),
  }
  assert.equal(await generateLlmText(llm, baseOptions), 'hello world')
})

test('generateLlmText rejects a stalled stream once the idle timeout fires', async () => {
  let returned = false
  const llm = {
    stream: () => ({
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise(() => {}), // never settles: provider hang
          return: async () => {
            returned = true
            return { done: true }
          },
        }
      },
    }),
  }
  await assert.rejects(
    generateLlmText(llm, { ...baseOptions, timeoutMs: 50 }),
    /no chunk for 50ms/,
  )
  assert.equal(returned, true)
})

test('generateLlmText surfaces provider finish errors', async () => {
  const llm = {
    stream: () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'boom' } } }
      },
    }),
  }
  await assert.rejects(generateLlmText(llm, baseOptions), /boom/)
})

test('generateLlmText rejects empty completions', async () => {
  const llm = {
    stream: () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'text-delta', index: 0, text: '   ' }
      },
    }),
  }
  await assert.rejects(generateLlmText(llm, baseOptions), /empty content/)
})

test('generateLlmText ignores reasoning deltas for text on a healthy stream', async () => {
  const llm = {
    stream: () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'reasoning-delta', index: 0, text: 'thinking hard about the day '.repeat(5) }
        yield { type: 'text-delta', index: 1, text: 'the answer' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }),
  }
  assert.equal(await generateLlmText(llm, baseOptions), 'the answer')
})

test('generateLlmText names reasoning-only empty outputs so failures are actionable', async () => {
  const llm = {
    stream: () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'reasoning-delta', index: 0, text: 'thoughts'.repeat(100) }
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
      },
    }),
  }
  await assert.rejects(
    generateLlmText(llm, baseOptions),
    /empty content \(reasoning-only output: \d+ chars of thinking, finish max-tokens/,
  )
})

test('resolveDreamLlmProfile picks reasoning off and declared limits when the model reports them', async () => {
  const llm = {
    resolveModelInfo: async () => ({
      context: { contextWindow: 131072 },
      defaultMaxTokens: 32768,
      reasoning: { efforts: [{ id: 'off' }, { id: 'high' }], defaultEffort: 'high' },
    }),
  }
  assert.deepEqual(await resolveDreamLlmProfile(llm, 'deepseek-official', 'deepseek-v4-flash'), {
    reasoningEffort: 'off',
    limits: { contextWindow: 131072, maxOutputTokens: 32768 },
  })
})

test('resolveDreamLlmProfile passes no effort when off is not a declared level', async () => {
  const llm = {
    resolveModelInfo: async () => ({
      reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] },
    }),
  }
  assert.deepEqual(await resolveDreamLlmProfile(llm, 'scnet', 'some-model'), {})
})

test('resolveDreamLlmProfile degrades to empty when metadata is missing or fails', async () => {
  assert.deepEqual(await resolveDreamLlmProfile({}, 'p', 'm'), {})
  const throwing = {
    resolveModelInfo: async () => {
      throw new Error('no route')
    },
  }
  assert.deepEqual(await resolveDreamLlmProfile(throwing, 'p', 'm'), {})
})
