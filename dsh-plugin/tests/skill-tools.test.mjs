import assert from 'node:assert/strict'
import test from 'node:test'

const plugin = await import('../lib/skill-tools.js')

function fakeHostContext(overrides = {}) {
  const sections = []
  const tools = []
  return {
    sections,
    tools,
    ctx: {
      systemPrompt: { section: (input) => sections.push(input) },
      tools: { register: (definition) => tools.push(definition) },
      logger: { warn: () => undefined },
      ...overrides,
    },
  }
}

function successEnvelope(data) {
  return { ok: true, state: 'success', data }
}

test('bindSkillToolInstall registers the learning-loop section and skill_tool', () => {
  const host = fakeHostContext()
  plugin.bindSkillToolInstall(host.ctx)
  assert.equal(host.sections.length, 1)
  assert.equal(host.sections[0].name, 'oac:metaweb-learning-loop')
  assert.equal(host.sections[0].order, 143)
  assert.match(host.sections[0].text, /## Learning from MetaWeb tutorials/)
  assert.match(host.sections[0].text, /skill_tool install_skill/)
  assert.deepEqual(host.tools.map((tool) => tool.name), ['skill_tool'])
})

async function skillToolWith(overrides = {}) {
  const host = fakeHostContext({ approval: overrides.approval })
  const calls = []
  const run = async (args, options) => {
    calls.push({ args, options })
    return overrides.runResult ?? successEnvelope({ formatted: 'Installed skill "x".', skill: { name: 'x' } })
  }
  const definitions = plugin.buildSkillToolDefinitions({ ctx: host.ctx, run })
  const tool = definitions.find((definition) => definition.name === 'skill_tool')
  return { tool, calls }
}

test('install_skill asks approval then runs the CLI with --confirm', async () => {
  const requests = []
  const { tool, calls } = await skillToolWith({
    approval: { request: async (req) => { requests.push(req); return 'allowed-once' } },
  })
  const result = await tool.execute({ action: 'install_skill', pinId: 'b'.repeat(64) + 'i0' }, { callId: 'c1' })

  assert.equal(requests.length, 1)
  assert.equal(requests[0].toolName, 'skill_tool')
  assert.equal(requests[0].callId, 'c1')
  assert.match(requests[0].reason, /Source pin: b{64}i0/)
  assert.deepEqual(calls[0].args, ['skills', 'install', '--pin', 'b'.repeat(64) + 'i0', '--confirm'])
  assert.match(result, /Installed skill "x"/)
  assert.match(result, /read_skill/)
})

test('install_skill maps a direct zip URI onto --uri and forwards --force', async () => {
  const { tool, calls } = await skillToolWith({
    approval: { request: async () => 'allowed-once' },
  })
  await tool.execute({ action: 'install_skill', zip: 'metafile://' + 'a'.repeat(64) + 'i0.zip', force: true }, {})
  assert.deepEqual(
    calls[0].args,
    ['skills', 'install', '--uri', 'metafile://' + 'a'.repeat(64) + 'i0.zip', '--confirm', '--force'],
  )
})

test('install_skill is refused without approval and cancelled on decline', async () => {
  const noGate = await skillToolWith({})
  const refused = await noGate.tool.execute({ action: 'install_skill', pinId: 'p' }, {})
  assert.match(refused, /refused: DSH approval is not available/)

  let ran = 0
  const host = fakeHostContext({ approval: { request: async () => 'rejected' } })
  const run = async () => { ran += 1; return successEnvelope({}) }
  const tool = plugin.buildSkillToolDefinitions({ ctx: host.ctx, run }).find((d) => d.name === 'skill_tool')
  const result = await tool.execute({ action: 'install_skill', pinId: 'p' }, {})
  assert.match(result, /cancelled by the user/)
  assert.equal(ran, 0)
})

test('install_skill skips the dialog when the session disabled approval prompts', async () => {
  const requests = []
  const host = fakeHostContext({
    approval: { request: async (req) => { requests.push(req); return 'allowed-once' } },
  })
  const run = async (args) => successEnvelope({ formatted: 'ok', skill: { name: 'x' }, args })
  const tool = plugin.buildSkillToolDefinitions({ ctx: host.ctx, run }).find((d) => d.name === 'skill_tool')
  const agent = { session: { events: [{ type: 'approval/policy', data: { policy: 'never' } }] } }
  const result = await tool.execute({ action: 'install_skill', pinId: 'p' }, { agent })
  assert.equal(requests.length, 0, 'no dialog when prompts are disabled')
  assert.match(result, /ok/)
})

test('install_skill validates its arguments', async () => {
  const { tool } = await skillToolWith({ approval: { request: async () => 'allowed-once' } })
  const missing = await tool.execute({ action: 'install_skill' }, {})
  assert.match(missing, /requires pinId/)
  const unknown = await tool.execute({ action: 'extract_metaapp' }, {})
  assert.match(unknown, /Unknown action/)
})

test('list and read actions wrap the CLI payloads', async () => {
  const { tool, calls } = await skillToolWith({
    approval: { request: async () => 'allowed-once' },
    runResult: successEnvelope({ formatted: '- **x** (1.0.0)', skill: { name: 'x' } }),
  })
  const listed = await tool.execute({ action: 'list_installed_skills' }, {})
  assert.deepEqual(calls[0].args, ['skills', 'list'])
  assert.match(listed, /\*\*x\*\*/)

  const read = await tool.execute({ action: 'read_skill', name: 'x' }, {})
  assert.deepEqual(calls[1].args, ['skills', 'read', '--name', 'x'])

  const noName = await tool.execute({ action: 'read_skill' }, {})
  assert.match(noName, /requires the installed skill name/)
})
