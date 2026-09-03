import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const plugin = await import('../lib/metaweb-tools.js')

function fakeHostContext() {
  const sections = []
  const tools = []
  return {
    sections,
    tools,
    ctx: {
      systemPrompt: {
        section: (input) => sections.push(input),
      },
      tools: {
        register: (definition) => tools.push(definition),
      },
      logger: { warn: () => undefined },
    },
  }
}

test('bindMetawebToolInstall registers the worldview section and both tools', () => {
  const host = fakeHostContext()
  plugin.bindMetawebToolInstall(host.ctx)
  assert.equal(host.sections.length, 1)
  assert.equal(host.sections[0].name, 'oac:metaweb-worldview')
  assert.match(host.sections[0].text, /Search first, don't guess/)
  assert.match(host.sections[0].text, /NEVER construct Web2 viewer URLs/)
  assert.deepEqual(host.tools.map((tool) => tool.name).sort(), ['read_metaweb_pin', 'search_metaweb'])
})

test('search tool executes the OAC core in-process and renders guidance', async () => {
  const host = fakeHostContext()
  plugin.bindMetawebToolInstall(host.ctx)
  const search = host.tools.find((tool) => tool.name === 'search_metaweb')

  const calls = []
  const originalEnv = process.env.METABOT_METAWEB_API_BASE_URL
  process.env.METABOT_METAWEB_API_BASE_URL = 'https://so.test'
  try {
    // Stub the dist core module through the module cache seam: pre-load
    // fakes into the local-read moduleCache by executing the real loader
    // path once — simpler: monkey-patch via a temp OAC_METAWEB stub module
    // is heavy; instead drive execute against a fetch-level fake by
    // pointing the loader at a stub through require.cache of the dist file.
    const { createRequire } = await import('node:module')
    const require = createRequire(import.meta.url)
    const distPath = require.resolve('../../dist/core/metaweb/search.js')
    const real = require.cache[distPath]
    require.cache[distPath] = {
      id: distPath,
      filename: distPath,
      loaded: true,
      exports: {
        searchMetaweb: async (params, options) => {
          calls.push({ params, options })
          return {
            items: [{
              protocol: 'simplenote', pinId: 'p1', currentPinId: 'p1', chainName: 'mvc',
              title: 'How to fish', summary: 'guide', tags: [], createdAt: 1,
              score: 1, publisher: { globalMetaId: 'g', metaid: 'm', name: 'N', avatar: '' }, extra: {},
            }],
            hasMore: false,
            nextCursor: null,
          }
        },
      },
    }
    const result = await search.execute({ query: 'fishing 101' }, {})
    if (real) require.cache[distPath] = real
    else delete require.cache[distPath]

    assert.equal(calls[0].options.baseUrl, 'https://so.test')
    assert.equal(calls[0].params.q, 'fishing 101')
    assert.match(result, /- \*\*\[How to fish\]\(pin:\/\/p1\)\*\*/)
    assert.match(result, /Open 1-3 of the most relevant pins/)

    const missing = await search.execute({}, {})
    assert.equal(missing.error, 'query is required.')
  } finally {
    if (originalEnv === undefined) delete process.env.METABOT_METAWEB_API_BASE_URL
    else process.env.METABOT_METAWEB_API_BASE_URL = originalEnv
  }
})

// Chain-history read recording (chain-history round 3): the read tool mirrors
// every successful read into the bot's ledger through a fire-and-forget
// `chainhistory read record` CLI call. Only pinRead is stubbed through the
// require.cache seam — the search test above already populated local-read's
// moduleCache with the real format.js, so this test asserts against the real
// formatter output instead.
function fakePin() {
  return {
    pinId: 'pin-read-hook',
    currentPinId: 'pin-read-hook',
    protocol: 'simplenote',
    path: '/protocols/simplenote',
    chainName: 'mvc',
    operation: 'create',
    creator: { globalMetaId: 'gm-author', metaid: 'meta-1', name: 'Author', address: '' },
    createdAt: 1,
    contentType: 'text/markdown',
    payload: null,
    text: 'the full note body',
    truncated: false,
    totalLength: 18,
    meta: { title: 'Hooked Note', summary: 's', tags: [] },
    attachments: [],
    source: 'local',
  }
}

async function withStubbedPinRead(pin, fn) {
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const distPath = require.resolve('../../dist/core/metaweb/pinRead.js')
  const real = require.cache[distPath]
  require.cache[distPath] = {
    id: distPath,
    filename: distPath,
    loaded: true,
    exports: { readMetawebPin: async () => pin },
  }
  try {
    return await fn()
  } finally {
    if (real) require.cache[distPath] = real
    else delete require.cache[distPath]
  }
}

function makeRecordingRun(runCalls, onCall) {
  return async (args) => {
    const file = args[args.indexOf('--payload-file') + 1]
    const payload = JSON.parse(readFileSync(file, 'utf8'))
    runCalls.push({ args, payload })
    onCall?.()
    return { ok: true, state: 'success', data: { recorded: true } }
  }
}

test('read tool records the read through chainhistory read record (fire-and-forget)', async () => {
  await withStubbedPinRead(fakePin(), async () => {
    const runCalls = []
    let signal
    const seen = new Promise((resolve) => { signal = resolve })
    const host = { agentPresets: { composedPreset: () => 'oac-alice' } }
    const tools = plugin.buildMetawebToolDefinitions({
      host,
      hostAgent: { ctx: { marker: true } },
      run: makeRecordingRun(runCalls, signal),
    })
    const read = tools.find((tool) => tool.name === 'read_metaweb_pin')

    const result = await read.execute({ pinId: 'pin-read-hook' }, {})
    // Tool output is unchanged: real formatter + citation rule, no record noise.
    assert.match(result, /<metaweb_pin_content>/)
    assert.match(result, /the full note body/)

    // The record hook is fire-and-forget; wait for it to land.
    await Promise.race([
      seen,
      new Promise((_, reject) => setTimeout(() => reject(new Error('record hook did not fire')), 5_000)),
    ])

    assert.equal(runCalls.length, 1)
    assert.deepEqual(runCalls[0].args.slice(0, 6), [
      'chainhistory', 'read', 'record', '--from', 'alice', '--payload-file',
    ])
    assert.equal(runCalls[0].payload.pinId, 'pin-read-hook')
    assert.equal(runCalls[0].payload.path, '/protocols/simplenote')
    assert.equal(runCalls[0].payload.protocol, 'simplenote')
    assert.equal(runCalls[0].payload.title, 'Hooked Note')
    assert.equal(runCalls[0].payload.authorGlobalMetaId, 'gm-author')
    assert.equal(runCalls[0].payload.contentText, 'the full note body')
    assert.equal(runCalls[0].payload.source, 'read_metaweb_pin')
  })
})

test('read tool skips recording when no actor slug resolves, output unchanged', async () => {
  await withStubbedPinRead(fakePin(), async () => {
    const runCalls = []
    const host = { agentPresets: { composedPreset: () => undefined } }
    const tools = plugin.buildMetawebToolDefinitions({
      host,
      hostAgent: { ctx: { marker: true } },
      run: makeRecordingRun(runCalls),
    })
    const read = tools.find((tool) => tool.name === 'read_metaweb_pin')

    const result = await read.execute({ pinId: 'pin-read-hook' }, { agent: undefined })
    assert.match(result, /the full note body/)
    // Give the (skipped) fire-and-forget path a chance to misfire.
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(runCalls.length, 0)
  })
})

test('read tool still records when the read succeeds but the CLI run rejects', async () => {
  await withStubbedPinRead(fakePin(), async () => {
    const host = { agentPresets: { composedPreset: () => 'oac-alice' } }
    const tools = plugin.buildMetawebToolDefinitions({
      host,
      hostAgent: { ctx: { marker: true } },
      run: async () => { throw new Error('cli down') },
    })
    const read = tools.find((tool) => tool.name === 'read_metaweb_pin')

    const result = await read.execute({ pinId: 'pin-read-hook' }, {})
    assert.match(result, /the full note body/)
    // The rejected record promise is swallowed asynchronously; the process
    // must not emit an unhandled rejection and the result stays intact.
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
})
