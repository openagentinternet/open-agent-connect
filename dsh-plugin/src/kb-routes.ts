/**
 * Knowledge-base / study routes — the host surface for the bot editor's
 * Knowledge tab (Settings → Bots), mirroring IDBots' knowledgeBase:* IPC
 * surface. Reads (kb/list, study/list) run in-process against the OAC core
 * stores; writes forward to the `metabot knowledge-base` CLI verbs so the CLI
 * stays the single management surface. `kb/import` is a raw-byte upload (like
 * file/upload): the bytes land in a temp file and the core importFiles copies
 * them into the KB's raw corpus. Indexing is a separate, explicit Learn click
 * (IDBots parity) or the nightly auto-learn.
 */
import { mkdtemp, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { runMetabot, type MetabotCommandResult, type RunMetabotOptions } from './cli-bridge.js'
import { core, localActorHomeDir } from './local-read.js'

const CLI_TIMEOUT_MS = 60_000
// Converter-heavy learn of large binary docs (pdf/pptx/epub) can take minutes.
const LEARN_TIMEOUT_MS = 300_000

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

/** In-process stores bound to one profile home (memoized like the agent tools). */
type KbServiceLike = {
  ensureDefaultKnowledgeBase(slug: string): Promise<unknown>
  store: {
    getKnowledgeBase(id: string): Promise<Record<string, unknown> | null>
    listKnowledgeBases(): Promise<Array<Record<string, unknown>>>
  }
  importFiles(slug: string, knowledgeBaseId: string, filePaths: string[]): Promise<number>
}

const serviceCache = new Map<string, KbServiceLike>()

type StudyStoreLike = {
  listStudyJobs(slug?: string): Promise<Array<Record<string, unknown>>>
}

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
    && method !== 'kb/learn' && method !== 'study/list') {
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

  // kb/learn
  const args = ['knowledge-base', 'learn', '--from', from]
  if (trimmed(body, 'id')) args.push('--id', trimmed(body, 'id'))
  if (body.full === true) args.push('--full')
  return runKbCli(run, args, LEARN_TIMEOUT_MS)
}

/**
 * Raw-byte document import for one KB (`POST /oac/api/kb/import?from=&id=&filename=`,
 * body = file bytes). The bytes land in a temp file (oac-dsh-payload
 * convention, unlinked after the run) and the core importFiles copies them
 * into the KB's raw corpus; indexing stays an explicit Learn click.
 */
export async function importKbFile(
  from: string,
  knowledgeBaseId: string,
  filename: string,
  bytes: Buffer,
): Promise<MetabotCommandResult> {
  if (!from) return failure('missing_from', 'from is required')
  if (!knowledgeBaseId) return failure('missing_id', 'id is required')
  if (bytes.length === 0) return failure('empty_body', 'import body is empty')
  const homeDir = await localActorHomeDir(from)
  if (!homeDir) return failure('kb_unavailable', 'knowledge bases are only manageable locally')
  const service = kbServiceFor(homeDir)
  const slug = basename(pathsOf(homeDir).profileRoot)
  const kb = await service.store.getKnowledgeBase(knowledgeBaseId)
  if (!kb || kb.metabotSlug !== slug) {
    return failure('kb_not_found', `Knowledge base ${knowledgeBaseId} not found for this Bot.`)
  }
  const safeName = basename(filename || 'document.bin')
  const dir = await mkdtemp(join(tmpdir(), 'oac-dsh-payload-'))
  const path = join(dir, safeName)
  await writeFile(path, bytes)
  try {
    const imported = await service.importFiles(slug, knowledgeBaseId, [path])
    if (!imported) return failure('unsupported_format', `"${safeName}" is not a supported document format.`)
    return { ok: true, state: 'success', data: { imported, knowledgeBaseId } }
  } catch (error) {
    return failure('import_failed', error instanceof Error ? error.message : String(error))
  } finally {
    await unlink(path).catch(() => undefined)
  }
}
