/**
 * In-process local reads for the Settings panels.
 *
 * Every `/oac/api/*` read used to spawn a fresh `metabot` CLI subprocess. The
 * CLI eagerly imports its whole command tree (bip39 / meta-contract / wallet
 * libs), so even a trivial local-file read cost ~0.7–1s of cold boot. These
 * reads are all plain local file reads, so we load the OAC read-only core
 * modules directly into the host process via `createRequire` and call them
 * here — no subprocess, no CLI boot. Each function returns a
 * `MetabotCommandResult`-shaped envelope on success, or `null` when the
 * in-process path cannot be used (module resolution failed, unexpected error),
 * in which case the caller falls back to the CLI. Write operations always stay
 * on the CLI.
 */
import { createRequire } from 'node:module'
import { basename } from 'node:path'
import { dirname, join } from 'node:path'
import { resolveCli } from './cli-bridge.js'
import type { MetabotCommandResult } from './cli-bridge.js'

const requireModule = createRequire(import.meta.url)

// Lazily-resolved OAC dist root (the directory containing `core/`, `cli/`).
let cachedDistRoot: string | null | undefined

function resolveDistRoot(): string | null {
  if (cachedDistRoot !== undefined) return cachedDistRoot
  try {
    const { cliPath } = resolveCli()
    // cliPath is <dist>/cli/main.js; the dist root two levels up holds core/.
    cachedDistRoot = dirname(dirname(cliPath))
  } catch {
    cachedDistRoot = null
  }
  return cachedDistRoot
}

const moduleCache = new Map<string, Record<string, unknown>>()

/** Require one OAC core module from the resolved dist root. Throws on failure. */
export function core(moduleRelPath: string): Record<string, unknown> {
  const cached = moduleCache.get(moduleRelPath)
  if (cached) return cached
  const distRoot = resolveDistRoot()
  if (!distRoot) throw new Error('oac dist root not resolved')
  const loaded = requireModule(join(distRoot, moduleRelPath)) as Record<string, unknown>
  moduleCache.set(moduleRelPath, loaded)
  return loaded
}

function fn<T extends (...args: never[]) => unknown>(mod: Record<string, unknown>, name: string): T {
  const value = mod[name]
  if (typeof value !== 'function') {
    throw new Error(`oac core export missing: ${name}`)
  }
  return value as T
}

function success(data: unknown): MetabotCommandResult {
  return { ok: true, state: 'success', data }
}

function systemHomeDir(): string {
  const homeSelection = core('core/state/homeSelection.js')
  const normalize = fn<(env: NodeJS.ProcessEnv, cwd: string) => string>(homeSelection, 'normalizeSystemHomeDir')
  return normalize(process.env, process.cwd())
}

/**
 * The metabot profiles root (`~/.metabot/profiles`), or null when the core
 * home layout cannot be resolved. NOTE: `normalizeSystemHomeDir` returns the
 * SYSTEM home — the `.metabot` segment comes from
 * `resolveMetabotManagerLayout`, so joining 'profiles' onto the system home
 * alone points at a directory that does not exist.
 */
export function localProfilesRoot(): string | null {
  try {
    if (process.env.OAC_DSH_NO_LOCAL_READ) return null
    const homeSelection = core('core/state/homeSelection.js')
    const layout = fn<(home: string) => { profilesRoot: string }>(homeSelection, 'resolveMetabotManagerLayout')
    return layout(systemHomeDir()).profilesRoot
  } catch {
    return null
  }
}

/** Resolve a `--from` slug/name to a profile homeDir, mirroring the CLI. */
export async function localActorHomeDir(from: string): Promise<string | null> {
  try {
    if (process.env.OAC_DSH_NO_LOCAL_READ) return null
    return await resolveActorHomeDir(from)
  } catch {
    return null
  }
}

