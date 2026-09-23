/**
 * DSH 0.1.7 preset backend. The directory presets (`~/.dsh/.agent-presets/<id>`,
 * `agentPresets.copy/read/remove`) are gone on 0.1.7: presets are declarative
 * `PresetDefinition`s registered in memory on the same `agentPresets` service
 * (now the AgentPresetRegistry), which eagerly mounts them and reports broken
 * rows in the roster instead of failing activation at session start.
 *
 * One MetaBot = one `oac-<slug>` definition: the plugins list is read from the
 * host installation's CURRENT shipped `standard` preset declaration
 * (`@deepseek-ai/dsh-web-app/presets/standard.patch.yml`, re-read on every
 * call so kernel upgrades renaming composition rows heal automatically), with
 * the persona row rewritten to the Bot persona (0.1.3-alpha.2 prefix/suffix
 * split: the Bot persona is the `prefix`, the copied `suffix` is kept, a
 * legacy `text` key is dropped).
 *
 * Registrations are process-local, so every apply re-declares the set; the
 * state lives under a `Symbol.for` key so a hot module reload keeps the
 * disposers and never double-registers. A content-identical definition is
 * left untouched (register() eagerly mounts a fresh generation, so churn is
 * not free). `agent-preset/selected` and `agent-preset/invalid` semantics are
 * unchanged on this backend.
 */
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { isOacPresetId, presetIdForSlug } from './chip-logic.js'
import type { AgentPresetsLike, HostContext, HostPresetDefinition, HostPresetEntry } from './context-types.js'
import { buildPersonaPrompt, type BotPersonaInput } from './persona.js'
import type { ReconcileResult } from './preset.js'

/** Shipped presets occupy order 1-4 (standard/ptc/minimal/cordis); Bots follow. */
export const OAC_PRESET_ORDER = 10

const STANDARD_PATCH_SPEC = '@deepseek-ai/dsh-web-app/presets/standard.patch.yml'
const STANDARD_DECLARATION_ID = 'preset-standard'
const STANDARD_PRESET_ID = 'standard'

type RegistryRegister = NonNullable<AgentPresetsLike['register']>
export type RegistryBackedPresets = AgentPresetsLike & { register: RegistryRegister }

/** 0.1.7 feature detection: the registry service declares presets; the legacy one copied directories. */
export function registryBackendOf(presets: AgentPresetsLike | undefined): RegistryBackedPresets | undefined {
  if (presets !== undefined && typeof presets.register === 'function') return presets as RegistryBackedPresets
  return undefined
}

interface RegistrationRecord {
  signature: string
  /** Undefined marks a foreign declaration (profile patch owns the id). */
  dispose?: () => Promise<void> | void
}

interface RegistryState {
  registrations: Map<string, RegistrationRecord>
  queue: Promise<void>
  hookedCtxs: WeakSet<object>
}

const STATE_KEY = Symbol.for('open-agent-connect-dsh.presetRegistrations')

function registryState(): RegistryState {
  const store = globalThis as unknown as Record<symbol, RegistryState | undefined>
  let state = store[STATE_KEY]
  if (state === undefined) {
    state = { registrations: new Map(), queue: Promise.resolve(), hookedCtxs: new WeakSet() }
    store[STATE_KEY] = state
  }
  return state
}

/** Serialize register/unregister so a re-register always follows its unregister. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const state = registryState()
  const result = state.queue.then(task)
  state.queue = result.then(() => undefined, () => undefined)
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The running profile's directory on 0.1.7 (`ctx.profileContext`, launcher-injected). */
function profileDirOf(ctx: HostContext): string | undefined {
  try {
    const profileContext = ctx.get?.('profileContext')
    if (isRecord(profileContext) && typeof profileContext.dir === 'string') return profileContext.dir
  } catch {
    // No profileContext on this host line — fall through to the own-location anchor.
  }
  return undefined
}

/**
 * Locate the host installation's shipped `standard` preset declaration. The
 * profile anchor serves production installs (and dev `link:` mounts, where the
 * plugin realpath escapes the profile); the plugin's own location resolves the
 * devDependency copy in this repository's checkout.
 */
function resolveStandardPatchPath(ctx: HostContext): string | undefined {
  const require = createRequire(import.meta.url)
  const anchors = [profileDirOf(ctx), import.meta.url]
  for (const anchor of anchors) {
    if (anchor === undefined) continue
    try {
      return require.resolve(STANDARD_PATCH_SPEC, { paths: [anchor] })
    } catch {
      // Try the next anchor.
    }
  }
  return undefined
}

/** Test hook: replace shipped-standard resolution (pass undefined to restore). */
export function setStandardPatchResolverForTests(override: (() => Promise<string>) | undefined): void {
  resolverOverride = override
}
let resolverOverride: (() => Promise<string>) | undefined

/** The patch file is a list of ops; the `standard` declaration row sits in an `insert` (bare rows tolerated). */
function findStandardDeclaration(parsed: unknown, at: string): HostPresetEntry {
  if (!Array.isArray(parsed)) {
    throw new Error(`oac-dsh: shipped standard preset patch is not an op list: ${at}`)
  }
  for (const op of parsed) {
    if (!isRecord(op)) continue
    const inserted = op.insert
    const rows = Array.isArray(inserted) ? inserted : [op]
    for (const row of rows) {
      if (isRecord(row) && row.id === STANDARD_DECLARATION_ID) return row as unknown as HostPresetEntry
    }
  }
  throw new Error(`oac-dsh: shipped preset patch has no "${STANDARD_DECLARATION_ID}" row: ${at}`)
}

/**
 * The host's CURRENT shipped `standard` composition as a definition plugins
 * list, `!!js` markers preserved. Throws when the file cannot be located or
 * carries no plugins list — a guess-composed preset would strand every Bot
 * session on a broken mount, so nothing is invented here.
 */
