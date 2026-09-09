import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const plugin = await import('../lib/knowledgebase-tools.js')
const localRead = await import('../lib/local-read.js')

function fakeHost() {
  const tools = []
  const ctx = {
    tools: { register: (definition) => tools.push(definition) },
    logger: { warn: () => undefined },
  }
  return { tools, ctx }
}

/**
 * Production-shaped fixture: the Bot's profile home lives under
 * `<base>/.metabot/profiles/<slug>`, while the DSH session workspace cwd is a
 * plain directory elsewhere (DSH-DEFECT-KB-001: the tools must not treat the
 * session cwd as the profile home). `resolve` is the injected homeDir resolver.
 */
function profileSetup(prefix) {
  const base = mkdtempSync(path.join(tmpdir(), prefix))
  const homeDir = path.join(base, '.metabot', 'profiles', 'test-bot')
  mkdirSync(homeDir, { recursive: true })
  const workspace = mkdtempSync(path.join(tmpdir(), 'kb-workspace-'))
  const exec = { agent: { ctx: { options: { cwd: workspace } } }, callId: 'call-1' }
  const resolve = async () => homeDir
  return { base, homeDir, workspace, exec, resolve }
}

function createKb(homeDir, name) {
  const paths = localRead.core('core/state/paths.js').resolveMetabotPaths(homeDir)
  return localRead.core('core/knowledgebase/store.js')
    .createKnowledgeBaseStore(paths)
    .createKnowledgeBase({ metabotSlug: 'test-bot', name })
}

test('bindKnowledgeBaseToolInstall registers all tools incl. the qa-surf pair', () => {
  const host = fakeHost()
  plugin.bindKnowledgeBaseToolInstall(host.ctx)
  assert.deepEqual(
    host.tools.map((tool) => tool.name).sort(),
    [
      'knowledge_base_add_document',
      'knowledge_base_learn',
      'knowledge_base_list',
      'knowledge_base_query',
      'metaweb_qa_surf_disable',
      'metaweb_qa_surf_enqueue',
      'metaweb_study_enqueue',
      'metaweb_study_status',
      'procedure_archive',
      'procedure_recall',
      'procedure_save',
    ],
  )
})

test('kb/study tools survive a cordis ctx that throws on gated reads (kernel regression)', async () => {
  const { homeDir, resolve } = profileSetup('kb-ctx-guard-')
  const throwingCtx = new Proxy({}, {
    get(target, prop) {
      if (prop === 'then') return undefined
      throw new Error(`cannot get property "${String(prop)}" without inject`)
    },
  })
  const kernelAgent = { ctx: throwingCtx, session: { header: { cwd: homeDir } } }
  const host = fakeHost()
  plugin.bindKnowledgeBaseToolInstall(host.ctx, 'test-bot', resolve)
  const byName = new Map(host.tools.map((tool) => [tool.name, tool]))
  const exec = { agent: kernelAgent, callId: 'call-1' }

  const enabled = await byName.get('metaweb_qa_surf_enqueue').execute({}, exec)
  assert.match(String(enabled), /Nightly Q&A surfing enabled/)
  const status = await byName.get('metaweb_study_status').execute({}, exec)
  assert.match(String(status), /recurring Q&A surfing/)
})

test('qa-surf enqueue/dedup/disable roundtrip with the recurring status label', async () => {
  const { exec, resolve } = profileSetup('kb-qa-surf-')
  const host = fakeHost()
  plugin.bindKnowledgeBaseToolInstall(host.ctx, 'test-bot', resolve)
  const byName = new Map(host.tools.map((tool) => [tool.name, tool]))

  const enabled = await byName.get('metaweb_qa_surf_enqueue').execute({ nightly_budget: 5 }, exec)
  assert.match(String(enabled), /Nightly Q&A surfing enabled \(nightly budget: 5 pins\/run\)\./)
  assert.match(String(enabled), /metaweb_qa_surf_disable/)

  const dup = await byName.get('metaweb_qa_surf_enqueue').execute({}, exec)
  assert.match(String(dup), /already pending for this bot/)
  assert.match(String(dup), /no duplicate was created/)

  const status = await byName.get('metaweb_study_status').execute({}, exec)
  assert.match(String(status), /"On-chain Q&A surfing" \[recurring Q&A surfing\] \[pending\]/)
  assert.match(String(status), /pins handled: 0\/5 per night/)

  const disabled = await byName.get('metaweb_qa_surf_disable').execute({}, exec)
  assert.match(String(disabled), /Nightly Q&A surfing disabled\./)

  const again = await byName.get('metaweb_qa_surf_disable').execute({}, exec)
  assert.match(String(again), /not active for this bot/)
})