/** Resolve a `--from` slug/name to a profile homeDir, mirroring the CLI. */
async function resolveActorHomeDir(from: string): Promise<string | null> {
  const identityProfiles = core('core/identity/identityProfiles.js')
  const nameResolution = core('core/identity/profileNameResolution.js')
  const list = fn<(dir: string) => Promise<Array<{ homeDir: string }>>>(identityProfiles, 'listIdentityProfiles')
  const match = fn<(name: string, profiles: unknown[]) => { status: string; match?: { homeDir: string } }>(
    nameResolution,
    'resolveProfileNameMatch',
  )
  const home = systemHomeDir()
  const profiles = await list(home).catch(() => [])
  const resolved = match(from, profiles)
  // resolveProfileNameMatch answers 'matched' | 'not_found' | 'ambiguous' —
  // checking for 'ok' here silently disabled every local read (all callers
  // fell back to the CLI), so it must match the matcher's own contract.
  return resolved.status === 'matched' && resolved.match ? resolved.match.homeDir : null
}

function resolvePaths(homeDir: string): unknown {
  const paths = core('core/state/paths.js')
  return fn<(homeDir: string) => unknown>(paths, 'resolveMetabotPaths')(homeDir)
}

type Reader = () => Promise<MetabotCommandResult | null>

/** Run a reader, converting any unexpected error into `null` (CLI fallback). */
async function attempt(reader: Reader): Promise<MetabotCommandResult | null> {
  if (process.env.OAC_DSH_NO_LOCAL_READ) return null
  try {
    return await reader()
  } catch {
    return null
  }
}

// ---- user -----------------------------------------------------------------

export function localUserWho(): Promise<MetabotCommandResult | null> {
  return attempt(async () => {
    const owner = core('core/owner/ownerIdentity.js')
    const read = fn<(dir: string) => Promise<unknown>>(owner, 'readOwnerIdentity')
    const toPublic = fn<(record: never) => unknown>(owner, 'toOwnerIdentityPublic')
    const record = await read(systemHomeDir())
    return success({ identity: record ? toPublic(record as never) : null })
  })
}

// ---- bots -----------------------------------------------------------------

type RuntimeIdentitySetupFields = {
  subsidyState?: string
  subsidyError?: string | null
  syncState?: string
  syncError?: string | null
}

/**
 * Local mirror of the daemon's `buildMetabotSetupStatus` (defaultHandlers.ts):
 * the daemon attaches this per profile row on list/create, so the in-process
 * list read does the same — one runtime-state read per profile, same cost
 * class as the grouptask context below.
 */
function buildSetupStatus(identity: RuntimeIdentitySetupFields | null): {
  state: 'pending' | 'subsidy_failed' | 'sync_failed' | 'ready'
  retryable: boolean
  error: string | null
} {
  const errorText = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null
  if (!identity || (!identity.subsidyState && !identity.syncState)) {
    return { state: 'ready', retryable: false, error: null }
  }
  if (identity.subsidyState !== 'claimed') {
    return {
      state: identity.subsidyState === 'failed' ? 'subsidy_failed' : 'pending',
      retryable: identity.subsidyState === 'failed',
      error: errorText(identity.subsidyError),
    }
  }
  if (identity.syncState !== 'synced' && identity.syncState !== 'partial') {
    return {
      state: identity.syncState === 'failed' ? 'sync_failed' : 'pending',
      retryable: true,
      error: errorText(identity.syncError),
    }
  }
  return { state: 'ready', retryable: false, error: null }
}

async function readSetupStatus(homeDir: string): Promise<ReturnType<typeof buildSetupStatus>> {
  const stateStore = core('core/state/runtimeStateStore.js')
  const createState = fn<(dir: string) => { readState: () => Promise<{ identity?: RuntimeIdentitySetupFields }> }>(
    stateStore,
    'createRuntimeStateStore',
  )
  const state = await createState(homeDir).readState().catch(() => null)
  return buildSetupStatus(state?.identity ?? null)
}

export function localBotList(): Promise<MetabotCommandResult | null> {
  return attempt(async () => {
    const manager = core('core/bot/metabotProfileManager.js')
    const list = fn<(dir: string) => Promise<Array<Record<string, unknown>>>>(manager, 'listMetabotProfiles')
    const profiles = await list(systemHomeDir())
    const profilesWithSetup = await Promise.all(profiles.map(async (profile) => ({
      ...profile,
      setup: typeof profile.homeDir === 'string'
        ? await readSetupStatus(profile.homeDir)
        : buildSetupStatus(null),
    })))
    return success({ profiles: profilesWithSetup })
  })
}

