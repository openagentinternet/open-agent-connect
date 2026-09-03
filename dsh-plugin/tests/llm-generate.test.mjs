import assert from 'node:assert/strict'
import test from 'node:test'

const { generateLlmText } = await import('../lib/llm-generate.js')

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
