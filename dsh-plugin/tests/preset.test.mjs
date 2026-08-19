import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const plugin = await import('../lib/index.js')

const FIXTURE_COMPOSITION = `# fixture standard preset (test double)
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'
- id: fs-realm
  name: cordis:group
  group: true
  isolate:
    fs: true
  config:
    - id: tool-fs
      name: '@deepseek-ai/dsh-tool-fs'
`

const FIXTURE_METADATA = `name: Standard
description: fixture standard preset
order: 0
`

function makeBot(patch = {}) {
  return {
    name: 'Alice',
    slug: 'alice',
    globalMetaId: 'idq1alice',
    mvcAddress: '1abc',
    role: 'helper',
    soul: 'kind',
    goal: 'ship',
    bio: 'a bot',
    ...patch,
  }
}

function createMockAgentPresets(rootDir) {
  const calls = { copy: [], remove: [] }
  const agentPresets = {
    async copy(from, id, name) {
      const dir = join(rootDir, '.agent-presets', id)
      if (existsSync(join(dir, 'agent.cordis.yml'))) {
        throw new Error(`agent-presets: preset "${id}" already exists`)
      }
      calls.copy.push({ from, id, ...(name !== undefined ? { name } : {}) })
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'agent.cordis.yml'), FIXTURE_COMPOSITION, 'utf8')
      await writeFile(join(dir, 'preset.yml'), FIXTURE_METADATA, 'utf8')
    },
    async remove(id) {
      calls.remove.push(id)
      await rm(join(rootDir, '.agent-presets', id), { recursive: true, force: true })
    },
    async list() {
      const { readdir } = await import('node:fs/promises')
      try {
        const names = await readdir(join(rootDir, '.agent-presets'))
        return names.map((id) => ({ id }))
      } catch {
        return []
      }
    },
  }
  return { agentPresets, calls }
}

async function withPresetCtx(run) {
  const tmp = await mkdtemp(join(tmpdir(), 'oac-dsh-preset-'))
  const mock = createMockAgentPresets(tmp)
  const ctx = {
    agentPresets: mock.agentPresets,
    dshHomePath: (...segments) => join(tmp, ...segments),
    webRuntime: { trustedHosts: [] },
    webServer: { register: () => () => {} },
    effect: (fn) => { fn() },
  }
  try {
    await run(ctx, mock, tmp)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

test('buildPersonaPrompt: slug is always present and fields are XML-escaped', () => {
  const text = plugin.buildPersonaPrompt(makeBot({
    name: `A & <B> "Q" 'q'`,
    slug: 'alice',
    role: ' helper ',
    goal: '',
    bio: 'line1\nline2',
  }))
  assert.ok(text.includes('<slug>alice</slug>'))
  assert.ok(text.includes('<name>A &amp; &lt;B&gt; &quot;Q&quot; &apos;q&apos;</name>'))
  assert.ok(text.includes('<role>helper</role>'))
  assert.ok(text.includes('line1\nline2'))
  assert.ok(!text.includes('<goal>'))
  assert.ok(text.includes('--from alice'))
})

test('buildPersonaPrompt: moustaches collapse so no {{...}} group can survive', () => {
  const text = plugin.buildPersonaPrompt(makeBot({
    role: 'uses {{model}} daily',
    bio: 'open {{ only',
    goal: 'close }} only',
    soul: 'a {{ b }} c',
  }))
  assert.equal(text.includes('{{'), false)
  assert.equal(text.includes('}}'), false)
  assert.ok(text.includes('<role>uses {model} daily</role>'))
  assert.ok(text.includes('<soul>a { b } c</soul>'))
})

test('presetIdForSlug uses oac-<slug>', () => {
  assert.equal(plugin.presetIdForSlug('alice'), 'oac-alice')
  assert.equal(plugin.isOacPresetId('oac-alice'), true)
  assert.equal(plugin.isOacPresetId('standard'), false)
})

test('generatePreset: persona rewritten, !!js preserved, in-place on second save', async () => {
  await withPresetCtx(async (ctx, mock, tmp) => {
    await plugin.generatePreset(ctx, makeBot({ name: 'First Name' }))
    assert.deepEqual(mock.calls.copy, [{ from: 'standard', id: 'oac-alice', name: 'First Name' }])
    const path = join(tmp, '.agent-presets', 'oac-alice', 'agent.cordis.yml')
    const first = await readFile(path, 'utf8')
    assert.ok(first.includes('<name>First Name</name>'))
    assert.ok(first.includes('<slug>alice</slug>'))
    assert.match(first, /disabled: !!js process\.platform === 'win32'/)
    assert.equal(first.includes('{{model}}'), false)

    await plugin.generatePreset(ctx, makeBot({ name: 'Second Name' }))
    assert.equal(mock.calls.copy.length, 1, 'second save does not copy again')
    assert.deepEqual(mock.calls.remove, [])
    const second = await readFile(path, 'utf8')
    assert.ok(second.includes('<name>Second Name</name>'))
    assert.ok(!second.includes('First Name'))
    assert.match(second, /disabled: !!js process\.platform === 'win32'/)

    const metadata = await readFile(join(tmp, '.agent-presets', 'oac-alice', 'preset.yml'), 'utf8')
    assert.match(metadata, /name: Second Name/)
  })
})

test('generatePreset: a copied composition without a persona row fails loud', async () => {
  await withPresetCtx(async (ctx, mock, tmp) => {
    ctx.agentPresets = {
      ...mock.agentPresets,
      async copy(_from, id) {
        const dir = join(tmp, '.agent-presets', id)
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, 'agent.cordis.yml'), '- id: other\n  name: some/plugin\n', 'utf8')
      },
    }
    await assert.rejects(plugin.generatePreset(ctx, makeBot()), /no "persona" row/)
  })
})

test('reconcilePresets: create missing oac-* bots, remove plugin orphans, leave other presets', async () => {
  await withPresetCtx(async (ctx, mock, tmp) => {
    await mkdir(join(tmp, '.agent-presets', 'oac-gone'), { recursive: true })
    await mkdir(join(tmp, '.agent-presets', 'my-custom'), { recursive: true })
    const result = await plugin.reconcilePresets(ctx, async () => ({
      ok: true,
      state: 'success',
      data: {
        profiles: [
          makeBot({ name: 'Alice', slug: 'alice' }),
          makeBot({ name: 'Bob', slug: 'bob' }),
        ],
      },
    }))
    assert.deepEqual(result.wanted.sort(), ['oac-alice', 'oac-bob'])
    assert.deepEqual(result.removed, ['oac-gone'])
    const listed = await mock.agentPresets.list()
    const ids = listed.map((row) => row.id).sort()
    assert.deepEqual(ids, ['my-custom', 'oac-alice', 'oac-bob'])
    const alice = await readFile(join(tmp, '.agent-presets', 'oac-alice', 'agent.cordis.yml'), 'utf8')
    assert.ok(alice.includes('<slug>alice</slug>'))
  })
})

test('removePreset deletes oac-<slug> and ignores unknown ids', async () => {
  await withPresetCtx(async (ctx, mock) => {
    await plugin.generatePreset(ctx, makeBot())
    await plugin.removePreset(ctx, 'alice')
    assert.deepEqual(mock.calls.remove, ['oac-alice'])
    await plugin.removePreset(ctx, 'missing')
    assert.ok(mock.calls.remove.includes('oac-missing'))
  })
})
