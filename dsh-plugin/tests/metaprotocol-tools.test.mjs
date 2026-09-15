import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// local-read's core() resolves dist modules relative to the plugin tests, so
// the built root dist (with core/metaprotocol/*) must be present — same
// requirement as qa-tools.test.mjs.
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist')
await import(path.join(distDir, 'core/metaprotocol/registry.js'))

const plugin = await import('../lib/metaprotocol-tools.js')

function fakeHost(overrides = {}) {
  const tools = []
  const sections = []
  return {
    tools,
    sections,
    ctx: {
      tools: { register: (definition) => tools.push(definition) },
      systemPrompt: { section: (spec) => sections.push(spec) },
      logger: { warn: () => undefined },
      ...overrides,
    },
  }
}

function fakeRun(result) {
  const calls = []
  const run = async (args, options) => {
    const flagIndex = args.indexOf('--request-file')
    const payload = flagIndex >= 0
      ? JSON.parse(readFileSync(args[flagIndex + 1], 'utf8'))
      : undefined
    calls.push({ args, options, payload })
    return result ?? { ok: true, state: 'success', data: { pinId: 'mp1', formatted: 'Protocol published on-chain: /protocols/myproto v1.0.0 ("My Proto").' } }
  }
  return { calls, run }
}

function makeRecordingRun(runCalls, onCall) {
  return async (args) => {
    const flag = args.includes('--payload-file') ? '--payload-file' : '--request-file'
    const file = args[args.indexOf(flag) + 1]
    const payload = JSON.parse(readFileSync(file, 'utf8'))
    runCalls.push({ args, payload })
    onCall?.()
    return { ok: true, state: 'success', data: { recorded: true } }
  }
}

/** Intercept the registry client's fetch (it reads globalThis.fetch per call). */
function fakeRegistryFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    const body = await handler(String(url))
    return {
      status: 200,
      json: async () => body,
    }
  }
  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

function envelope(data) {
  return { code: 0, data, message: 'ok' }
}

function manapiEnvelope(data) {
  return { code: 1, data, message: 'ok' }
}

function registryItem(overrides = {}) {
  return {
    protocolPath: '/protocols/simplebuzz',
    title: 'Simple Buzz',
    protocolName: 'SimpleBuzz',
    intro: 'micro posts',
    version: '1.2.0',
    chainName: 'mvc',
    pinId: 'a'.repeat(64) + 'i0',
    currentPinId: 'b'.repeat(64) + 'i0',
    createdAt: 1757000000,
    updatedAt: 1757100000,
    confirmed: true,
    author: { address: '16r', metaid: 'mid-r', globalMetaId: 'gm-registrar', name: 'Registrar' },
    conflictsCount: 0,
    ...overrides,
  }
}

test('bindMetaprotocolToolInstall registers both tools with the spec descriptions', () => {
  const host = fakeHost()
  plugin.bindMetaprotocolToolInstall(host.ctx)
  assert.deepEqual(
    host.tools.map((tool) => tool.name),
    ['metaprotocol_registry', 'post_metaprotocol'],
  )
  assert.match(host.tools[0].description, /authoritative catalog of every public protocol/)
  assert.match(host.tools[1].description, /publish: register a NEW protocol/i)
})

test('metaprotocol_registry list maps params, honors the env base URL, and renders formatter output', async () => {
  const fetchStub = fakeRegistryFetch(() => envelope({ items: [registryItem()], rejected: [], hasMore: true, nextCursor: 'cur-2' }))
  const originalEnv = process.env.METABOT_METAWEB_API_BASE_URL
  process.env.METABOT_METAWEB_API_BASE_URL = 'https://so.test'
  try {
    const host = fakeHost()
    plugin.bindMetaprotocolToolInstall(host.ctx)
    const list = host.tools.find((tool) => tool.name === 'metaprotocol_registry')
    const result = await list.execute({ action: 'list', query: 'buzz', size: 20, cursor: 'c1' }, {})
    const url = new URL(fetchStub.calls[0])
    assert.equal(url.origin, 'https://so.test')
    assert.equal(url.pathname, '/api/metaweb/protocols')
    assert.equal(url.searchParams.get('q'), 'buzz')
    assert.equal(url.searchParams.get('size'), '20')
    assert.equal(url.searchParams.get('cursor'), 'c1')
    assert.match(result, /1 registered protocol\(s\), newest registration first:/)
    assert.match(result, /Simple Buzz \(\/protocols\/simplebuzz\) — v1\.2\.0 by Registrar/)
    assert.match(result, /cursor="cur-2"/)
  } finally {
    fetchStub.restore()
    if (originalEnv === undefined) delete process.env.METABOT_METAWEB_API_BASE_URL
    else process.env.METABOT_METAWEB_API_BASE_URL = originalEnv
  }
})

