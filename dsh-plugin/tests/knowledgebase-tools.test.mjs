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
    [
      'knowledge_base_add_document',
      'knowledge_base_learn',
      'knowledge_base_list',
      'knowledge_base_query',
      'metaweb_study_enqueue',
      'metaweb_study_status',
      'procedure_archive',
      'procedure_recall',
      'procedure_save',
    ],
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

test('procedure_save -> recall -> archive roundtrip with colloquial matching', async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'kb-proc-'))
  const homeDir = path.join(base, '.metabot', 'profiles', 'test-bot')
  mkdirSync(homeDir, { recursive: true })
  const host = fakeHost()
  const tools = plugin.buildKnowledgeBaseToolDefinitions({ host: host.ctx, fallbackSlug: 'test-bot' })
  // The procedure tools are reached through the bound install.
  const bound = fakeHost()
  plugin.bindKnowledgeBaseToolInstall(bound.ctx, 'test-bot')
  const byName = new Map(bound.tools.map((tool) => [tool.name, tool]))
  const exec = execFor('test-bot', homeDir)

  const saved = await byName.get('procedure_save').execute({
    title: '发布链上文章',
    steps: ['写 markdown', '上传封面 metafile', 'post_simplenote 发布'],
    pitfalls: ['别用 Web2 图床'],
    triggerText: '要发教程或文章到链上时',
  }, exec)
  assert.match(saved, /Saved procedure/)

  const recall = await byName.get('procedure_recall').execute({ query: '怎么发文章到链上' }, exec)
  assert.match(String(recall), /发布链上文章/)
  assert.match(String(recall), /<avoid>别用 Web2 图床</)

  const rewrite = await byName.get('procedure_save').execute({
    title: '发布链上文章', steps: ['写 markdown', 'post_simplenote 发布'],
  }, exec)
  assert.match(rewrite, /Updated \(v2\)/)

  const archived = await byName.get('procedure_archive').execute({ title: '发布链上文章' }, exec)
  assert.match(archived, /Archived/)
  const afterArchive = await byName.get('procedure_recall').execute({ query: '发文章' }, exec)
  assert.match(String(afterArchive), /No saved procedure/)
})

test('metaweb_study_enqueue dedupes and status reports', async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'kb-study-'))
  const homeDir = path.join(base, '.metabot', 'profiles', 'test-bot')
  mkdirSync(homeDir, { recursive: true })
  const bound = fakeHost()
  plugin.bindKnowledgeBaseToolInstall(bound.ctx, 'test-bot')
  const byName = new Map(bound.tools.map((tool) => [tool.name, tool]))
  const exec = execFor('test-bot', homeDir)

  const empty = await byName.get('metaweb_study_status').execute({}, exec)
  assert.match(String(empty), /No study jobs yet/)

  const queued = await byName.get('metaweb_study_enqueue').execute({ topic: '前端框架趋势', budgetPins: 5 }, exec)
  assert.match(queued, /Queued study job/)
  const dup = await byName.get('metaweb_study_enqueue').execute({ topic: '前端框架趋势' }, exec)
  assert.match(dup, /Already queued/)

  const status = await byName.get('metaweb_study_status').execute({}, exec)
  assert.match(String(status), /前端框架趋势/)
  assert.match(String(status), /\[pending\]/)
})
