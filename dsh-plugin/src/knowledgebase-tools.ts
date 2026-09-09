/**
 * Knowledge-base native tools for DSH — OAC port of the IDBots M2/M3 pair:
 * knowledge_base_list / knowledge_base_query / knowledge_base_add_document
 * / knowledge_base_learn (+ procedure_recall / procedure_save in the
 * procedure module). In-process execution through the local-read dist loader
 * against the session Bot's profile paths.
 */
import { core, twinFallbackSlug } from './local-read.js'
import type { HostAgentLike, HostContext, HostToolDefinition, HostToolExec } from './context-types.js'
import { actorHomeDir, oacSlugOf } from './browser-tools.js'

export interface KnowledgebaseToolDeps {
  /** Resolve the acting bot slug for one tool exec; fallback when unknown. */
  fallbackSlug?: string
  /** Resolve a Bot slug to its profile homeDir; defaults to the CLI-mirroring resolution. */
  resolveHomeDir?: (slug: string) => Promise<string>
  /**
   * Resolve the machine-default Bot (the Twin) when the session has no
   * `oac-*` agent; defaults to the in-process twin lookup. Inject `undefined`
   * resolution in tests that assert the no-profile error path.
   */
  resolveFallbackSlug?: () => Promise<string | undefined>
}

function textArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value.trim() : ''
}

function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = Number(args[key])
  return Number.isFinite(value) ? value : undefined
}

function stringListArg(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key]
  if (!Array.isArray(value)) return undefined
  const rows = value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean)
  return rows.length ? rows : undefined
}

type ServiceModule = {
  createKnowledgeBaseService(paths: unknown): {
    store: {
      listKnowledgeBases(): Promise<Array<Record<string, unknown>>>
    }
    queryKnowledgeBase(slug: string, query: string, options?: Record<string, unknown>): Promise<Array<{
      knowledgeBaseId: string
      knowledgeBaseName: string
      hits: Array<{ docRelPath: string; ord: number; snippet: string; score: number; title: string }>
    }>>
    addDocument(slug: string, input: Record<string, unknown>): Promise<{
      relPath: string
      indexed?: boolean
      knowledgeBase?: { docCount?: unknown; chunkCount?: unknown }
    }>
    learnKnowledgeBase(slug: string, kbId?: string, full?: boolean): Promise<Record<string, unknown>>
  }
}

// Store/service instances are memoized per profile home: the per-instance
// write queues only serialize within one instance, so per-exec construction
// would race concurrent tool calls (same class of fix as the staffing CAS).
const serviceCache = new Map<string, ReturnType<ServiceModule['createKnowledgeBaseService']>>()
const procedureStoreCache = new Map<string, unknown>()
const studyStoreCache = new Map<string, unknown>()

function pathsFor(slug: string, homeDir: string): unknown {
  const pathsModule = core('core/state/paths.js') as { resolveMetabotPaths(homeDir: string): unknown }
  return pathsModule.resolveMetabotPaths(homeDir)
}

function serviceFor(homeDir: string) {
  const module = core('core/knowledgebase/service.js') as ServiceModule
  let service = serviceCache.get(homeDir)
  if (!service) {
    service = module.createKnowledgeBaseService(pathsFor('', homeDir))
    serviceCache.set(homeDir, service)
  }
  return service
}

/**
 * Resolve the acting Bot's slug and profile homeDir for one tool exec. The
 * homeDir comes from the slug (never the session workspace cwd — DSH sessions
 * run in the host workspace, which resolveMetabotPaths rejects), so the tools
 * work from any conversation workspace and from never-initialized profiles.
 * Sessions with no `oac-*` agent fall back to the machine-default Bot (the
 * Twin) — the same target a no-`--from` CLI call picks — so plain DSH
 * conversations keep working instead of failing on a missing profile.
 * `viaFallback` marks that resolution so write tools can report where data
 * actually landed.
 */
