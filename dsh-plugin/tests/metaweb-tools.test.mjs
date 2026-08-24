import assert from 'node:assert/strict'
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