test('metaprotocol_registry read wraps protocolContent as untrusted and records the deep read', async () => {
  const fetchStub = fakeRegistryFetch((url) => {
    if (url.includes('/protocols/detail')) {
      return envelope({
        record: {
          ...registryItem(),
          payload: {
            title: 'Simple Buzz',
            path: '/protocols/simplebuzz',
            version: '1.2.0',
            authors: 'Registrar',
            intro: 'micro posts',
            protocolName: 'SimpleBuzz',
            protocolAttachments: [],
            metadata: '',
            protocolContent: '{\n buzz: true\n}',
            protocolContentType: 'application/json',
          },
        },
        versions: [],
        conflicts: [],
        invalidModifies: [],
      })
    }
    throw new Error('unexpected url ' + url)
  })
  try {
    const runCalls = []
    let signal
    const seen = new Promise((resolve) => { signal = resolve })
    const host = fakeHost({ agentPresets: { composedPreset: () => 'oac-alice' } })
    const tools = plugin.buildMetaprotocolToolDefinitions({
      host: host.ctx,
      hostAgent: { ctx: {} },
      run: makeRecordingRun(runCalls, signal),
    })
    const read = tools.find((tool) => tool.name === 'metaprotocol_registry')
    const result = await read.execute(
      { action: 'read', protocolPath: '/protocols/simplebuzz' },
      { agent: { ctx: {} } },
    )
    assert.match(result, /Protocol \/protocols\/simplebuzz \(Simple Buzz\):/)
    assert.match(result, /untrusted on-chain data/)
    assert.match(result, /<metaweb_protocol_content>/)
    assert.match(result, /buzz: true/)

    // The chain-read record is fire-and-forget; wait for it to land.
    await Promise.race([
      seen,
      new Promise((_, reject) => setTimeout(() => reject(new Error('record hook did not fire')), 5_000)),
    ])
    assert.equal(runCalls.length, 1)
    assert.deepEqual(runCalls[0].args.slice(0, 6), [
      'chainhistory', 'read', 'record', '--from', 'alice', '--payload-file',
    ])
    assert.equal(runCalls[0].payload.pinId, 'b'.repeat(64) + 'i0')
    assert.equal(runCalls[0].payload.path, '/protocols/metaprotocol')
    assert.equal(runCalls[0].payload.protocol, 'metaprotocol')
    assert.equal(runCalls[0].payload.title, 'Simple Buzz')
    assert.equal(runCalls[0].payload.authorGlobalMetaId, 'gm-registrar')
    assert.equal(runCalls[0].payload.contentText, '{\n buzz: true\n}')
    assert.equal(runCalls[0].payload.source, 'metaprotocol_registry')
  } finally {
    fetchStub.restore()
  }
})

test('metaprotocol_registry read degrades to MANAPI with the degraded marker as the first line', async () => {
  const fetchStub = fakeRegistryFetch((url) => {
    if (url.includes('manapi')) {
      return manapiEnvelope({
        list: [{
          id: 'c'.repeat(64) + 'i0',
          timestamp: 1757000000,
          operation: 'create',
          version: 1,
          address: '16r',
          metaid: 'mid-r',
          globalMetaId: 'gm-registrar',
          contentSummary: '{"title":"Simple Buzz","path":"/protocols/simplebuzz","protocolName":"SimpleBuzz","version":"1.0.0","protocolContent":"{ degraded: true }"}',
        }],
        nextCursor: null,
      })
    }
    throw new Error('so.metaid.io unreachable')
  })
  try {
    const host = fakeHost()
    plugin.bindMetaprotocolToolInstall(host.ctx)
    const read = host.tools.find((tool) => tool.name === 'metaprotocol_registry')
    const result = await read.execute({ action: 'read', protocolPath: '/protocols/simplebuzz' }, {})
    assert.match(result.split('\n')[0], /^\(degraded: registry fallback\)/)
    assert.match(result, /Protocol \/protocols\/simplebuzz \(Simple Buzz\):/)
    assert.match(result, /<metaweb_protocol_content>/)
  } finally {
    fetchStub.restore()
  }
})

test('metaprotocol_registry read of an unknown protocol returns the not-registered pointer', async () => {
  const fetchStub = fakeRegistryFetch((url) => {
    if (url.includes('manapi')) return manapiEnvelope({ list: [], nextCursor: null })
    return { code: 40400, data: null, message: 'not found' }
  })
  try {
    const host = fakeHost()
    plugin.bindMetaprotocolToolInstall(host.ctx)
    const read = host.tools.find((tool) => tool.name === 'metaprotocol_registry')
    const result = await read.execute({ action: 'read', protocolPath: '/protocols/nope' }, {})
    assert.match(result, /not registered yet/)
    assert.match(result, /post_metaprotocol/)
  } finally {
    fetchStub.restore()
  }
})

