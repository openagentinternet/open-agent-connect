import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const plugin = await import('../lib/index.js')

const FIXTURE_COMPOSITION = `# fixture standard preset (test double, DSH 0.1.5 persona split)
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    suffix: Your working directory is {{cwd}}.
    prefix: >-
      You are a coding agent powered by the {{model}} model.
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

test('isBotRegistryPath: the manager index and per-profile state files only', () => {
  assert.equal(plugin.isBotRegistryPath('manager/identity-profiles.json'), true)
  assert.equal(plugin.isBotRegistryPath('profiles/alice/.runtime/bot-role.json'), true)
  assert.equal(plugin.isBotRegistryPath('profiles/alice/.runtime/dsh-llm.json'), true)
  assert.equal(plugin.isBotRegistryPath('profiles\\alice\\.runtime\\dsh-llm.json'), true)
  // Conversation stores, memory, dream, and owner files must not refresh pickers.
  assert.equal(plugin.isBotRegistryPath('profiles/alice/.runtime/a2a/chat-peer1.json'), false)
  assert.equal(plugin.isBotRegistryPath('profiles/alice/.runtime/grouptask/store.json'), false)
  assert.equal(plugin.isBotRegistryPath('profiles/alice/memory/entries.json'), false)
  assert.equal(plugin.isBotRegistryPath('owner/llm-relay.json'), false)
  assert.equal(plugin.isBotRegistryPath('manager/other.json'), false)
  assert.equal(plugin.isBotRegistryPath(''), false)
})

test('BotChangeEventHub: notify reaches clients, unsubscribe stops delivery, a throwing client does not break others', () => {
  const hub = new plugin.BotChangeEventHub()
  const frames = []
  const stop = hub.addClient((frame) => frames.push(frame))
  hub.addClient(() => { throw new Error('dead client') })
  hub.notify()
  assert.deepEqual(frames, [{ event: 'bots-changed', data: {} }])
  stop()
  hub.notify()
  assert.equal(frames.length, 1)
})

function fakeStream() {
  const frames = []
  const res = {
    headers: null,
    ended: false,
    writeHead(status, headers) {
      this.headers = { status, headers }
    },
    write(chunk) {
      frames.push(chunk)
    },
    end() {
      this.ended = true
    },
  }
  const listeners = {}
  const req = {
    on(event, fn) {
      listeners[event] = fn
    },
  }
  return { req, res, frames, listeners }
}

test('streamBotEvents: SSE headers, retry line, bots-changed frames, close unsubscribes', () => {
  const hub = new plugin.BotChangeEventHub()
  const { req, res, frames, listeners } = fakeStream()
  plugin.streamBotEvents(req, res, hub)
  assert.equal(res.headers.status, 200)
  assert.equal(res.headers.headers['content-type'], 'text/event-stream; charset=utf-8')
  assert.deepEqual(frames, ['retry: 3000\n\n'])
  hub.notify()
  assert.deepEqual(frames, ['retry: 3000\n\n', 'event: bots-changed\ndata: {}\n\n'])
  listeners.close()
  assert.equal(res.ended, true)
  hub.notify()
  assert.equal(frames.length, 2)
})

function createMockAgentPresets(rootDir) {
  const calls = { copy: [], remove: [] }
  const agentPresets = {
    async copy(from, id, name) {
      calls.copy.push({ from, id, ...(name !== undefined ? { name } : {}) })
      const dir = join(rootDir, '.agent-presets', id)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'agent.cordis.yml'), FIXTURE_COMPOSITION, 'utf8')
    },
    async remove(id) {
      calls.remove.push(id)
    },
    async list() {
      return []
    },
  }
  return { agentPresets, calls }
}

const pollUntil = async (probe, timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (probe()) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return probe()
}

async function withRegistryRoot(run) {
  const tmp = await mkdtemp(join(tmpdir(), 'oac-dsh-botevents-'))
  await mkdir(join(tmp, 'manager'), { recursive: true })
  await writeFile(join(tmp, 'manager', 'identity-profiles.json'), '{}\n', 'utf8')
  await mkdir(join(tmp, 'profiles', 'twin', '.runtime'), { recursive: true })
  await writeFile(join(tmp, 'profiles', 'twin', '.runtime', 'bot-role.json'), '{}\n', 'utf8')
  try {
    await run(tmp)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

/**
 * Same tree shape but without any registry-matching files: darwin fs.watch
 * can flush writes that happened just before the watcher started, so the
 * negative test must not plant matching paths in its own fixture.
 */
async function withBareRegistryRoot(run) {
  const tmp = await mkdtemp(join(tmpdir(), 'oac-dsh-botevents-'))
  await mkdir(join(tmp, 'manager'), { recursive: true })
  await mkdir(join(tmp, 'profiles', 'twin', '.runtime'), { recursive: true })
  try {
    await run(tmp)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

test('watchBotRegistry: a bot-state write reconciles presets and notifies (debounced)', async () => {
  await withRegistryRoot(async (tmp) => {
    const mock = createMockAgentPresets(tmp)
    const ctx = { agentPresets: mock.agentPresets }
    const hub = new plugin.BotChangeEventHub()
    let notifications = 0
    hub.addClient(() => { notifications += 1 })
    const stop = plugin.watchBotRegistry(ctx, hub, {
      metabotRoot: () => tmp,
      profilesRoot: () => join(tmp, 'profiles'),
      debounceMs: 60,
      listBots: async () => ({ ok: true, state: 'success', data: { profiles: [makeBot()] } }),
    })
    try {
      await writeFile(join(tmp, 'profiles', 'twin', '.runtime', 'bot-role.json'), '{"isAvailable":false}\n', 'utf8')
      assert.equal(await pollUntil(() => notifications > 0, 3000), true, 'hub notified after the state write')
      assert.equal(await pollUntil(() => mock.calls.copy.length > 0, 1000), true, 'reconcile registered the Bot preset')
      assert.deepEqual(mock.calls.copy, [{ from: 'standard', id: 'oac-alice', name: 'Alice' }])
    } finally {
      stop()
    }
  })
})

test('watchBotRegistry: irrelevant profile writes do not notify', async () => {
  await withBareRegistryRoot(async (tmp) => {
    const mock = createMockAgentPresets(tmp)
    const ctx = { agentPresets: mock.agentPresets }
    const hub = new plugin.BotChangeEventHub()
    let notifications = 0
    hub.addClient(() => { notifications += 1 })
    const stop = plugin.watchBotRegistry(ctx, hub, {
      metabotRoot: () => tmp,
      profilesRoot: () => join(tmp, 'profiles'),
      debounceMs: 60,
      listBots: async () => ({ ok: true, state: 'success', data: { profiles: [makeBot()] } }),
    })
    try {
      await mkdir(join(tmp, 'profiles', 'twin', 'memory'), { recursive: true })
      await writeFile(join(tmp, 'profiles', 'twin', 'memory', 'entries.json'), '[]\n', 'utf8')
      await writeFile(join(tmp, 'manager', 'unrelated.json'), '[]\n', 'utf8')
      await new Promise((resolve) => setTimeout(resolve, 300))
      assert.equal(notifications, 0)
      assert.equal(mock.calls.copy.length, 0)
    } finally {
      stop()
    }
  })
})

test('watchBotRegistry: a failing reconcile still notifies (the Bot set changed)', async () => {
  await withRegistryRoot(async (tmp) => {
    const warnings = []
    const ctx = {
      agentPresets: {
        async copy() {
          throw new Error('preset backend down')
        },
        async remove() {},
        async list() {
          return []
        },
      },
      logger: { warn: (message) => warnings.push(message) },
    }
    const hub = new plugin.BotChangeEventHub()
    let notifications = 0
    hub.addClient(() => { notifications += 1 })
    const stop = plugin.watchBotRegistry(ctx, hub, {
      metabotRoot: () => tmp,
      profilesRoot: () => join(tmp, 'profiles'),
      debounceMs: 60,
      listBots: async () => ({ ok: true, state: 'success', data: { profiles: [makeBot()] } }),
    })
    try {
      await writeFile(join(tmp, 'manager', 'identity-profiles.json'), '{"profiles":[]}\n', 'utf8')
      assert.equal(await pollUntil(() => notifications > 0, 3000), true, 'notify fires despite the reconcile failure')
      assert.equal(warnings.some((line) => line.includes('bot registry reconcile failed')), true)
    } finally {
      stop()
    }
  })
})

test('client bot-catalog: pickers subscribe to the bots-changed feed', async () => {
  const { readFile } = await import('node:fs/promises')
  const catalog = await readFile(join(import.meta.dirname, '..', 'src', 'client', 'bot-catalog.ts'), 'utf8')
  assert.ok(catalog.includes('/oac/api/bots/events'), 'one shared EventSource on the host feed')
  assert.ok(catalog.includes('bots-changed'), 'listens for bots-changed frames')
  // Every picker that fetches its own list refetches on a revision bump.
  for (const file of ['A2AConversation.tsx', 'AppsPanel.tsx', 'ConvTabs.tsx', 'ServicesPanel.tsx', 'MemoryPanel.tsx', 'BotPanel.tsx']) {
    const source = await readFile(join(import.meta.dirname, '..', 'src', 'client', file), 'utf8')
    assert.ok(source.includes('useBotsRevision'), `${file} refetches on bots-changed`)
  }
  const seat = await readFile(join(import.meta.dirname, '..', 'src', 'client', 'index.ts'), 'utf8')
  assert.ok(seat.includes('subscribeToBotChanges'), 'the preset-seat controller reloads on bots-changed')
})

test('host index: bots mutation routes notify the bot hub', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(join(import.meta.dirname, '..', 'src', 'index.ts'), 'utf8')
  assert.ok(source.includes("method === 'bots/events'"), 'the bots/events SSE route is mounted')
  for (const method of ['bots/create', 'bots/update', 'bots/delete']) {
    const at = source.indexOf(`method === '${method}'`)
    assert.ok(at > 0, `${method} handled`)
    const next = source.indexOf('botHub.notify()', at)
    assert.ok(next > 0 && next - at < 700, `${method} notifies the hub on success`)
  }
})
