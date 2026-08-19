import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const plugin = await import('../lib/index.js')

test('validateCreatePayload requires name and DSH provider/model', () => {
  assert.equal(plugin.validateCreatePayload({}).ok, false)
  assert.equal(plugin.validateCreatePayload({ name: 'Alice' }).ok, false)
  assert.equal(plugin.validateCreatePayload({
    name: 'Alice',
    dshLlmProvider: 'deepseek',
  }).ok, false)
  const ok = plugin.validateCreatePayload({
    name: 'Alice',
    dshLlmProvider: 'deepseek',
    dshLlmModel: 'v3',
  })
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.equal(ok.value.name, 'Alice')
    assert.equal(ok.value.dshLlmProvider, 'deepseek')
    assert.equal(ok.value.dshLlmModel, 'v3')
  }
})

test('validateCreatePayload requires fallback provider and model together', () => {
  const half = plugin.validateCreatePayload({
    name: 'Alice',
    dshLlmProvider: 'deepseek',
    dshLlmModel: 'v3',
    dshLlmFallbackProvider: 'other',
  })
  assert.equal(half.ok, false)
  if (!half.ok) assert.equal(half.code, 'invalid_dsh_llm_fallback')
})

test('createBot does not spawn CLI when name or provider is missing', async () => {
  const calls = []
  const result = await plugin.createBot(
    { agentPresets: { copy: async () => {}, remove: async () => {}, list: async () => [] } },
    { name: 'Alice' },
    async (args) => {
      calls.push(args)
      return { ok: true, state: 'success', data: {} }
    },
  )
  assert.equal(result.ok, false)
  assert.equal(result.code, 'missing_dsh_llm')
  assert.deepEqual(calls, [])
})

test('createBot passes --host dsh and DSH LLM flags then generates preset', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'oac-dsh-create-'))
  const copies = []
  const calls = []
  const ctx = {
    agentPresets: {
      async copy(from, id, name) {
        copies.push({ from, id, name })
        const dir = join(tmp, '.agent-presets', id)
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, 'agent.cordis.yml'), '- id: persona\n  config:\n    text: old\n', 'utf8')
        await writeFile(join(dir, 'preset.yml'), 'name: Standard\n', 'utf8')
      },
      remove: async () => {},
      list: async () => [],
    },
    dshHomePath: (...segments) => join(tmp, ...segments),
  }
  try {
    const result = await plugin.createBot(
      ctx,
      { name: 'Alice', dshLlmProvider: 'deepseek', dshLlmModel: 'v3' },
      async (args) => {
        calls.push(args)
        return {
          ok: true,
          state: 'success',
          data: { profile: { name: 'Alice', slug: 'alice', globalMetaId: 'idq1' } },
        }
      },
    )
    assert.equal(result.ok, true)
    assert.deepEqual(calls[0], [
      'bot', 'create',
      '--name', 'Alice',
      '--host', 'dsh',
      '--dsh-llm-provider', 'deepseek',
      '--dsh-llm-model', 'v3',
    ])
    assert.equal(copies.length, 1)
    assert.equal(copies[0].id, 'oac-alice')
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('deleteBot calls CLI --confirm then removes the preset', async () => {
  const removed = []
  const calls = []
  const ctx = {
    agentPresets: {
      copy: async () => {},
      remove: async (id) => { removed.push(id) },
      list: async () => [{ id: 'oac-alice' }],
    },
  }
  const result = await plugin.deleteBot(ctx, 'alice', async (args) => {
    calls.push(args)
    return { ok: true, state: 'success', data: { slug: 'alice' } }
  })
  assert.equal(result.ok, true)
  assert.deepEqual(calls, [['bot', 'delete', '--from', 'alice', '--confirm']])
  assert.deepEqual(removed, ['oac-alice'])
})

test('deleteBot does not remove the preset when CLI refuses', async () => {
  const removed = []
  const result = await plugin.deleteBot(
    {
      agentPresets: {
        copy: async () => {},
        remove: async (id) => { removed.push(id) },
        list: async () => [],
      },
    },
    'alice',
    async () => ({ ok: false, state: 'failed', code: 'confirmation_required', message: 'need --confirm' }),
  )
  assert.equal(result.ok, false)
  assert.deepEqual(removed, [])
})
