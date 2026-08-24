/**
 * Knowledge-base native tools for DSH — OAC port of the IDBots M2/M3 pair:
 * knowledge_base_list / knowledge_base_query / knowledge_base_add_document
 * / knowledge_base_learn (+ procedure_recall / procedure_save in the
 * procedure module). In-process execution through the local-read dist loader
 * against the session Bot's profile paths.
 */
import { core } from './local-read.js'
import type { HostAgentLike, HostContext, HostToolDefinition, HostToolExec } from './context-types.js'
import { oacSlugOf } from './browser-tools.js'

export interface KnowledgebaseToolDeps {
  /** Resolve the acting bot slug for one tool exec; fallback when unknown. */
  fallbackSlug?: string
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
    addDocument(slug: string, input: Record<string, unknown>): Promise<{ relPath: string }>
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

export function buildKnowledgeBaseToolDefinitions(input: KnowledgebaseToolDeps & {
  host: HostContext
}): HostToolDefinition[] {
  const { host } = input

  const render = (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
  ]

  const slugFor = (exec: HostToolExec, homeDir?: string): { slug: string; homeDir: string } | null => {
    const agent = exec.agent
    const slug = (agent ? oacSlugOf(host, agent) : undefined) ?? input.fallbackSlug ?? ''
    if (!slug || !homeDir) return null
    return { slug, homeDir }
  }

  const sessionOf = (exec: HostToolExec) => {
    const agent = exec.agent as (HostAgentLike & { ctx?: { options?: { cwd?: string } } }) | undefined
    const homeDir = agent?.ctx?.options?.cwd
    return slugFor(exec, typeof homeDir === 'string' ? homeDir : undefined)
  }

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
        const session = sessionOf(exec)
        if (!session) return { error: 'Could not determine the acting Bot profile for this session.' }
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
          return { error: error instanceof Error ? error.message : String(error) }
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
        const session = sessionOf(exec)
        if (!session) return { error: 'Could not determine the acting Bot profile for this session.' }
        const query = textArg(args, 'query')
        if (!query) return { error: 'query is required.' }
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
          return { error: error instanceof Error ? error.message : String(error) }
        }
      },
    },
    {
      name: 'knowledge_base_add_document',
      description:
        'Save a full document (article body, tutorial, reference page) into a knowledge base for future '
        + 'retrieval. Use for substantial content worth keeping whole — single facts belong in '
        + 'knowledge_upsert instead. Call knowledge_base_learn right after so the content is searchable. '
        + 'sourceType metaweb records the pinId provenance.',
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
      timeoutMs: 20_000,
      execute: async (args, exec) => {
        const session = sessionOf(exec)
        if (!session) return { error: 'Could not determine the acting Bot profile for this session.' }
        const title = textArg(args, 'title')
        const content = typeof args.content === 'string' ? args.content : ''
        if (!title || !content.trim()) return { error: 'title and content are required.' }
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
          return `Saved "${title}" as ${saved.relPath}. Now call knowledge_base_learn to make it searchable.`
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) }
        }
      },
    },
    {
      name: 'knowledge_base_learn',
      description:
        '(Re)build a knowledge base\'s search index from its raw documents. Run after '
        + 'knowledge_base_add_document or after files are imported into the corpus directory. '
        + 'full=true forces a complete rebuild.',
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
        const session = sessionOf(exec)
        if (!session) return { error: 'Could not determine the acting Bot profile for this session.' }
        try {
          const learned = await serviceFor(session.homeDir).learnKnowledgeBase(
            session.slug,
            textArg(args, 'knowledgeBaseId') || undefined,
            args.full === true,
          )
          return `Learned "${learned.name}": ${learned.docCount} docs, ${learned.chunkCount} chunks indexed.`
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) }
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
  const { host } = input
  const render = (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
  ]
  const sessionOf = (exec: HostToolExec) => {
    const agent = exec.agent as (HostAgentLike & { ctx?: { options?: { cwd?: string } } }) | undefined
    const homeDir = agent?.ctx?.options?.cwd
    const slug = (agent ? oacSlugOf(host, agent) : undefined) ?? input.fallbackSlug ?? ''
    if (!slug || typeof homeDir !== 'string') return null
    return { slug, homeDir }
  }

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
        const session = sessionOf(exec)
        if (!session) return { error: 'Could not determine the acting Bot profile for this session.' }
        const query = textArg(args, 'query')
        if (!query) return { error: 'query is required.' }
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
          return { error: error instanceof Error ? error.message : String(error) }
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
        const session = sessionOf(exec)
        if (!session) return { error: 'Could not determine the acting Bot profile for this session.' }
        const title = textArg(args, 'title')
        const steps = stringListArg(args, 'steps')
        if (!title || !steps?.length) return { error: 'title and at least one step are required.' }
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
          return { error: error instanceof Error ? error.message : String(error) }
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
        const session = sessionOf(exec)
        if (!session) return { error: 'Could not determine the acting Bot profile for this session.' }
        const title = textArg(args, 'title')
        if (!title) return { error: 'title is required.' }
        try {
          const archived = await procedureStoreFor(session.homeDir).archiveProcedureByTitle(title)
          return archived ? `Archived "${title}".` : `No procedure titled "${title}" found.`
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) }
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
  const { host } = input
  const render = (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
  ]
  const sessionOf = (exec: HostToolExec) => {
    const agent = exec.agent as (HostAgentLike & { ctx?: { options?: { cwd?: string } } }) | undefined
    const homeDir = agent?.ctx?.options?.cwd
    const slug = (agent ? oacSlugOf(host, agent) : undefined) ?? input.fallbackSlug ?? ''
    if (!slug || typeof homeDir !== 'string') return null
    return { slug, homeDir }
  }

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
        const session = sessionOf(exec)
        if (!session) return { error: 'Could not determine the acting Bot profile for this session.' }
        const topic = textArg(args, 'topic')
        if (!topic) return { error: 'topic is required.' }
        try {
          const result = await studyStoreFor(session.homeDir).enqueueStudyJob({
            metabotSlug: session.slug,
            topic,
            ...(numberArg(args, 'budgetPins') ? { budgetPins: numberArg(args, 'budgetPins') } : {}),
          })
          return `${result.created ? 'Queued' : 'Already queued'} study job "${topic}" (${result.job.budgetPins} pins/night). `
            + 'It runs nightly 00:00-06:00; check metaweb_study_status later. Answer the user from current knowledge now.'
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) }
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
        const session = sessionOf(exec)
        if (!session) return { error: 'Could not determine the acting Bot profile for this session.' }
        try {
          const rows = await studyStoreFor(session.homeDir).listStudyJobs(session.slug)
          if (!rows.length) return 'No study jobs yet.'
          return rows.map((job) => [
            `- "${job.topic}" [${job.status}] runs: ${job.runCount}, failures: ${job.consecutiveFailures}`,
            `  pins: ${Array.isArray(job.processedPinIds) ? job.processedPinIds.length : 0}/${job.budgetPins} per night`,
            job.summary ? `  last: ${String(job.summary).slice(0, 200)}` : '',
            job.error ? `  error: ${job.error}` : '',
          ].filter(Boolean).join('\n')).join('\n')
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) }
        }
      },
    },
  ]
}

function isDuplicateToolError(error: unknown): boolean {
  return error instanceof Error && /already.*(registered|exists)|duplicate/i.test(error.message)
}

/** Register the KB + procedure tools on the host global layer during plugin apply. */
export function bindKnowledgeBaseToolInstall(ctx: HostContext, fallbackSlug?: string): void {
  const hostAgent: HostAgentLike = { ctx }
  for (const definition of [
    ...buildKnowledgeBaseToolDefinitions({ host: ctx, fallbackSlug }),
    ...buildProcedureToolDefinitions({ host: ctx, fallbackSlug }),
    ...buildStudyToolDefinitions({ host: ctx, fallbackSlug }),
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