async function sessionOf(
  input: KnowledgebaseToolDeps & { host: HostContext },
  exec: HostToolExec,
): Promise<{ slug: string; homeDir: string; viaFallback: boolean } | null> {
  const agent = exec.agent as HostAgentLike | undefined
  const ownSlug = (agent ? oacSlugOf(input.host, agent) : undefined) ?? input.fallbackSlug ?? ''
  let slug = ownSlug
  let viaFallback = false
  if (!slug) {
    const resolver = input.resolveFallbackSlug ?? twinFallbackSlug
    slug = (await resolver()) ?? ''
    viaFallback = slug !== ''
  }
  if (!slug) return null
  const homeDir = await (input.resolveHomeDir ?? actorHomeDir)(slug)
  return { slug, homeDir, viaFallback }
}

/** Tool failure text: a string, so the declared string output schema always validates. */
function toolError(tool: string, error: unknown): string {
  return `${tool} failed: ${error instanceof Error ? error.message : String(error)}`
}

const NO_SESSION = [
  'could not determine the acting Bot profile: this session is not an OAC Bot conversation and the machine has no Twin Bot.',
  'Ask the owner to create or designate one (Settings → Bots, or `metabot bot create --type twin`), then retry.',
].join(' ')

export function buildKnowledgeBaseToolDefinitions(input: KnowledgebaseToolDeps & {
  host: HostContext
}): HostToolDefinition[] {
  const render = (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
  ]

  return [
    {
      name: 'knowledge_base_list',
      description:
        'List your knowledge bases (document corpora) with doc/chunk counts and the default flag. '
        + 'Knowledge bases hold the full bodies of documents you saved for future reuse — deliberately '
        + 'separate from your distilled knowledge points (knowledge_upsert).',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render },
      timeoutMs: 15_000,
      execute: async (_args, exec) => {
        const session = await sessionOf(input, exec)
        if (!session) return toolError('knowledge_base_list', NO_SESSION)
        try {
          const rows = await serviceFor(session.homeDir).store.listKnowledgeBases()
          if (!rows.length) return 'No knowledge bases yet. knowledge_base_add_document creates the default one on first save.'
          return rows.map((row) => {
            const bits = [
              `- ${row.name} (id: ${row.id})${row.isDefault ? ' [default]' : ''}`,
              `  docs: ${row.docCount}, chunks: ${row.chunkCount}`,
              `  last learned: ${row.lastLearnedAt ? new Date(Number(row.lastLearnedAt)).toISOString() : 'never'}`,
            ]
            return bits.join('\n')
          }).join('\n')
        } catch (error) {
          return toolError('knowledge_base_list', error)
        }
      },
    },
    {
      name: 'knowledge_base_query',
      description:
        'Search your knowledge bases for passages relevant to a query. Returns scored snippets grouped '
        + 'by knowledge base (ranked within each), with the source document and KB id. When nothing clears the evidence threshold it says so — do not guess '
        + 'from thin air; widen the query or check another KB.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text query; Chinese works natively.' },
          knowledgeBaseId: { type: 'string', description: 'Restrict to one KB id; default searches all of your KBs, grouped per KB.' },
          topK: { type: 'number', description: 'Max hits per KB (1-50, default 8).' },
          minScore: { type: 'number', description: 'Evidence threshold 0-1 (default 0.18).' },
        },
        required: ['query'],
      },
      output: { schema: { type: 'string' }, render },
      timeoutMs: 20_000,
      execute: async (args, exec) => {
        const session = await sessionOf(input, exec)
        if (!session) return toolError('knowledge_base_query', NO_SESSION)
        const query = textArg(args, 'query')
        if (!query) return toolError('knowledge_base_query', 'query is required.')
        try {
          const results = await serviceFor(session.homeDir).queryKnowledgeBase(
            session.slug,
            query,
            {
              ...(textArg(args, 'knowledgeBaseId') ? { knowledgeBaseId: textArg(args, 'knowledgeBaseId') } : {}),
              ...(numberArg(args, 'topK') ? { topK: Math.max(1, Math.min(50, numberArg(args, 'topK')!)) } : {}),
              ...(numberArg(args, 'minScore') ? { minScore: Math.max(0, Math.min(1, numberArg(args, 'minScore')!)) } : {}),
            },
          )
          if (!results.length) {
            return 'No knowledge-base evidence clears the threshold for this query. Widen the query, try other keywords, or answer from your own knowledge and say so honestly.'
          }
          return results.map((result) => [
            `## ${result.knowledgeBaseName} (${result.knowledgeBaseId})`,
            ...result.hits.map((hit) => `- [${hit.score}] ${hit.title} :: ${hit.docRelPath}#${hit.ord}\n  ${hit.snippet}`),
          ].join('\n')).join('\n\n')
        } catch (error) {
          return toolError('knowledge_base_query', error)
        }
      },
    },
    {
      name: 'knowledge_base_add_document',
      description:
        'Save a full document (article body, tutorial, reference page) into a knowledge base for future '
        + 'retrieval. Use for substantial content worth keeping whole — single facts belong in '
        + 'knowledge_upsert instead. The KB index refreshes on save, so the document is searchable '
        + 'immediately — no separate learn call. sourceType metaweb records the pinId provenance.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Document title.' },
          content: { type: 'string', description: 'Full document body (markdown).' },
          knowledgeBaseId: { type: 'string', description: 'Target KB id; default = your default KB.' },
          sourceType: { type: 'string', enum: ['web', 'metaweb', 'manual'], description: 'Where the content came from.' },
          url: { type: 'string', description: 'Source URL for web content.' },
          pinId: { type: 'string', description: 'Source MetaWeb pinId for metaweb content.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Topic tags.' },
        },
        required: ['title', 'content'],
      },
      output: { schema: { type: 'string' }, render },
      timeoutMs: 60_000,
      execute: async (args, exec) => {
        const session = await sessionOf(input, exec)
        if (!session) return toolError('knowledge_base_add_document', NO_SESSION)
        const title = textArg(args, 'title')
        const content = typeof args.content === 'string' ? args.content : ''
        if (!title || !content.trim()) return toolError('knowledge_base_add_document', 'title and content are required.')
        try {
          const saved = await serviceFor(session.homeDir).addDocument(session.slug, {
            title,
            content,
            ...(textArg(args, 'knowledgeBaseId') ? { knowledgeBaseId: textArg(args, 'knowledgeBaseId') } : {}),
            ...(args.sourceType === 'web' || args.sourceType === 'metaweb' || args.sourceType === 'manual'
              ? { sourceType: args.sourceType }
              : {}),
            ...(textArg(args, 'url') ? { url: textArg(args, 'url') } : {}),
            ...(textArg(args, 'pinId') ? { pinId: textArg(args, 'pinId') } : {}),
            ...(stringListArg(args, 'tags') ? { tags: stringListArg(args, 'tags') } : {}),
          })
          const landing = session.viaFallback
            ? ` on the machine-default Bot "${session.slug}" (this session has no OAC Bot of its own)`
            : ''
          const counts = saved.indexed !== false && typeof saved.knowledgeBase?.docCount === 'number'
            ? ` (${saved.knowledgeBase.docCount} docs, ${saved.knowledgeBase.chunkCount} chunks indexed)`
            : ''
          return saved.indexed === false
            ? `Saved "${title}" as ${saved.relPath}${landing}, but the search index could not be refreshed — call knowledge_base_learn to make it searchable.`
            : `Saved "${title}" as ${saved.relPath}${landing}; searchable now${counts}. Verify with knowledge_base_query.`
        } catch (error) {
          return toolError('knowledge_base_add_document', error)
        }
      },
    },
    {
      name: 'knowledge_base_learn',
      description:
        '(Re)build a knowledge base\'s search index from its raw documents. Saves through '
        + 'knowledge_base_add_document already index incrementally; run this after files are imported '
        + 'into the corpus directory or edited in place. full=true forces a complete rebuild.',
      parameters: {
        type: 'object',
        properties: {
          knowledgeBaseId: { type: 'string', description: 'KB id; default = your default KB.' },
          full: { type: 'boolean', description: 'Force full rebuild (default behavior on this runtime).' },
        },
      },
      output: { schema: { type: 'string' }, render },
      timeoutMs: 120_000,
      execute: async (args, exec) => {
        const session = await sessionOf(input, exec)
        if (!session) return toolError('knowledge_base_learn', NO_SESSION)
        try {
          const learned = await serviceFor(session.homeDir).learnKnowledgeBase(
            session.slug,
            textArg(args, 'knowledgeBaseId') || undefined,
            args.full === true,
          )
          const landing = session.viaFallback
            ? ` on the machine-default Bot "${session.slug}" (this session has no OAC Bot of its own)`
            : ''
          return `Learned "${learned.name}": ${learned.docCount} docs, ${learned.chunkCount} chunks indexed${landing}.`
        } catch (error) {
          return toolError('knowledge_base_learn', error)
        }
      },
    },
  ]
}