export function localBotShow(slug: string): Promise<MetabotCommandResult | null> {
  return attempt(async () => {
    const manager = core('core/bot/metabotProfileManager.js')
    const get = fn<(dir: string, slug: string) => Promise<unknown>>(manager, 'getMetabotProfile')
    const profile = await get(systemHomeDir(), slug)
    if (!profile) return null
    return success({ profile })
  })
}

// ---- twin -----------------------------------------------------------------

export function localTwinCurrent(): Promise<MetabotCommandResult | null> {
  return attempt(async () => {
    const twinRole = core('core/bot/twinRole.js')
    const resolve = fn<(dir: string) => Promise<string | null>>(twinRole, 'resolveCurrentTwinSlug')
    const twinSlug = await resolve(systemHomeDir())
    return success({ twinSlug })
  })
}

// ---- acting-Bot fallback (global tools in non-oac sessions) ----------------

/**
 * Machine-default Bot slug for the host global tools when a session resolves
 * no `oac-*` agent (plain DSH conversations, coding workspaces): the Twin Bot,
 * exactly what a no-`--from` CLI call targets. Cached briefly — resolution
 * scans every profile, and the tool layer calls this per exec.
 */
let twinFallbackCache: { at: number; slug: string | null } | undefined

export async function twinFallbackSlug(): Promise<string | null> {
  const now = Date.now()
  if (twinFallbackCache && now - twinFallbackCache.at < 60_000) return twinFallbackCache.slug
  const result = await localTwinCurrent()
  const slug = result?.ok
    ? (result.data as { twinSlug?: unknown } | undefined)?.twinSlug
    : undefined
  const resolved = typeof slug === 'string' && slug ? slug : null
  twinFallbackCache = { at: now, slug: resolved }
  return resolved
}

// ---- memory ---------------------------------------------------------------

export function localMemoryList(
  from: string,
  options: Record<string, unknown>,
): Promise<MetabotCommandResult | null> {
  return attempt(async () => {
    const homeDir = await resolveActorHomeDir(from)
    if (!homeDir) return null
    const { createMemoryStore } = core('core/memory/memoryStore.js') as {
      createMemoryStore: (paths: unknown) => { list: (opts: Record<string, unknown>) => Promise<unknown[]> }
    }
    const entries = await createMemoryStore(resolvePaths(homeDir)).list({
      ...(typeof options.scopeKind === 'string' ? { scopeKind: options.scopeKind } : {}),
      ...(typeof options.scopeKey === 'string' ? { scopeKey: options.scopeKey } : {}),
      ...(typeof options.usageClass === 'string' ? { usageClass: options.usageClass } : {}),
      ...(typeof options.status === 'string' ? { status: options.status } : {}),
      ...(typeof options.origin === 'string' ? { origin: options.origin } : {}),
      ...(typeof options.query === 'string' ? { query: options.query } : {}),
      ...(typeof options.limit === 'number' ? { limit: options.limit } : {}),
      ...(options.includeDeleted === true ? { includeDeleted: true } : {}),
    })
    return success({ entries })
  })
}

export function localMemoryStats(
  from: string,
  options: Record<string, unknown>,
): Promise<MetabotCommandResult | null> {
  return attempt(async () => {
    const homeDir = await resolveActorHomeDir(from)
    if (!homeDir) return null
    const { createMemoryStore } = core('core/memory/memoryStore.js') as {
      createMemoryStore: (paths: unknown) => { stats: (opts: Record<string, unknown>) => Promise<unknown> }
    }
    const stats = await createMemoryStore(resolvePaths(homeDir)).stats({
      ...(typeof options.scopeKind === 'string' ? { scopeKind: options.scopeKind } : {}),
      ...(typeof options.scopeKey === 'string' ? { scopeKey: options.scopeKey } : {}),
    })
    return success({ stats })
  })
}