// DSH-DEFECT-KB-001 acceptance smoke: add -> query -> learn -> list on a
// never-initialized (A-class) profile from a plain workspace session cwd.
test('add -> learn -> query -> list closed loop on a fresh profile (DSH-DEFECT-KB-001)', async () => {
  const { homeDir, exec, resolve } = profileSetup('kb-tools-')

  const host = fakeHost()
  const defs = plugin.buildKnowledgeBaseToolDefinitions({
    host: host.ctx,
    fallbackSlug: 'test-bot',
    resolveHomeDir: resolve,
  })
  const [list, query, add, learn] = defs

  const empty = await list.execute({}, exec)
  assert.equal(typeof empty, 'string')
  assert.match(empty, /No knowledge bases yet/)

  const saved = await add.execute({
    title: '塔罗入门',
    content: '塔罗牌大阿卡纳共二十二张。占卜流程：洗牌、切牌、抽牌、解读。',
    sourceType: 'manual',
    tags: ['divination'],
  }, exec)
  assert.equal(typeof saved, 'string')
  assert.match(saved, /Saved "塔罗入门"/)
  assert.match(saved, /searchable now/, 'the save reports immediate searchability')

  // Saves are searchable the moment they return (report V6) — query before any learn.
  const immediate = await query.execute({ query: '塔罗 占卜' }, exec)
  assert.match(String(immediate), /塔罗入门/)

  // Duplicate write of the same title+content stays idempotent (same corpus file).
  const again = await add.execute({
    title: '塔罗入门',
    content: '塔罗牌大阿卡纳共二十二张。占卜流程：洗牌、切牌、抽牌、解读。',
  }, exec)
  assert.match(String(again), /Saved "塔罗入门"/)

  const learned = await learn.execute({}, exec)
  assert.match(String(learned), /1 docs, \d+ chunks indexed/)

  const hits = await query.execute({ query: '塔罗 占卜' }, exec)
  assert.match(String(hits), /塔罗入门/)
  assert.match(String(hits), /Default/)

  const miss = await query.execute({ query: 'quantum crochet' }, exec)
  assert.equal(typeof miss, 'string')
  assert.match(miss, /No knowledge-base evidence/)

  const second = await add.execute({
    title: 'Style prompts',
    content: 'The zzqx-nebula watermark token marks this reference document.',
  }, exec)
  assert.match(String(second), /Saved "Style prompts"/)
  const relearned = await learn.execute({}, exec)
  assert.match(String(relearned), /2 docs, \d+ chunks indexed/)

  const listed = await list.execute({}, exec)
  assert.match(String(listed), /Default \(id: default\) \[default\]/)
  assert.match(String(listed), /docs: 2, chunks: \d+/)

  const unique = await query.execute({ query: 'zzqx-nebula watermark' }, exec)
  assert.match(String(unique), /Style prompts/)
})

test('non-default knowledge base: add/learn/query scoped by knowledgeBaseId', async () => {
  const { homeDir, exec, resolve } = profileSetup('kb-nondefault-')
  const kb = await createKb(homeDir, 'Research')
  assert.equal(kb.id, 'research')

  const host = fakeHost()
  const defs = plugin.buildKnowledgeBaseToolDefinitions({
    host: host.ctx,
    fallbackSlug: 'test-bot',
    resolveHomeDir: resolve,
  })
  const [list, query, add, learn] = defs

  const saved = await add.execute({
    title: '链上问答协议笔记',
    content: 'simplequestion 只需要标题；simpleanswer 需要 answer_to 与正文。',
    knowledgeBaseId: 'research',
  }, exec)
  assert.match(String(saved), /Saved "链上问答协议笔记"/)

  const learned = await learn.execute({ knowledgeBaseId: 'research' }, exec)
  assert.match(String(learned), /Learned "Research": 1 docs, \d+ chunks indexed/)

  const hits = await query.execute({ query: 'simpleanswer 正文', knowledgeBaseId: 'research' }, exec)
  assert.match(String(hits), /链上问答协议笔记/)
  assert.match(String(hits), /Research \(research\)/)

  const listed = await list.execute({}, exec)
  assert.match(String(listed), /Research \(id: research\)/)
})