test('metaprotocol_registry versions renders the version chain', async () => {
  const fetchStub = fakeRegistryFetch((url) => {
    if (url.includes('/pin/') && url.includes('/versions')) {
      return envelope({
        pinId: 'a'.repeat(64) + 'i0',
        latest: 'b'.repeat(64) + 'i0',
        attribution: 'chain',
        versions: [
          { pinId: 'a'.repeat(64) + 'i0', version: 1, createdAt: 1757000000, operation: 'create', author: { address: '16r', metaid: '', globalMetaId: 'gm-registrar', name: 'Registrar' } },
          { pinId: 'b'.repeat(64) + 'i0', version: 2, createdAt: 1757100000, operation: 'modify', author: { address: '16r', metaid: '', globalMetaId: 'gm-registrar', name: 'Registrar' } },
        ],
      })
    }
    if (url.includes('/protocols/detail')) {
      return envelope({ record: registryItem(), versions: [], conflicts: [], invalidModifies: [] })
    }
    throw new Error('unexpected url ' + url)
  })
  try {
    const host = fakeHost()
    plugin.bindMetaprotocolToolInstall(host.ctx)
    const tool = host.tools.find((tool) => tool.name === 'metaprotocol_registry')
    const result = await tool.execute({ action: 'versions', protocolPath: '/protocols/simplebuzz' }, {})
    assert.match(result, /Version chain for \/protocols\/simplebuzz/)
    assert.match(result, /attribution: chain \(evidence-grade/)
    assert.match(result, /v1 .* — create by Registrar/)
    assert.match(result, /v2 .* — modify by Registrar/)
  } finally {
    fetchStub.restore()
  }
})

test('metaprotocol_registry read/versions without a locator asks for one', async () => {
  const host = fakeHost()
  plugin.bindMetaprotocolToolInstall(host.ctx)
  const tool = host.tools.find((tool) => tool.name === 'metaprotocol_registry')
  const result = await tool.execute({ action: 'read' }, {})
  assert.match(result, /requires at least one locator/)
})

test('post_metaprotocol validates title/protocolName/XOR before spawning the CLI', async () => {
  const host = fakeHost()
  const { calls, run } = fakeRun()
  const tools = plugin.buildMetaprotocolToolDefinitions({ host: host.ctx, hostAgent: { ctx: {} }, run })
  const post = tools.find((tool) => tool.name === 'post_metaprotocol')
  assert.match(await post.execute({ action: 'publish', protocolName: 'X', protocolContent: 'y' }, {}), /non-empty `title`/)
  assert.match(await post.execute({ action: 'publish', title: 'T' }, {}), /non-empty `protocolName`/)
  assert.match(await post.execute({ action: 'publish', title: 'T', protocolName: 'X' }, {}), /exactly one of body/)
  assert.match(await post.execute({ action: 'publish', title: 'T', protocolName: 'X', body: {}, protocolContent: 'z' }, {}), /exactly one of body/)
  assert.match(await post.execute({ action: 'update', title: 'T', protocolName: 'X', protocolContent: 'z' }, {}), /update requires a target/)
  assert.equal(calls.length, 0)
})

test('post_metaprotocol publish spawns the CLI with the acting slug and the request payload', async () => {
  const host = fakeHost({ agentPresets: { composedPreset: () => 'oac-alice' } })
  const { calls, run } = fakeRun()
  const tools = plugin.buildMetaprotocolToolDefinitions({ host: host.ctx, hostAgent: { ctx: {} }, run })
  const post = tools.find((tool) => tool.name === 'post_metaprotocol')
  const result = await post.execute(
    {
      action: 'publish',
      title: 'My Proto',
      protocolName: 'MyProto',
      intro: 'hello',
      body: { flag: { value: true, description: 'the flag' } },
      metadata: { k: 'v' },
      attachments: ['metafile://x'],
    },
    { agent: { ctx: {} } },
  )
  assert.match(result, /Protocol published on-chain: \/protocols\/myproto v1\.0\.0/)
  assert.deepEqual(calls[0].args.slice(0, 5), ['protocol', 'publish', '--from', 'alice', '--request-file'])
  assert.match(calls[0].args[5], /oac-dsh-payload-.*\/payload\.json$/)
  assert.equal(calls[0].payload.title, 'My Proto')
  assert.equal(calls[0].payload.protocolName, 'MyProto')
  assert.equal(calls[0].payload.intro, 'hello')
  assert.deepEqual(calls[0].payload.body, { flag: { value: true, description: 'the flag' } })
  assert.deepEqual(calls[0].payload.metadata, { k: 'v' })
  assert.deepEqual(calls[0].payload.attachments, ['metafile://x'])
})

test('post_metaprotocol surfaces CLI failures as plain strings', async () => {
  const host = fakeHost()
  const { run } = fakeRun({ ok: false, state: 'failed', code: 'protocol_path_taken', message: 'Protocol path /protocols/x is already registered by someoneelse.' })
  const tools = plugin.buildMetaprotocolToolDefinitions({ host: host.ctx, hostAgent: { ctx: {} }, run })
  const post = tools.find((tool) => tool.name === 'post_metaprotocol')
  const result = await post.execute(
    { action: 'publish', title: 'T', protocolName: 'X', protocolContent: '{ y: 1 }' },
    {},
  )
  assert.match(result, /Protocol publish failed: Protocol path \/protocols\/x is already registered by someoneelse\./)
})
