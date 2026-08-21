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
function core(moduleRelPath: string): Record<string, unknown> {
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
  return resolved.status === 'ok' && resolved.match ? resolved.match.homeDir : null
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

export function localBotList(): Promise<MetabotCommandResult | null> {
  return attempt(async () => {
    const manager = core('core/bot/metabotProfileManager.js')
    const list = fn<(dir: string) => Promise<unknown[]>>(manager, 'listMetabotProfiles')
    const profiles = await list(systemHomeDir())
    return success({ profiles })
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
    const snapshots = await createImpressionStore(paths).listSnapshots(observerGlobalMetaId)
    return success({ observerGlobalMetaId, snapshots })
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
    const snapshot = await store.getSnapshot(observerGlobalMetaId, subject)
    const observations = await store.listObservations({
      observerGlobalMetaId,
      subjectGlobalMetaId: subject,
      includeSuperseded: true,
    })
    return success({ observerGlobalMetaId, subject, snapshot, observations })
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