export function localMemoryPolicyGet(from: string): Promise<MetabotCommandResult | null> {
  return attempt(async () => {
    const homeDir = await resolveActorHomeDir(from)
    if (!homeDir) return null
    const { createMemoryPolicyStore } = core('core/memory/memoryPolicy.js') as {
      createMemoryPolicyStore: (paths: unknown) => {
        effectivePolicy: () => Promise<unknown>
        readOverride: () => Promise<unknown>
      }
    }
    const store = createMemoryPolicyStore(resolvePaths(homeDir))
    return success({
      effective: await store.effectivePolicy(),
      override: await store.readOverride(),
    })
  })
}

// ---- knowledge ------------------------------------------------------------

export function localKnowledgeList(
  from: string,
  options: Record<string, unknown>,
): Promise<MetabotCommandResult | null> {
  return attempt(async () => {
    const homeDir = await resolveActorHomeDir(from)
    if (!homeDir) return null
    const { createKnowledgeStore } = core('core/memory/knowledgeStore.js') as {
      createKnowledgeStore: (paths: unknown) => { listKnowledge: (opts: Record<string, unknown>) => Promise<unknown[]> }
    }
    const entries = await createKnowledgeStore(resolvePaths(homeDir)).listKnowledge({
      ...(typeof options.kind === 'string' ? { kind: options.kind } : {}),
      ...(typeof options.category === 'string' ? { category: options.category } : {}),
      ...(typeof options.status === 'string' ? { status: options.status } : {}),
      ...(typeof options.query === 'string' ? { query: options.query } : {}),
      ...(typeof options.limit === 'number' ? { limit: options.limit } : {}),
    })
    return success({ entries })
  })
}

// ---- impressions ----------------------------------------------------------

export function localImpressionsList(from: string): Promise<MetabotCommandResult | null> {
  return attempt(async () => {
    const homeDir = await resolveActorHomeDir(from)
    if (!homeDir) return null
    const paths = resolvePaths(homeDir)
    const { loadChatPersona } = core('core/chat/chatPersonaLoader.js') as {
      loadChatPersona: (paths: unknown) => Promise<{ identity?: { globalMetaId?: string } }>
    }
    const persona = await loadChatPersona(paths)
    const observerGlobalMetaId = persona.identity?.globalMetaId ?? ''
    if (!observerGlobalMetaId) return null
    const { createImpressionStore } = core('core/memory/impressionStore.js') as {
      createImpressionStore: (paths: unknown) => { listSnapshots: (observer: string) => Promise<unknown[]> }
    }
    const snapshots = await createImpressionStore(paths).listSnapshots(observerGlobalMetaId) as Array<{
      subjectGlobalMetaId: string
    }>
    const { resolveContactNames } = core('core/memory/contactNames.js') as {
      resolveContactNames: (paths: unknown, ids: string[]) => Promise<Map<string, string>>
    }
    const names = await resolveContactNames(paths, snapshots.map((s) => s.subjectGlobalMetaId))
    return success({
      observerGlobalMetaId,
      snapshots: snapshots.map((s) => ({ ...s, subjectName: names.get(s.subjectGlobalMetaId) ?? null })),
    })
  })
}

export function localImpressionsShow(
  from: string,
  subject: string,
): Promise<MetabotCommandResult | null> {
  return attempt(async () => {
    const homeDir = await resolveActorHomeDir(from)
    if (!homeDir) return null
    const paths = resolvePaths(homeDir)
    const { loadChatPersona } = core('core/chat/chatPersonaLoader.js') as {
      loadChatPersona: (paths: unknown) => Promise<{ identity?: { globalMetaId?: string } }>
    }
    const persona = await loadChatPersona(paths)
    const observerGlobalMetaId = persona.identity?.globalMetaId ?? ''
    if (!observerGlobalMetaId) return null
    const { createImpressionStore } = core('core/memory/impressionStore.js') as {
      createImpressionStore: (paths: unknown) => {
        getSnapshot: (observer: string, subject: string) => Promise<unknown>
        listObservations: (opts: Record<string, unknown>) => Promise<unknown[]>
      }
    }
    const store = createImpressionStore(paths)
    const snapshot = await store.getSnapshot(observerGlobalMetaId, subject) as { subjectGlobalMetaId?: string } | null
    const observations = await store.listObservations({
      observerGlobalMetaId,
      subjectGlobalMetaId: subject,
      includeSuperseded: true,
    })
    const { resolveContactNames } = core('core/memory/contactNames.js') as {
      resolveContactNames: (paths: unknown, ids: string[]) => Promise<Map<string, string>>
    }
    const names = await resolveContactNames(paths, [subject])
    const namedSnapshot = snapshot
      ? { ...snapshot, subjectName: names.get(subject) ?? null }
      : snapshot
    return success({ observerGlobalMetaId, subject, snapshot: namedSnapshot, observations })
  })
}

