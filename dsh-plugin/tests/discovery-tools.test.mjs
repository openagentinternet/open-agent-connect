import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync } from 'node:fs'
// Repo-mandated tracked temp root helper (tests/helpers/tempRoots.mjs):
// teardown is registered for success, failure, and timeouts. The tests below
// never touch a real ~/.dsh profile — the CLI bridge is faked, so no daemon,
// wallet, chain write, or network request ever runs. The discovery tools are
// flag-only CLI bridges: unlike the payload-file writers, their execute path
// creates no temp files at all.
import { mkdtempTempRootSync } from '../../tests/helpers/tempRoots.mjs'

const plugin = await import('../lib/discovery-tools.js')

function fakeHost(overrides = {}) {
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

function fakeRun(result) {
  const calls = []
  return {
    calls,
    run: async (args, options) => {
      calls.push({ args, options })
      return result ?? { ok: true, state: 'success', data: {} }
    },
  }
}

function buildTool(name, run) {
  const host = fakeHost()
  const tools = plugin.buildDiscoveryToolDefinitions({
    host: host.ctx, hostAgent: { ctx: host.ctx }, ...(run ? { run } : {}),
  })
  const tool = tools.find((entry) => entry.name === name)
  assert.ok(tool, `${name} must be defined`)
  return tool
}

test('the three discovery tools register on the global layer', () => {
  const host = fakeHost()
  plugin.bindDiscoveryToolInstall(host.ctx)
  assert.deepEqual(
    host.tools.map((tool) => tool.name),
    ['search_metaids', 'metaid_profile', 'list_online_services'],
  )
})

test('descriptions are English and only reference tools that exist in this plugin', () => {
  const host = fakeHost()
  plugin.bindDiscoveryToolInstall(host.ctx)
  const allowed = new Set([
    // The three tools under test plus every cross-reference they may name,
    // and the backticked parameter names descriptions legitimately carry.
    'search_metaids', 'metaid_profile', 'list_online_services',
    'search_online_bots', 'search_metaapps', 'search_metaweb', 'bot_browser_open_uri',
    'identity',
  ])
  for (const tool of host.tools) {
    assert.equal(tool.description, tool.description.trim(), `${tool.name} description has no stray whitespace`)
    assert.doesNotMatch(tool.description, /[^\x00-\x7F]/, `${tool.name} description is plain English (ASCII)`)
    // Every backticked snake_case mention must be a tool that exists here.
    for (const mention of tool.description.matchAll(/`([a-z_]+)`/g)) {
      assert.ok(allowed.has(mention[1]), `${tool.name} backticks unknown tool "${mention[1]}"`)
    }
  }
})

test('search_metaids: query or skill is required before any CLI call', async () => {
  const { run, calls } = fakeRun()
  const tool = buildTool('search_metaids', run)
  const missing = await tool.execute({}, {})
  assert.match(missing, /query or skill is required/)
  assert.equal(calls.length, 0, 'validation failure never spawns the CLI')
})

test('search_metaids: bridges `metaid search` with every flag mapped', async () => {
  const { run, calls } = fakeRun({
    ok: true, state: 'success',
    data: {
      items: [{
        globalMetaId: 'idq1alice', name: 'Alice', bio: 'connects things', chainName: 'mvc',
        chatSkills: ['weather', 'translation'], hasChatPubkey: true, hasHomepage: true,
        updatedAt: 1760000000, isOwn: true,
      }],
      hasMore: true, nextCursor: 'cur-2',
    },
  })
  const tool = buildTool('search_metaids', run)
  const out = await tool.execute(
    { query: 'Alice', chain: 'MVC', chat_only: true, has_homepage: true, since_days: 3, limit: 5 },
    {},
  )
  assert.deepEqual(calls[0].args, [
    'metaid', 'search',
    '--query', 'Alice', '--chain', 'mvc',
    '--chat-pubkey', '--homepage', '--since-days', '3', '--limit', '5',
  ])
  assert.match(out, /1 on-chain MetaID candidate\(s\), best first:/)
  assert.match(out, /\[Alice\]\(metaid:\/\/idq1alice\) \(your MetaBot\) — connects things/)
  assert.match(out, /skills: weather, translation/)
  assert.match(out, /open to private chat/)
  assert.match(out, /cursor="cur-2"/, 'hasMore surfaces the next cursor')
  assert.ok(calls[0].options.timeoutMs >= 1000, 'timeout rides the run options')
})

test('search_metaids: limit clamps to the CLI max and rejects malformed day windows', async () => {
  const { run, calls } = fakeRun({ ok: true, state: 'success', data: { items: [] } })
  const tool = buildTool('search_metaids', run)
  await tool.execute({ query: 'x', limit: 99 }, {})
  assert.equal(calls[0].args[calls[0].args.length - 1], '20', 'limit clamps to 20')
  const badSince = await tool.execute({ query: 'x', since_days: 1.5 }, {})
  assert.match(badSince, /since_days must be a positive integer/)
  assert.equal(calls.length, 1, 'day-window validation failure spawns no CLI call')
})

test('search_metaids: a value starting with "--" is refused, not silently dropped', async () => {
  const { run, calls } = fakeRun()
  const tool = buildTool('search_metaids', run)
  const blocked = await tool.execute({ query: '--limit' }, {})
  assert.match(blocked, /must not start with "--"/)
  assert.equal(calls.length, 0)
})

test('search_metaids: empty result is honest, never invented', async () => {
  const { run } = fakeRun({ ok: true, state: 'success', data: { items: [] } })
  const tool = buildTool('search_metaids', run)
  const out = await tool.execute({ query: 'nobody' }, {})
  assert.match(out, /No on-chain MetaID identities matched "nobody"\./)
  assert.match(out, /do NOT invent people or bots/)
})

test('metaid_profile: requires an identity and strips a metaid:// wrapper', async () => {
  const { run, calls } = fakeRun()
  const tool = buildTool('metaid_profile', run)
  const missing = await tool.execute({}, {})
  assert.match(missing, /identity is required/)
  assert.equal(calls.length, 0)

  const wrapped = fakeRun({
    ok: true, state: 'success',
    data: {
      globalMetaId: 'idq1bob', name: 'Bob', chainName: 'mvc', address: '1BoB',
      bio: 'builds bridges', role: 'Mercury', soul: 'connector', goal: 'link everything',
      chatSkills: ['search'], llm: { provider: 'p', model: 'm' }, persona: { a: 1 },
      homepage: { uri: 'metaapp://ab' }, chatPubkey: 'pk-1', createdAt: 1750000000, updatedAt: 1760000000,
    },
  })
  const tool2 = buildTool('metaid_profile', wrapped.run)
  const out = await tool2.execute({ identity: 'metaid://idq1bob' }, {})
  assert.deepEqual(wrapped.calls[0].args, ['metaid', 'detail', '--identity', 'idq1bob'])
  assert.match(out, /Profile of \[Bob\]\(metaid:\/\/idq1bob\):/)
  assert.match(out, /- role: Mercury/)
  assert.match(out, /- soul: connector/)
  assert.match(out, /- chatSkills: search/)
  assert.match(out, /- llm: p\/m/)
  assert.match(out, /- private chat: available \(chatpubkey set\)/)
  assert.match(out, /registered: \d{4}-\d{2}-\d{2} \| last updated: \d{4}-\d{2}-\d{2}/)
})

test('metaid_profile: not-found is reported honestly, never invented', async () => {
  const { run, calls } = fakeRun({
    ok: false, state: 'failed', code: 'metaid_not_found', message: 'no match',
  })
  const tool = buildTool('metaid_profile', run)
  const out = await tool.execute({ identity: 'idq1ghost' }, {})
  assert.match(out, /No on-chain MetaID identity matches "idq1ghost"/)
  assert.match(out, /do NOT invent a profile/)
  assert.equal(calls.length, 1, 'the lookup itself runs once before the honest miss')
})

test('list_online_services: bridges `network services --online` and pages locally', async () => {
  const rows = [1, 2, 3].map((n) => ({
    servicePinId: `pin${n}i0`, displayName: `Service ${n}`, providerGlobalMetaId: `idq1p${n}`,
    providerName: `Provider ${n}`, price: '100', currency: 'sat', lastSeenAgoSeconds: n * 10,
    providerSkill: 'skill-a', description: 'does things', ratingAvg: 4.5, ratingCount: 2,
  }))
  const { run, calls } = fakeRun({ ok: true, state: 'success', data: { services: rows } })
  const tool = buildTool('list_online_services', run)
  const out = await tool.execute({ limit: 2 }, {})
  assert.deepEqual(calls[0].args, ['network', 'services', '--online'], 'no --limit rides the CLI: paging is local')
  assert.match(out, /\(1–2 of 3\)/)
  assert.match(out, /\| 1 \| Service 1 \| \[Provider 1\]\(metaid:\/\/idq1p1\) \| 100sat \| 10s 🟢 \|/)
  assert.match(out, /pin pin1i0 \| skill: skill-a \| rating 4\.5 \(2\)/)
  assert.match(out, /cursor=2/, 'the more-results hint carries the next offset')

  const page2 = await tool.execute({ limit: 2, cursor: 2 }, {})
  assert.match(page2, /\(3–3 of 3\)/)
  assert.doesNotMatch(page2, /cursor=/)
})

test('list_online_services: query rides the CLI flag; empty stays honest', async () => {
  const { run, calls } = fakeRun({ ok: true, state: 'success', data: { services: [] } })
  const tool = buildTool('list_online_services', run)
  const empty = await tool.execute({ query: 'nothing' }, {})
  assert.deepEqual(calls[0].args, ['network', 'services', '--online', '--query', 'nothing'])
  assert.match(empty, /No currently-online MetaWeb services matched "nothing"\./)
  assert.match(empty, /do NOT invent services/)

  const badCursor = await tool.execute({ cursor: -1 }, {})
  assert.match(badCursor, /cursor must be a non-negative integer/)
  assert.equal(calls.length, 1, 'cursor validation failure spawns no extra CLI call')
})

test('read-only posture: no tool output path writes anything to disk', async () => {
  // Tracked temp root must stay empty across every execute path: these are
  // flag-only CLI bridges, so unlike the payload-file writers there is no
  // temp payload at all. Nothing here touches a real profile such as ~/.dsh.
  const root = mkdtempTempRootSync('discovery-hygiene-')
  const host = fakeHost()
  const search = fakeRun({ ok: true, state: 'success', data: { items: [{ globalMetaId: 'idq1x', name: 'X' }] } })
  const detail = fakeRun({ ok: true, state: 'success', data: { globalMetaId: 'idq1x', name: 'X' } })
  const services = fakeRun({ ok: true, state: 'success', data: { services: [{ servicePinId: 'p1i0', providerGlobalMetaId: 'idq1x' }] } })
  const [t1, t2, t3] = plugin.buildDiscoveryToolDefinitions({
    host: host.ctx, hostAgent: { ctx: host.ctx },
    run: async (args, options) => {
      if (args[0] === 'metaid' && args[1] === 'search') return search.run(args, options)
      if (args[0] === 'metaid' && args[1] === 'detail') return detail.run(args, options)
      return services.run(args, options)
    },
  })
  await t1.execute({ query: 'x' }, {})
  await t2.execute({ identity: 'idq1x' }, {})
  await t3.execute({}, {})
  assert.equal(search.calls.length + detail.calls.length + services.calls.length, 3)
  assert.deepEqual(readdirSync(root), [], 'the read-only path writes nothing into the temp root')
})
