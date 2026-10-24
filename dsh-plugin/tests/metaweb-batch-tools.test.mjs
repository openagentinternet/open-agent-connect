import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Pin the in-process core loader to THIS repo's dist before the plugin loads
// any core module: resolveLocalCliPath prefers env.OAC_METABOT_CLI_PATH, and
// without it machines with a global npm open-agent-connect resolve core()
// against that older runtime (which has no pinBatchRead). Keeping the test on
// the repo dist makes it deterministic regardless of machine globals.
process.env.OAC_METABOT_CLI_PATH = new URL('../../dist/cli/main.js', import.meta.url).pathname

const plugin = await import('../lib/metaweb-tools.js')

function fakeHostContext(overrides = {}) {
  const tools = []
  return {
    tools,
    ctx: {
      tools: { register: (definition) => tools.push(definition) },
      logger: { warn: () => undefined },
      ...overrides,
    },
  }
}

function batchPin(pinId, text, overrides = {}) {
  return {
    pinId,
    currentPinId: pinId,
    protocol: 'simplenote',
    path: '/protocols/simplenote',
    chainName: 'mvc',
    operation: 'create',
    creator: { globalMetaId: 'gm-author', metaid: 'meta-1', name: 'Author', address: '' },
    createdAt: 1,
    contentType: 'text/markdown',
    payload: null,
    text,
    truncated: false,
    totalLength: text.length,
    meta: { title: `Note ${pinId}`, summary: 's', tags: [] },
    attachments: [],
    source: 'local',
    version: { latest: pinId, count: 1 },
    ...overrides,
  }
}

function fakeRecordingRun(runCalls) {
  return async (args) => {
    const file = args[args.indexOf('--payload-file') + 1]
    const payload = file ? JSON.parse(readFileSync(file, 'utf8')) : undefined
    runCalls.push({ args, payload })
    return { ok: true, state: 'success', data: { recorded: true } }
  }
}

// The chain-history recording is fire-and-forget through mkdtemp+writeFile
// before run(), so poll briefly for the expected calls instead of a single
// microtask flush.
async function waitFor(condition, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function findBatchTool(host) {
  return host.tools.find((tool) => tool.name === 'read_metaweb_pins_batch')
}

test('read_metaweb_pins_batch registers alongside the existing metaweb tools', () => {
  const host = fakeHostContext()
  plugin.bindMetawebToolInstall(host.ctx)
  const tool = findBatchTool(host)
  assert.ok(tool, 'batch tool registered')
  assert.match(tool.description, /Read up to 50 MetaWeb pins in ONE call/)
  assert.match(tool.description, /RECEIPT read_metaweb_pins_batch/)
  assert.match(tool.description, /requested\/readable_upstream\/returned\/omitted\/truncation_points\/bytes_written\/caliber/)
  assert.match(tool.description, /null content means encrypted\/empty — skip/)
})

test('read_metaweb_pins_batch validates the pin list before any fetch', async () => {
  const host = fakeHostContext()
  let fetched = 0
  const tool = plugin.buildMetawebToolDefinitions({
    host: host.ctx,
    hostAgent: { ctx: host.ctx },
    readPinsBatch: async () => { fetched += 1; return {} },
  }).find((definition) => definition.name === 'read_metaweb_pins_batch')

  const empty = await tool.execute({ pinIds: [] }, {})
  assert.match(empty, /read_metaweb_pins_batch failed: at least one pinId/)
  const tooMany = await tool.execute({ pinIds: Array.from({ length: 51 }, (_, i) => `p${i}`) }, {})
  assert.match(tooMany, /read_metaweb_pins_batch failed: at most 50 pinIds per call \(got 51\)/)
  assert.equal(fetched, 0)
})

test('read_metaweb_pins_batch renders the budget receipt and records delivered reads', async () => {
  const runCalls = []
  const host = fakeHostContext({ agentPresets: { composedPreset: () => 'oac-alice' } })
  const entries = {
    ok1: batchPin('ok1', 'first delivered body'),
    ok2: batchPin('ok2', 'second delivered body'),
    bad: { pinId: 'bad', error: 'pin not found' },
  }
  const tool = plugin.buildMetawebToolDefinitions({
    host: host.ctx,
    hostAgent: { ctx: host.ctx },
    run: fakeRecordingRun(runCalls),
    readPinsBatch: async (pinIds, options) => {
      assert.deepEqual(pinIds, ['ok1', 'ok2', 'bad'])
      assert.equal(options.baseUrl, undefined, 'default options carry no override')
      return entries
    },
  }).find((definition) => definition.name === 'read_metaweb_pins_batch')

  const text = await tool.execute({ pinIds: ['ok1', 'ok2', 'bad'] }, {})
  await waitFor(() => runCalls.length === 2)

  assert.match(text, /^2\/3 pin\(s\) readable in this batch:/)
  assert.match(text, /## bad\n- error: pin not found/)
  assert.ok(text.includes('<metaweb_pin_content>\nfirst delivered body\n</metaweb_pin_content>'))
  const receiptLine = text.split('\n').find((line) => line.startsWith('- RECEIPT read_metaweb_pins_batch: '))
  assert.ok(receiptLine, 'machine-readable receipt present')
  const parsed = JSON.parse(receiptLine.slice('- RECEIPT read_metaweb_pins_batch: '.length))
  assert.equal(parsed.requested, 3)
  assert.equal(parsed.readable_upstream, 2)
  assert.equal(parsed.returned, 2)
  assert.equal(parsed.unreadable, 1)
  assert.deepEqual(parsed.unreadable_ids, ['bad'])
  assert.equal(parsed.bytes_written, Buffer.byteLength(text, 'utf8'), 'bytes_written is a fixed point')

  // Only DELIVERED bodies are recorded into the chain-history ledger.
  assert.equal(runCalls.length, 2)
  for (const call of runCalls) {
    assert.deepEqual(call.args.slice(0, 5), ['chainhistory', 'read', 'record', '--from', 'alice'])
    assert.equal(call.payload.source, 'read_metaweb_pins_batch')
  }
  assert.deepEqual(runCalls.map((call) => call.payload.pinId).sort(), ['ok1', 'ok2'])
})

test('read_metaweb_pins_batch surfaces upstream fetch failures as tool errors', async () => {
  const host = fakeHostContext()
  const tool = plugin.buildMetawebToolDefinitions({
    host: host.ctx,
    hostAgent: { ctx: host.ctx },
    readPinsBatch: async () => {
      throw new Error('MetaWeb pins-batch API timed out after 10s — try again later.')
    },
  }).find((definition) => definition.name === 'read_metaweb_pins_batch')
  const err = await tool.execute({ pinIds: ['p1'] }, {})
  assert.match(err, /read_metaweb_pins_batch failed: MetaWeb pins-batch API timed out after 10s/)
})