// ---- dream ----------------------------------------------------------------

export function localDreamSummaries(
  from: string,
  limit?: number,
): Promise<MetabotCommandResult | null> {
  return attempt(async () => {
    const homeDir = await resolveActorHomeDir(from)
    if (!homeDir) return null
    const { createDreamStore } = core('core/memory/dreamStore.js') as {
      createDreamStore: (paths: unknown) => { listDailySummaries: (opts: Record<string, unknown>) => Promise<unknown[]> }
    }
    const summaries = await createDreamStore(resolvePaths(homeDir)).listDailySummaries({
      ...(typeof limit === 'number' ? { limit } : {}),
    })
    return success({ summaries })
  })
}

export function localDreamStatus(from: string): Promise<MetabotCommandResult | null> {
  return attempt(async () => {
    const homeDir = await resolveActorHomeDir(from)
    if (!homeDir) return null
    const { dreamStatus } = core('core/memory/dreamService.js') as {
      dreamStatus: (paths: unknown) => Promise<unknown>
    }
    const status = await dreamStatus(resolvePaths(homeDir))
    return success(status)
  })
}

export function localDreamSelfIdentity(from: string): Promise<MetabotCommandResult | null> {
  return attempt(async () => {
    const homeDir = await resolveActorHomeDir(from)
    if (!homeDir) return null
    const { createMemoryStore } = core('core/memory/memoryStore.js') as {
      createMemoryStore: (paths: unknown) => {
        list: (opts: Record<string, unknown>) => Promise<Array<{ text?: string; updatedAt?: number }>>
      }
    }
    const entries = await createMemoryStore(resolvePaths(homeDir)).list({
      usageClass: 'self_identity',
      status: 'created',
      limit: 1,
    })
    return success({
      text: entries[0]?.text ?? '',
      updatedAt: entries[0]?.updatedAt ?? null,
    })
  })
}

// ---- group tasks ----------------------------------------------------------
// The daemon engine's 5s tick keeps the per-profile grouptask stores synced
// from the chain indexers, so the panel reads can be served straight from the
// local JSON stores (sync:false semantics) instead of booting a CLI per poll.
// Writes, guest transcripts, and the health preflight stay on the CLI.

async function grouptaskServiceContext(): Promise<Record<string, unknown> | null> {
  const manager = core('core/bot/metabotProfileManager.js')
  const list = fn<(dir: string) => Promise<Array<Record<string, unknown>>>>(manager, 'listMetabotProfiles')
  const stateStore = core('core/state/runtimeStateStore.js')
  const createState = fn<(homeDir: string) => { readState: () => Promise<{ identity?: { metaId?: unknown } }> }>(
    stateStore,
    'createRuntimeStateStore',
  )
  const profiles = await list(systemHomeDir()).catch(() => [])
  const refs = await Promise.all(profiles.map(async (profile) => ({
    slug: typeof profile.slug === 'string' ? profile.slug : '',
    homeDir: typeof profile.homeDir === 'string' ? profile.homeDir : '',
    name: typeof profile.name === 'string' ? profile.name : '',
    globalMetaId: typeof profile.globalMetaId === 'string' ? profile.globalMetaId : null,
    metaId: await createState(profile.homeDir as string)
      .readState()
      .then((state) => (typeof state.identity?.metaId === 'string' ? state.identity.metaId : null))
      .catch(() => null),
    botType: profile.botType === 'twin' ? 'twin' : profile.botType === 'worker' ? 'worker' : null,
    avatar: typeof profile.avatarDataUrl === 'string' ? profile.avatarDataUrl : null,
  })))
  if (!refs.some((ref) => ref.slug !== '')) return null
  return {
    listProfiles: async () => refs,
    getProfile: async (slug: string) => refs.find((ref) => ref.slug === slug) ?? null,
  }
}