// ---------------------------------------------------------------------------
// Procedure memory (M3): procedure_recall / procedure_save / procedure_archive
// ---------------------------------------------------------------------------

type ProcedureModule = {
  createProcedureStore(paths: unknown): {
    upsertProcedure(input: Record<string, unknown>): Promise<{ procedure: Record<string, unknown>; created: boolean }>
    listProcedures(options?: { status?: string }): Promise<Array<Record<string, unknown>>>
    archiveProcedureByTitle(title: string): Promise<Record<string, unknown> | null>
    touchUsed(id: string): Promise<void>
  }
  scoreProceduresForQuery(
    procedures: Array<Record<string, unknown>>,
    query: string,
  ): Array<{ procedure: Record<string, unknown>; score: number }>
}

function procedureStoreFor(homeDir: string) {
  const module = core('core/memory/procedureStore.js') as ProcedureModule
  let store = procedureStoreCache.get(homeDir)
  if (!store) {
    store = module.createProcedureStore(pathsFor('', homeDir))
    procedureStoreCache.set(homeDir, store)
  }
  return store as ReturnType<ProcedureModule['createProcedureStore']>
}

function formatProcedureRow(row: Record<string, unknown>): string {
  const steps = Array.isArray(row.steps) ? row.steps.map(String) : []
  const pitfalls = Array.isArray(row.pitfalls) ? row.pitfalls.map(String) : []
  const lines = [
    `## ${row.title} (id: ${row.id}, v${row.version}, used ${row.useCount}x)`,
    ...steps.map((step, idx) => `${idx + 1}. ${step}`),
  ]
  if (pitfalls.length) lines.push(`<avoid>${pitfalls.join('；')}</avoid>`)
  if (typeof row.triggerText === 'string' && row.triggerText) lines.push(`触发场景: ${row.triggerText}`)
  return lines.join('\n')
}