export async function readStandardPresetPlugins(ctx: HostContext): Promise<HostPresetEntry[]> {
  const patchPath = resolverOverride !== undefined ? await resolverOverride() : resolveStandardPatchPath(ctx)
  if (patchPath === undefined) {
    throw new Error(`oac-dsh: cannot resolve ${STANDARD_PATCH_SPEC} from the profile or the plugin install`)
  }
  const parsed: unknown = yaml.load(await readFile(patchPath, 'utf8'), { schema: entryListSchema })
  const declaration = findStandardDeclaration(parsed, patchPath)
  const config = isRecord(declaration.config) ? declaration.config : undefined
  if (config?.id !== STANDARD_PRESET_ID || !Array.isArray(config.plugins)) {
    throw new Error(`oac-dsh: "${STANDARD_DECLARATION_ID}" row carries no plugins list: ${patchPath}`)
  }
  return config.plugins as HostPresetEntry[]
}

function rewritePersonaEntry(entries: HostPresetEntry[], bot: BotPersonaInput, at: string): void {
  const persona = entries.find((entry) => entry?.id === 'persona')
  if (persona === undefined) {
    throw new Error(`oac-dsh: source preset has no "persona" row to rewrite: ${at}`)
  }
  const config = isRecord(persona.config) ? persona.config : {}
  const { text: _legacyText, ...rest } = config
  persona.config = { ...rest, prefix: buildPersonaPrompt(bot) }
}

function definitionFor(bot: BotPersonaInput, plugins: readonly HostPresetEntry[]): HostPresetDefinition {
  return {
    id: presetIdForSlug(bot.slug),
    name: bot.name,
    description: `Open Agent Connect Bot "${bot.name}" (slug ${bot.slug})`,
    order: OAC_PRESET_ORDER,
    plugins,
  }
}

function warn(ctx: HostContext, message: string): void {
  ctx.logger?.warn?.(message)
}

/**
 * Ensure `oac-<slug>` is registered against the current shipped `standard`.
 * Content-identical definitions are left untouched; a drifted one is
 * unregistered then re-registered (a full generation swap, so it only happens
 * on real change). A foreign declaration owning the id (profile patch) wins
 * and is left alone, warned once per process.
 */
export async function ensureRegistryPreset(ctx: HostContext, presets: RegistryBackedPresets, bot: BotPersonaInput): Promise<string> {
  const plugins = await readStandardPresetPlugins(ctx)
  rewritePersonaEntry(plugins, bot, `shipped "${STANDARD_PRESET_ID}" preset`)
  const definition = definitionFor(bot, plugins)
  const signature = JSON.stringify(definition)
  await enqueue(async () => {
    const state = registryState()
    const existing = state.registrations.get(definition.id)
    if (existing !== undefined && existing.signature === signature) return
    if (existing?.dispose !== undefined) await existing.dispose()
    let dispose: (() => Promise<void>) | (() => void)
    try {
      dispose = await presets.register(definition)
    } catch (error) {
      if (error instanceof Error && /duplicate/i.test(error.message)) {
        warn(ctx, `oac-dsh: preset "${definition.id}" is declared outside the plugin; leaving the foreign declaration in place`)
        state.registrations.set(definition.id, { signature })
        return
      }
      throw error
    }
    state.registrations.set(definition.id, { signature, dispose })
  })
  return definition.id
}

/** Unregister the Bot's preset when this process declared it; otherwise a no-op. */
export async function removeRegistryPreset(_ctx: HostContext, _presets: RegistryBackedPresets, slug: string): Promise<void> {
  const presetId = presetIdForSlug(slug)
  await enqueue(async () => {
    const state = registryState()
    const existing = state.registrations.get(presetId)
    state.registrations.delete(presetId)
    if (existing?.dispose !== undefined) await existing.dispose()
  })
}

/** Unregister everything this plugin declared (plugin disable/reload). */
async function disposeAllRegistrations(): Promise<void> {
  const state = registryState()
  const records = [...state.registrations.values()]
  state.registrations.clear()
  for (const record of records) {
    if (record.dispose !== undefined) await record.dispose()
  }
}

/**
 * Registry-path reconcile: register every Bot's preset from the current
 * shipped standard, and unregister tracked `oac-*` presets whose Bot is gone.
 * The legacy shared `oac` preset and the `agent-presets.default` setting are
 * pre-0.1.7 directory/settings artifacts — invisible to the registry — so
 * neither cleanup runs on this backend.
 */
export async function reconcileRegistryPresets(
  ctx: HostContext,
  presets: RegistryBackedPresets,
  bots: readonly BotPersonaInput[],
): Promise<ReconcileResult> {
  const state = registryState()
  if (!state.hookedCtxs.has(ctx)) {
    state.hookedCtxs.add(ctx)
    ctx.effect(() => () => { void enqueue(disposeAllRegistrations) }, 'oac-dsh: preset registrations')
  }
  const wanted = bots.map((bot) => presetIdForSlug(bot.slug))
  const wantedSet = new Set(wanted)
  const createdOrUpdated: string[] = []
  for (const bot of bots) {
    createdOrUpdated.push(await ensureRegistryPreset(ctx, presets, bot))
  }
  const removed: string[] = []
  for (const id of [...state.registrations.keys()]) {
    if (!isOacPresetId(id) || wantedSet.has(id)) continue
    await enqueue(async () => {
      const current = registryState().registrations.get(id)
      registryState().registrations.delete(id)
      if (current?.dispose !== undefined) await current.dispose()
    })
    removed.push(id)
  }
  return { wanted, createdOrUpdated, removed }
}