function normalizeGrouptaskTab(tab: string): 'active' | 'done' | 'cancelled' | 'all' {
  return tab === 'active' || tab === 'done' || tab === 'cancelled' ? tab : 'all'
}

export function localGrouptaskList(
  tab: string,
  includeArchived: boolean,
): Promise<MetabotCommandResult | null> {
  return attempt(async () => {
    const ctx = await grouptaskServiceContext()
    if (!ctx) return null
    const { listGroupTaskSummaries } = core('core/grouptask/service.js') as {
      listGroupTaskSummaries: (ctx: unknown, options: Record<string, unknown>) => Promise<unknown[]>
    }
    const tasks = await listGroupTaskSummaries(ctx, {
      tab: normalizeGrouptaskTab(tab),
      includeArchived,
    })
    return success({ tasks })
  })
}

export function localGrouptaskDetail(
  chair: string,
  taskId: number,
  view: string,
): Promise<MetabotCommandResult | null> {
  return attempt(async () => {
    const ctx = await grouptaskServiceContext()
    if (!ctx) return null
    const { getGroupTaskDetail } = core('core/grouptask/service.js') as {
      getGroupTaskDetail: (
        ctx: unknown,
        chairSlug: string,
        taskId: number,
        opts: { view: 'summary' | 'full'; sync: boolean },
      ) => Promise<unknown>
    }
    const detail = await getGroupTaskDetail(ctx, chair, taskId, {
      view: view === 'summary' ? 'summary' : 'full',
      sync: false,
    })
    return success(detail)
  })
}

export function localGrouptaskMessages(
  chair: string,
  taskId: number,
  limit: number | undefined,
  beforeIndex: number | undefined,
): Promise<MetabotCommandResult | null> {
  return attempt(async () => {
    const ctx = await grouptaskServiceContext()
    if (!ctx) return null
    const { listGroupTaskMessages } = core('core/grouptask/service.js') as {
      listGroupTaskMessages: (
        ctx: unknown,
        chairSlug: string,
        taskId: number,
        opts: { limit?: number; beforeIndex?: number; sync: boolean },
      ) => Promise<unknown>
    }
    const page = await listGroupTaskMessages(ctx, chair, taskId, {
      ...(typeof limit === 'number' ? { limit } : {}),
      ...(typeof beforeIndex === 'number' ? { beforeIndex } : {}),
      sync: false,
    })
    return success(page)
  })
}

export function localGrouptaskCollabs(): Promise<MetabotCommandResult | null> {
  return attempt(async () => {
    const ctx = await grouptaskServiceContext()
    if (!ctx) return null
    const { listOpenTeamCollabs } = core('core/grouptask/openteamService.js') as {
      listOpenTeamCollabs: (ctx: unknown) => Promise<unknown>
    }
    return success(await listOpenTeamCollabs(ctx))
  })
}

// ---- A2A conversations ----------------------------------------------------
// Fallback reads for `conversations/list` / `conversations/messages`. The
// primary path is the daemon's `/api/conversations*` HTTP API (see
// conversation-bridge.ts), which enriches peer names/avatars through the
// profile index + chain-profile cache. These raw projections serve only when
// the daemon is unreachable, ahead of the CLI fallback.

async function resolveProfileRecord(from: string): Promise<{ homeDir: string; globalMetaId: string } | null> {
  const identityProfiles = core('core/identity/identityProfiles.js')
  const nameResolution = core('core/identity/profileNameResolution.js')
  const list = fn<(dir: string) => Promise<Array<{ homeDir: string; globalMetaId: string }>>>(
    identityProfiles,
    'listIdentityProfiles',
  )
  const match = fn<
    (name: string, profiles: unknown[]) => { status: string; match?: { homeDir: string; globalMetaId: string } }
  >(nameResolution, 'resolveProfileNameMatch')
  const home = systemHomeDir()
  const profiles = await list(home).catch(() => [])
  const resolved = match(from, profiles)
  // resolveProfileNameMatch answers 'matched' | 'not_found' | 'ambiguous' (same
  // contract note as resolveActorHomeDir above).
  return resolved.status === 'matched' && resolved.match ? resolved.match : null
}

