import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const plugin = await import('../lib/knowledgebase-tools.js')

function fakeHost() {
  const tools = []
  const ctx = {
    tools: { register: (definition) => tools.push(definition) },
    logger: { warn: () => undefined },
  }
  return { tools, ctx }
}

function execFor(slug, homeDir) {
  return {
    agent: {
      ctx: { options: { cwd: homeDir } },
    },
    callId: 'call-1',
  }
}

test('bindKnowledgeBaseToolInstall registers all four tools', () => {
  const host = fakeHost()
  plugin.bindKnowledgeBaseToolInstall(host.ctx)
  assert.deepEqual(
    host.tools.map((tool) => tool.name).sort(),
    ['knowledge_base_add_document', 'knowledge_base_learn', 'knowledge_base_list', 'knowledge_base_query'],
  )
})

test('add -> learn -> query roundtrip through the native tools against a temp profile', async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'kb-tools-'))
  const homeDir = path.join(base, '.metabot', 'profiles', 'test-bot')
  mkdirSync(homeDir, { recursive: true })

  const host = fakeHost()
  const [list, query, add, learn] = plugin.buildKnowledgeBaseToolDefinitions({ host: host.ctx, fallbackSlug: 'test-bot' })
  const exec = execFor('test-bot', homeDir)

  const empty = await list.execute({}, exec)
  assert.match(String(empty), /No knowledge bases yet/)

  const saved = await add.execute({
    title: '塔罗入门',
    content: '塔罗牌大阿卡纳共二十二张。占卜流程：洗牌、切牌、抽牌、解读。',
    sourceType: 'manual',
    tags: ['divination'],
  }, exec)
  assert.match(saved, /Saved "塔罗入门"/)

  const learned = await learn.execute({}, exec)
  assert.match(learned, /1 docs, \d+ chunks indexed/)

  const hits = await query.execute({ query: '塔罗 占卜' }, exec)
  assert.match(String(hits), /塔罗入门/)
  assert.match(String(hits), /Default/)

  const miss = await query.execute({ query: 'quantum crochet' }, exec)
  assert.match(String(miss), /No knowledge-base evidence/)
})

test('missing session context returns a readable error', async () => {
  const host = fakeHost()
  const [query] = plugin.buildKnowledgeBaseToolDefinitions({ host: host.ctx })
  const result = await query.execute({ query: 'x' }, {})
  assert.match(String(result.error), /acting Bot profile/)
})
