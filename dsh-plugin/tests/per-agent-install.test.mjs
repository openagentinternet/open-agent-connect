import assert from 'node:assert/strict'
import test from 'node:test'

const { createPerAgentInstaller } = await import('../lib/per-agent-install.js')

const MEMORY_FAMILY = [
  'memory_user_edits',
  'experience_recall',
  'recent_chats',
  'conversation_search',
  'oac_session_read_all',
  'oac_session_read_latest',
  'chain_history_recall',
]
const TWIN_FAMILY = [
  'local_workers_list',
  'local_worker_delegate',
  'twin_task_status',
  'twin_task_reassign',
  'twin_task_cancel',
  'worker_session_stop',
  'oac_session_insert_user_message',
  'group_task',
]

function fakeAgent(sessionId = 'sess-1') {
  const tools = []
  const sections = []
  return {
    tools,
    sections,
    ctx: {
      tools: { register: (definition) => { tools.push(definition.name) } },
      systemPrompt: { section: (section) => { sections.push(section.name) } },
    },
    session: { id: sessionId },
  }
}

function fakeCtx(preset) {
  return {
    agentPresets: {
      composedPreset: () => (preset instanceof Error ? (() => { throw preset })() : preset),
    },
  }
}

function makeInstaller({ preset = 'oac-bob', botType = 'twin', ctx } = {}) {
  const logs = []
  const liveOacAgents = new Map()
  const notifiedBacklogs = new Set(['bob'])
  const installer = createPerAgentInstaller(ctx ?? fakeCtx(preset), {
    twinEnabled: true,
    liveOacAgents,
    notifiedBacklogs,
    log: (message) => logs.push(message),
    botTypeOf: async () => botType,
  })
  return { installer, logs, liveOacAgents }
}

async function flush() {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

test('agent/created with a non-oac preset (global default "oac") logs visibly and installs nothing', async () => {
  const { installer, logs } = makeInstaller({ preset: 'oac' })
  const agent = fakeAgent()
  installer.handleAgentCreated(agent)
  await flush()
  assert.deepEqual(agent.tools, [])
  assert.equal(logs.length, 1)
  assert.match(logs[0], /agent\/created/)
  assert.match(logs[0], /"oac"/)
  assert.match(logs[0], /agent-preset\/selected|selects an oac-\* preset/)
})

test('late agent-preset/selected installs the full per-agent toolset on the same session', async () => {
  const { installer, liveOacAgents } = makeInstaller({ preset: 'oac', botType: 'twin' })
  const agent = fakeAgent('sess-42')
  installer.handleAgentCreated(agent)
  await flush()
  assert.deepEqual(agent.tools, [])

  installer.handlePresetSelected(
    { id: 'sess-42' },
    { type: 'agent-preset/selected', data: { agentPreset: 'oac-bob' } },
  )
  await flush()
  for (const name of [...MEMORY_FAMILY, ...TWIN_FAMILY]) {
    assert.ok(agent.tools.includes(name), `missing tool ${name}`)
  }
  assert.equal(liveOacAgents.get('bob'), agent)
})

test('non-twin Bots get the memory family only, twin family stays absent', async () => {
  const { installer } = makeInstaller({ preset: 'oac-bob', botType: 'worker' })
  const agent = fakeAgent()
  installer.handleAgentCreated(agent)
  await flush()
  for (const name of MEMORY_FAMILY) {
    assert.ok(agent.tools.includes(name), `missing tool ${name}`)
  }
  for (const name of TWIN_FAMILY) {
    assert.ok(!agent.tools.includes(name), `unexpected tool ${name}`)
  }
})

test('installation is idempotent across created + repeated selection events', async () => {
  const { installer } = makeInstaller({ preset: 'oac-bob', botType: 'twin' })
  const agent = fakeAgent('sess-7')
  installer.handleAgentCreated(agent)
  await flush()
  installer.handlePresetSelected({ id: 'sess-7' }, { type: 'agent-preset/selected', data: { agentPreset: 'oac-bob' } })
  installer.handlePresetSelected({ id: 'sess-7' }, { type: 'agent-preset/selected', data: { agentPreset: 'oac-bob' } })
  await flush()
  const unique = new Set(agent.tools)
  assert.equal(agent.tools.length, unique.size, `duplicate registrations: ${agent.tools.join(',')}`)
  for (const name of [...MEMORY_FAMILY, ...TWIN_FAMILY]) {
    assert.ok(unique.has(name), `missing tool ${name}`)
  }
})

test('a throwing composedPreset is logged, not swallowed, and later selection still installs', async () => {
  const ctx = {
    agentPresets: {
      composedPreset: () => { throw new Error('preset boom') },
    },
  }
  const { installer, logs } = makeInstaller({ ctx, botType: 'twin' })
  const agent = fakeAgent('sess-9')
  installer.handleAgentCreated(agent)
  await flush()
  assert.ok(logs.some((line) => line.includes('preset boom')), `expected the error in logs: ${logs.join(' | ')}`)
  assert.deepEqual(agent.tools, [])

  installer.handlePresetSelected({ id: 'sess-9' }, { type: 'agent-preset/selected', data: { agentPreset: 'oac-bob' } })
  await flush()
  for (const name of [...MEMORY_FAMILY, ...TWIN_FAMILY]) {
    assert.ok(agent.tools.includes(name), `missing tool ${name}`)
  }
})

test('agent/disposed drops the live-agent mapping', async () => {
  const { installer, liveOacAgents } = makeInstaller({ preset: 'oac-bob' })
  const agent = fakeAgent()
  installer.handleAgentCreated(agent)
  await flush()
  assert.equal(liveOacAgents.get('bob'), agent)
  installer.handleAgentDisposed(agent)
  assert.equal(liveOacAgents.get('bob'), undefined)
})

test('oac-* selection with no matching live agent logs instead of failing silently', async () => {
  const { installer, logs } = makeInstaller({ preset: 'standard' })
  installer.handlePresetSelected({ id: 'sess-missing' }, { type: 'agent-preset/selected', data: { agentPreset: 'oac-bob' } })
  await flush()
  assert.ok(logs.some((line) => line.includes('no live agent')), `expected a no-agent log: ${logs.join(' | ')}`)
})