export function localConversationsList(from: string, limit?: number): Promise<MetabotCommandResult | null> {
  return attempt(async () => {
    const profile = await resolveProfileRecord(from)
    if (!profile) return null
    const { listPeerConversationSummaries } = core('core/a2a/conversationProjection.js') as {
      listPeerConversationSummaries: (input: Record<string, unknown>) => Promise<unknown>
    }
    const result = await listPeerConversationSummaries({
      homeDir: profile.homeDir,
      localGlobalMetaId: profile.globalMetaId,
      ...(typeof limit === 'number' ? { limit } : {}),
    })
    return success(result)
  })
}

export function localConversationsMessages(
  from: string,
  peer: string,
  options: { limit?: number; before?: number; after?: number } = {},
): Promise<MetabotCommandResult | null> {
  return attempt(async () => {
    const profile = await resolveProfileRecord(from)
    if (!profile) return null
    const { readPeerConversationMessages } = core('core/a2a/conversationProjection.js') as {
      readPeerConversationMessages: (input: Record<string, unknown>) => Promise<unknown>
    }
    const result = await readPeerConversationMessages({
      homeDir: profile.homeDir,
      localGlobalMetaId: profile.globalMetaId,
      peerGlobalMetaId: peer,
      ...(typeof options.limit === 'number' ? { limit: options.limit } : {}),
      ...(typeof options.before === 'number' ? { before: options.before } : {}),
      ...(typeof options.after === 'number' ? { after: options.after } : {}),
    })
    return success(result)
  })
}

// ---- chat skills ------------------------------------------------------------
// In-process port of the CLI's `services skills` (listPublishSkills): a pure
// local catalog read — profile resolution, runtime stores, and the platform
// skill catalog. Spawning the CLI for this cost ~1s per Bot-editor open.

export function localChatSkills(from: string): Promise<MetabotCommandResult | null> {
  return attempt(async () => {
    const homeDir = await resolveActorHomeDir(from)
    if (!homeDir) return null
    const paths = resolvePaths(homeDir) as { systemHomeDir: string; profileRoot: string }
    const stateStore = core('core/state/runtimeStateStore.js')
    const createState = fn<(dir: string) => { readState: () => Promise<{ identity?: Record<string, unknown> }> }>(
      stateStore,
      'createRuntimeStateStore',
    )
    const state = await createState(homeDir).readState()
    const llmRuntime = core('core/llm/llmRuntimeStore.js')
    const llmBinding = core('core/llm/llmBindingStore.js')
    const catalogModule = core('core/services/platformSkillCatalog.js')
    const createRuntimeStore = fn<(input: unknown) => unknown>(llmRuntime, 'createLlmRuntimeStore')
    const createBindingStore = fn<(input: unknown) => unknown>(llmBinding, 'createLlmBindingStore')
    const createCatalog = fn<(options: Record<string, unknown>) => {
      listSkillsForPlatform: (opts: { platformId: string; includeSharedAgents?: boolean }) => Promise<{
        ok: boolean
        skills: unknown
        rootDiagnostics: unknown
      }>
    }>(catalogModule, 'createPlatformSkillCatalog')
    const catalog = createCatalog({
      runtimeStore: createRuntimeStore(paths),
      bindingStore: createBindingStore(paths),
      systemHomeDir: paths.systemHomeDir,
      projectRoot: paths.profileRoot,
      env: process.env,
    })
    const metaBotSlug = basename(paths.profileRoot)
    // DSH scope: exactly the skill surface a DSH session can execute —
    // ~/.dsh/skills, the profile workspace's .dsh/skills, and the
    // ~/.agents/skills shared standard. Never the local CLI platforms.
    const result = await catalog.listSkillsForPlatform({ platformId: 'dsh' })
    return success({
      metaBotSlug,
      identity: state.identity
        ? {
          metabotId: state.identity.metabotId,
          name: state.identity.name,
          globalMetaId: state.identity.globalMetaId,
        }
        : null,
      platform: { id: 'dsh' },
      skills: result.skills,
      rootDiagnostics: result.rootDiagnostics,
    })
  })
}