test('tool failures return locatable strings that satisfy the string output schema', async () => {
  const { exec, resolve } = profileSetup('kb-errors-')
  const host = fakeHost()
  const defs = plugin.buildKnowledgeBaseToolDefinitions({
    host: host.ctx,
    fallbackSlug: 'test-bot',
    resolveHomeDir: resolve,
  })
  const [, query, add, learn] = defs

  const unknownKb = await learn.execute({ knowledgeBaseId: 'nope' }, exec)
  assert.equal(typeof unknownKb, 'string')
  assert.match(unknownKb, /^knowledge_base_learn failed: /)
  assert.match(unknownKb, /nope/)

  const noFields = await add.execute({ title: '', content: '' }, exec)
  assert.equal(typeof noFields, 'string')
  assert.match(noFields, /^knowledge_base_add_document failed: title and content are required\./)

  const noQuery = await query.execute({}, exec)
  assert.equal(typeof noQuery, 'string')
  assert.match(noQuery, /^knowledge_base_query failed: query is required\./)
})

test('missing session context returns a readable string error', async () => {
  const host = fakeHost()
  const [, query] = plugin.buildKnowledgeBaseToolDefinitions({
    host: host.ctx,
    resolveFallbackSlug: async () => undefined,
  })
  const result = await query.execute({ query: 'x' }, {})
  assert.equal(typeof result, 'string')
  assert.match(result, /^knowledge_base_query failed: /)
  assert.match(result, /acting Bot profile/)
  assert.match(result, /Twin Bot/)
})

// Plain non-oac DSH sessions resolve the machine-default Bot (the Twin) and
// keep working; write tools say where the data landed (KB problem report
// category C: no silent profile guesswork).
test('session without an oac agent falls back to the machine-default Bot', async () => {
  const { homeDir, resolve } = profileSetup('kb-twin-fallback-')
  const host = fakeHost()
  const defs = plugin.buildKnowledgeBaseToolDefinitions({
    host: host.ctx,
    resolveHomeDir: resolve,
    resolveFallbackSlug: async () => 'twin-bot',
  })
  const [list, , add, learn] = defs
  // Plain exec: no agent at all, like a coding-workspace session.
  const exec = {}

  const empty = await list.execute({}, exec)
  assert.match(String(empty), /No knowledge bases yet/)

  const saved = await add.execute({ title: '回退笔记', content: '机器默认 Bot 的回退写入。' }, exec)
  assert.equal(typeof saved, 'string')
  assert.match(saved, /Saved "回退笔记"/)
  assert.match(saved, /machine-default Bot "twin-bot"/)

  const learned = await learn.execute({}, exec)
  assert.match(String(learned), /1 docs, \d+ chunks indexed/)
  assert.match(String(learned), /machine-default Bot "twin-bot"/)
  assert.ok(homeDir.length > 0, 'homeDir resolved through the injected resolver')
})

test('procedure_save -> recall -> archive roundtrip with colloquial matching', async () => {
  const { exec, resolve } = profileSetup('kb-proc-')
  const bound = fakeHost()
  plugin.bindKnowledgeBaseToolInstall(bound.ctx, 'test-bot', resolve)
  const byName = new Map(bound.tools.map((tool) => [tool.name, tool]))

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
  const { exec, resolve } = profileSetup('kb-study-')
  const bound = fakeHost()
  plugin.bindKnowledgeBaseToolInstall(bound.ctx, 'test-bot', resolve)
  const byName = new Map(bound.tools.map((tool) => [tool.name, tool]))

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