function buildProcedureToolDefinitions(input: KnowledgebaseToolDeps & { host: HostContext }): HostToolDefinition[] {
  const render = (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
  ]

  return [
    {
      name: 'procedure_recall',
      description:
        'Recall saved repeatable workflows (procedures) matching a task description — scored steps + pitfalls '
        + 'you distilled before. Check it before re-deriving a multi-step process; single facts belong to '
        + 'knowledge_upsert, full documents to the knowledge base.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What you are about to do — colloquial wording works.' },
        },
        required: ['query'],
      },
      output: { schema: { type: 'string' }, render },
      timeoutMs: 15_000,
      execute: async (args, exec) => {
        const session = await sessionOf(input, exec)
        if (!session) return toolError('procedure_recall', NO_SESSION)
        const query = textArg(args, 'query')
        if (!query) return toolError('procedure_recall', 'query is required.')
        try {
          const store = procedureStoreFor(session.homeDir)
          const rows = await store.listProcedures({ status: 'active' })
          const module = core('core/memory/procedureStore.js') as ProcedureModule
          const scored = module.scoreProceduresForQuery(rows as Array<Record<string, unknown>>, query)
          if (!scored.length) {
            return 'No saved procedure matches this task. If you complete a new repeatable workflow, save it with procedure_save.'
          }
          const top = scored.slice(0, 3)
          for (const hit of top) await store.touchUsed(String(hit.procedure.id))
          return top.map((hit) => formatProcedureRow(hit.procedure)).join('\n\n')
        } catch (error) {
          return toolError('procedure_recall', error)
        }
      },
    },
    {
      name: 'procedure_save',
      description:
        'Save or rewrite a repeatable workflow (title + ordered steps + pitfalls). Same title rewrites with a '
        + 'version bump. Use after you worked out a process worth repeating; keep steps concrete and imperative.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short imperative title, e.g. "发布链上文章的标准流程".' },
          steps: { type: 'array', items: { type: 'string' }, description: 'Ordered concrete steps.' },
          pitfalls: { type: 'array', items: { type: 'string' }, description: 'Mistakes to avoid next time.' },
          triggerText: { type: 'string', description: 'When to use this procedure (colloquial).' },
          sourcePinIds: { type: 'array', items: { type: 'string' }, description: 'MetaWeb pinIds that taught it.' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'steps'],
      },
      output: { schema: { type: 'string' }, render },
      timeoutMs: 15_000,
      execute: async (args, exec) => {
        const session = await sessionOf(input, exec)
        if (!session) return toolError('procedure_save', NO_SESSION)
        const title = textArg(args, 'title')
        const steps = stringListArg(args, 'steps')
        if (!title || !steps?.length) return toolError('procedure_save', 'title and at least one step are required.')
        try {
          const saved = await procedureStoreFor(session.homeDir).upsertProcedure({
            title,
            steps,
            ...(stringListArg(args, 'pitfalls') ? { pitfalls: stringListArg(args, 'pitfalls') } : {}),
            ...(textArg(args, 'triggerText') ? { triggerText: textArg(args, 'triggerText') } : {}),
            ...(stringListArg(args, 'sourcePinIds') ? { sourcePinIds: stringListArg(args, 'sourcePinIds') } : {}),
            ...(stringListArg(args, 'tags') ? { tags: stringListArg(args, 'tags') } : {}),
            origin: 'agent',
          })
          return `${saved.created ? 'Saved' : 'Updated (v' + saved.procedure.version + ')'} procedure "${title}".`
        } catch (error) {
          return toolError('procedure_save', error)
        }
      },
    },
    {
      name: 'procedure_archive',
      description: 'Archive a procedure by exact title when it is obsolete or wrong.',
      parameters: {
        type: 'object',
        properties: { title: { type: 'string', description: 'Exact title of the procedure to archive.' } },
        required: ['title'],
      },
      output: { schema: { type: 'string' }, render },
      timeoutMs: 15_000,
      execute: async (args, exec) => {
        const session = await sessionOf(input, exec)
        if (!session) return toolError('procedure_archive', NO_SESSION)
        const title = textArg(args, 'title')
        if (!title) return toolError('procedure_archive', 'title is required.')
        try {
          const archived = await procedureStoreFor(session.homeDir).archiveProcedureByTitle(title)
          return archived ? `Archived "${title}".` : `No procedure titled "${title}" found.`
        } catch (error) {
          return toolError('procedure_archive', error)
        }
      },
    },
  ]
}


