/**
 * Knowledge-base / study routes — the host surface for the bot editor's
 * Knowledge tab (Settings → Bots). Reads (kb/list, kb/query, study/list) run
 * in-process against the OAC core stores; writes forward to the
 * `metabot knowledge-base` CLI verbs so the CLI stays the single management
 * surface. Large document bodies ride a temp file (--content-file) instead
 * of argv.
 */
import { mkdtemp, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { runMetabot, type MetabotCommandResult, type RunMetabotOptions } from './cli-bridge.js'
import { core, localActorHomeDir } from './local-read.js'

const CLI_TIMEOUT_MS = 60_000
// Converter-heavy learn of large binary docs (pdf/pptx/epub) can take minutes.
const LEARN_TIMEOUT_MS = 300_000
/** Above this many chars the document body goes to a temp file, not argv. */
const INLINE_CONTENT_LIMIT = 16_000

export interface KbRouteDeps {
  run?: (args: string[], options?: RunMetabotOptions) => Promise<MetabotCommandResult>
}

function failure(code: string, message: string): MetabotCommandResult {
  return { ok: false, state: 'failed', code, message }
}

function payloadObject(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {}
}

function trimmed(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  return typeof value === 'string' ? value.trim() : ''
}

function optionalTrimmed(payload: Record<string, unknown>, key: string): string | undefined {
  const value = trimmed(payload, key)
  return value || undefined
}

/** In-process stores bound to one profile home (memoized like the agent tools). */
type KbServiceLike = {
  ensureDefaultKnowledgeBase(slug: string): Promise<unknown>
  store: {
    listKnowledgeBases(): Promise<Array<Record<string, unknown>>>
  }
  queryKnowledgeBase(
    slug: string,
    query: string,
    options?: Record<string, unknown>,
  ): Promise<Array<Record<string, unknown>>>
}

type StudyStoreLike = {
  listStudyJobs(slug?: string): Promise<Array<Record<string, unknown>>>
}

const serviceCache = new Map<string, KbServiceLike>()
const studyStoreCache = new Map<string, StudyStoreLike>()

function pathsOf(homeDir: string): { profileRoot: string } {
  const pathsModule = core('core/state/paths.js') as unknown as {
    resolveMetabotPaths(homeDir: string): { profileRoot: string }
  }
  return pathsModule.resolveMetabotPaths(homeDir)
}

function kbServiceFor(homeDir: string): KbServiceLike {
  const paths = pathsOf(homeDir)
  let service = serviceCache.get(paths.profileRoot)
  if (!service) {
    const loader = core('core/knowledgebase/service.js') as unknown as {
      createKnowledgeBaseService(paths: unknown): KbServiceLike
    }
    service = loader.createKnowledgeBaseService(paths)
    serviceCache.set(paths.profileRoot, service)
  }
  return service
}

function studyStoreFor(homeDir: string): StudyStoreLike {
  const paths = pathsOf(homeDir)
  let store = studyStoreCache.get(paths.profileRoot)
  if (!store) {
    const loader = core('core/knowledgebase/studyJobs.js') as unknown as {
      createStudyJobStore(paths: unknown): StudyStoreLike
    }
    store = loader.createStudyJobStore(paths)
    studyStoreCache.set(paths.profileRoot, store)
  }
  return store
}

/** Local read for one bot's KB list; null when the profile is not local. */
async function localKbList(from: string): Promise<MetabotCommandResult | null> {
  try {
    const homeDir = await localActorHomeDir(from)
    if (!homeDir) return null
    const service = kbServiceFor(homeDir)
    // Ensure the default KB like IDBots does (every metabot owns one), so the
    // panel and the model's <knowledge_bases> block always show a save target.
    await service.ensureDefaultKnowledgeBase(basename(pathsOf(homeDir).profileRoot))
    const rows = await service.store.listKnowledgeBases()
    return {
      ok: true,
      state: 'success',
      data: { knowledgeBases: rows.map((row) => ({ ...row })) },
    }
  } catch {
    return null // fall back to the CLI path
  }
}

async function localKbQuery(
  from: string,
  body: Record<string, unknown>,
): Promise<MetabotCommandResult | null> {
  try {
    const homeDir = await localActorHomeDir(from)
    if (!homeDir) return null
    const query = trimmed(body, 'text')
    if (!query) return failure('missing_text', 'text is required')
    const service = kbServiceFor(homeDir)
    const results = await service.queryKnowledgeBase(from, query, {
      ...(trimmed(body, 'id') ? { knowledgeBaseId: trimmed(body, 'id') } : {}),
      ...(typeof body.topK === 'number' ? { topK: body.topK } : {}),
      ...(typeof body.minScore === 'number' ? { minScore: body.minScore } : {}),
    })
    return { ok: true, state: 'success', data: { results } }
  } catch {
    return null // fall back to the CLI path
  }
}

async function localStudyList(from: string): Promise<MetabotCommandResult | null> {
  try {
    const homeDir = await localActorHomeDir(from)
    if (!homeDir) return null
    const rows = await studyStoreFor(homeDir).listStudyJobs(from)
    return { ok: true, state: 'success', data: { jobs: rows.map((row) => ({ ...row })) } }
  } catch {
    return null
  }
}

async function runKbCli(
  run: (args: string[], options?: RunMetabotOptions) => Promise<MetabotCommandResult>,
  args: string[],
  timeoutMs = CLI_TIMEOUT_MS,
): Promise<MetabotCommandResult> {
  return run(args, { timeoutMs })
}

export async function dispatchKbRoutes(
  method: string,
  payload: unknown,
  deps: KbRouteDeps = {},
): Promise<MetabotCommandResult | undefined> {
  if (method !== 'kb/list' && method !== 'kb/create' && method !== 'kb/update' && method !== 'kb/remove'
    && method !== 'kb/query' && method !== 'kb/add-document' && method !== 'kb/learn'
    && method !== 'study/list') {
    return undefined
  }
  const run = deps.run ?? runMetabot
  const body = payloadObject(payload)
  const from = trimmed(body, 'from')
  if (!from) return failure('missing_from', 'from is required')

  if (method === 'kb/list') {
    const local = await localKbList(from)
    if (local) return local
    return runKbCli(run, ['knowledge-base', 'list', '--from', from])
  }

  if (method === 'kb/query') {
    const local = await localKbQuery(from, body)
    if (local) return local
    const args = ['knowledge-base', 'query', '--from', from, '--text', trimmed(body, 'text')]
    if (trimmed(body, 'id')) args.push('--id', trimmed(body, 'id'))
    if (typeof body.topK === 'number') args.push('--top-k', String(Math.trunc(body.topK)))
    if (typeof body.minScore === 'number') args.push('--min-score', String(body.minScore))
    return runKbCli(run, args)
  }

  if (method === 'study/list') {
    const local = await localStudyList(from)
    if (local) return local
    return failure('study_unavailable', 'study jobs are only readable locally')
  }

  if (method === 'kb/create') {
    const name = trimmed(body, 'name')
    if (!name) return failure('missing_name', 'name is required')
    const args = ['knowledge-base', 'create', '--from', from, '--name', name]
    if (trimmed(body, 'description')) args.push('--description', trimmed(body, 'description'))
    if (typeof body.autoLearn === 'boolean') args.push('--autolearn', body.autoLearn ? 'on' : 'off')
    return runKbCli(run, args)
  }

  if (method === 'kb/update') {
    const id = trimmed(body, 'id')
    if (!id) return failure('missing_id', 'id is required')
    const args = ['knowledge-base', 'update', '--from', from, '--id', id]
    if (trimmed(body, 'name')) args.push('--name', trimmed(body, 'name'))
    if (trimmed(body, 'description')) args.push('--description', trimmed(body, 'description'))
    if (typeof body.autoLearn === 'boolean') args.push('--autolearn', body.autoLearn ? 'on' : 'off')
    return runKbCli(run, args)
  }

  if (method === 'kb/remove') {
    const id = trimmed(body, 'id')
    if (!id) return failure('missing_id', 'id is required')
    return runKbCli(run, ['knowledge-base', 'remove', '--from', from, '--id', id, '--confirm'])
  }

  if (method === 'kb/add-document') {
    const title = trimmed(body, 'title')
    const content = typeof body.content === 'string' ? body.content : ''
    if (!title) return failure('missing_title', 'title is required')
    if (!content.trim()) return failure('missing_content', 'content is required')
    const args = ['knowledge-base', 'add-document', '--from', from, '--title', title]
    if (trimmed(body, 'id')) args.push('--id', trimmed(body, 'id'))
    if (trimmed(body, 'sourceType')) args.push('--source-type', trimmed(body, 'sourceType'))
    if (trimmed(body, 'url')) args.push('--url', trimmed(body, 'url'))
    if (trimmed(body, 'pinId')) args.push('--pin-id', trimmed(body, 'pinId'))
    if (Array.isArray(body.tags) && body.tags.length) {
      const tags = body.tags.map((tag) => String(tag ?? '').trim()).filter(Boolean).slice(0, 10)
      if (tags.length) args.push('--tags', tags.join(','))
    }
    if (content.length > INLINE_CONTENT_LIMIT) {
      const dir = await mkdtemp(join(tmpdir(), 'oac-dsh-payload-'))
      const path = join(dir, 'document.txt')
      await writeFile(path, content, 'utf8')
      try {
        return await runKbCli(run, [...args, '--content-file', path], LEARN_TIMEOUT_MS)
      } finally {
        await unlink(path).catch(() => undefined)
      }
    }
    return runKbCli(run, [...args, '--content', content])
  }

  // kb/learn
  const args = ['knowledge-base', 'learn', '--from', from]
  if (trimmed(body, 'id')) args.push('--id', trimmed(body, 'id'))
  if (body.full === true) args.push('--full')
  return runKbCli(run, args, LEARN_TIMEOUT_MS)
}