// ---------------------------------------------------------------------------
// Study jobs (M4): metaweb_study_enqueue / metaweb_study_status
// ---------------------------------------------------------------------------

type StudyModule = {
  createStudyJobStore(paths: unknown): {
    enqueueStudyJob(input: Record<string, unknown>): Promise<{ job: Record<string, unknown>; created: boolean }>
    enqueueQaSurfJob(input: { metabotSlug: string; budgetPins?: number }): Promise<{ job: Record<string, unknown>; created: boolean }>
    disableQaSurfJob(metabotSlug: string): Promise<boolean>
    listStudyJobs(slug?: string): Promise<Array<Record<string, unknown>>>
  }
}

function studyStoreFor(homeDir: string) {
  const module = core('core/knowledgebase/studyJobs.js') as StudyModule
  let store = studyStoreCache.get(homeDir)
  if (!store) {
    store = module.createStudyJobStore(pathsFor('', homeDir))
    studyStoreCache.set(homeDir, store)
  }
  return store as ReturnType<StudyModule['createStudyJobStore']>
}

function buildStudyToolDefinitions(input: KnowledgebaseToolDeps & { host: HostContext }): HostToolDefinition[] {
  const render = (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
  ]

  return [
    {
      name: 'metaweb_study_enqueue',
      description:
        'Queue an autonomous nightly study job: the daemon drains this topic into your knowledge base during '
        + 'the nightly window (00:00-06:00), saving up to budgetPins metaweb documents per night and distilling '
        + 'reusable procedures. NOT for tasks the user wants right now — say you will study it over coming '
        + 'nights and answer from what accumulated. Use for long-horizon learning the user assigns.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'What to study (max 200 chars).' },
          budgetPins: { type: 'number', description: 'Max metaweb documents saved per night (1-50, default 20).' },
        },
        required: ['topic'],
      },
      output: { schema: { type: 'string' }, render },
      timeoutMs: 15_000,
      execute: async (args, exec) => {
        const session = await sessionOf(input, exec)
        if (!session) return toolError('metaweb_study_enqueue', NO_SESSION)
        const topic = textArg(args, 'topic')
        if (!topic) return toolError('metaweb_study_enqueue', 'topic is required.')
        try {
          const result = await studyStoreFor(session.homeDir).enqueueStudyJob({
            metabotSlug: session.slug,
            topic,
            ...(numberArg(args, 'budgetPins') ? { budgetPins: numberArg(args, 'budgetPins') } : {}),
          })
          return `${result.created ? 'Queued' : 'Already queued'} study job "${topic}" (${result.job.budgetPins} pins/night). `
            + 'It runs nightly 00:00-06:00; check metaweb_study_status later. Answer the user from current knowledge now.'
        } catch (error) {
          return toolError('metaweb_study_enqueue', error)
        }
      },
    },
    {
      name: 'metaweb_qa_surf_enqueue',
      description:
        'Enable RECURRING nightly on-chain Q&A surfing for yourself — use when the user asks you to spend your '
        + 'nights on the MetaWeb Q&A (e.g. "晚上去链上问答看看，会的就答", "surf the on-chain Q&A at night and learn from it"). '
        + 'Every night (00:00-06:00) a background session then: browses the unanswered question queue, answers the ones '
        + 'squarely in your role (a few per night — answers are on-chain writes that cost sats), likes genuinely good '
        + 'answers, and saves Q&A valuable to your role into your knowledge bases. It recurs until the user disables it '
        + '(metaweb_qa_surf_disable); it never completes on its own. Re-enabling while active is a no-op returning the '
        + 'existing job. nightly_budget caps the NEW pins handled per run (questions answered + pins saved), default 10, max 50.',
      parameters: {
        type: 'object',
        properties: {
          nightly_budget: { type: 'number', description: 'New pins handled per night (answered + saved). Default 10, max 50.' },
        },
      },
      output: { schema: { type: 'string' }, render },
      timeoutMs: 15_000,
      execute: async (args, exec) => {
        const session = await sessionOf(input, exec)
        if (!session) return toolError('metaweb_qa_surf_enqueue', NO_SESSION)
        try {
          const result = await studyStoreFor(session.homeDir).enqueueQaSurfJob({
            metabotSlug: session.slug,
            ...(numberArg(args, 'nightly_budget') ? { budgetPins: numberArg(args, 'nightly_budget') } : {}),
          })
          if (!result.created) {
            return `Nightly Q&A surfing is already ${result.job.status} for this bot (${result.job.runCount} run(s) so far). `
              + 'It continues every night — no duplicate was created.'
          }
          return [
            `Nightly Q&A surfing enabled (nightly budget: ${result.job.budgetPins} pins/run).`,
            'Each night (00:00-06:00) a background session browses the unanswered on-chain questions, answers the ones squarely in your role, reacts honestly, and saves valuable Q&A into your knowledge bases.',
            'Tell the user it recurs until disabled (metaweb_qa_surf_disable) and that progress shows in metaweb_study_status.',
          ].join('\n')
        } catch (error) {
          return toolError('metaweb_qa_surf_enqueue', error)
        }
      },
    },
    {
      name: 'metaweb_qa_surf_disable',
      description:
        'Stop YOUR recurring nightly on-chain Q&A surfing — use when the user asks to stop/disable the nightly '
        + 'surfing ("别晚上去问答了", "stop the nightly Q&A surfing"). Answers and knowledge already saved stay; only '
        + 'future nightly runs stop. Re-enable anytime with metaweb_qa_surf_enqueue. Bare call, no arguments.',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render },
      timeoutMs: 15_000,
      execute: async (_args, exec) => {
        const session = await sessionOf(input, exec)
        if (!session) return toolError('metaweb_qa_surf_disable', NO_SESSION)
        try {
          const disabled = await studyStoreFor(session.homeDir).disableQaSurfJob(session.slug)
          if (!disabled) {
            return 'Nightly Q&A surfing is not active for this bot — nothing to disable.'
          }
          return 'Nightly Q&A surfing disabled. Everything already answered and saved stays with you; future nightly runs are stopped. Re-enable anytime with metaweb_qa_surf_enqueue.'
        } catch (error) {
          return toolError('metaweb_qa_surf_disable', error)
        }
      },
    },
    {
      name: 'metaweb_study_status',
      description: 'List your study jobs with status, runs, failures, and summaries (the morning report).',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render },
      timeoutMs: 15_000,
      execute: async (_args, exec) => {
        const session = await sessionOf(input, exec)
        if (!session) return toolError('metaweb_study_status', NO_SESSION)
        try {
          const rows = await studyStoreFor(session.homeDir).listStudyJobs(session.slug)
          if (!rows.length) return 'No study jobs yet.'
          return rows.map((job) => [
            `- "${job.topic}"${job.kind === 'qa-surf' ? ' [recurring Q&A surfing]' : ''} [${job.status}] runs: ${job.runCount}, failures: ${job.consecutiveFailures}`,
            `  ${job.kind === 'qa-surf' ? 'pins handled' : 'pins'}: ${Array.isArray(job.processedPinIds) ? job.processedPinIds.length : 0}/${job.budgetPins} per night`,
            job.summary ? `  last: ${String(job.summary).slice(0, 200)}` : '',
            job.error ? `  error: ${job.error}` : '',
          ].filter(Boolean).join('\n')).join('\n')
        } catch (error) {
          return toolError('metaweb_study_status', error)
        }
      },
    },
  ]
}

function isDuplicateToolError(error: unknown): boolean {
  return error instanceof Error && /already.*(registered|exists)|duplicate/i.test(error.message)
}

/** Register the KB + procedure tools on the host global layer during plugin apply. */
export function bindKnowledgeBaseToolInstall(
  ctx: HostContext,
  fallbackSlug?: string,
  resolveHomeDir?: (slug: string) => Promise<string>,
): void {
  const hostAgent: HostAgentLike = { ctx }
  for (const definition of [
    ...buildKnowledgeBaseToolDefinitions({ host: ctx, fallbackSlug, resolveHomeDir }),
    ...buildProcedureToolDefinitions({ host: ctx, fallbackSlug, resolveHomeDir }),
    ...buildStudyToolDefinitions({ host: ctx, fallbackSlug, resolveHomeDir }),
  ]) {
    try {
      ctx.tools?.register(definition)
    } catch (error) {
      if (!isDuplicateToolError(error)) {
        ctx.logger?.warn?.(`[oac-dsh] knowledge base tool install failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
