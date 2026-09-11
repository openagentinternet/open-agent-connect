/**
 * One MetaBot = one DSH agent preset (`oac-<slug>`). Copy shipped `standard`,
 * rewrite the persona row, leave other composition rows (including `!!js`)
 * untouched. Persona edits rewrite the file in place so running sessions keep
 * DSH's composition stamp; later sessions see the new text.
 *
 * DSH 0.1.3-alpha.2 split the persona config into `prefix`/`suffix`; the Bot
 * persona is the prefix, a copied row's `suffix` is kept, and any legacy
 * `text` key is dropped (0.1.5's persona schema requires `prefix` and ignores
 * `text`, so legacy rows must be healed here, not just appended to).
 */
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { isOacPresetId, presetIdForSlug } from './chip-logic.js'
import type { AgentPresetsLike, HostContext } from './context-types.js'
import { buildPersonaPrompt, parseBotListData, type BotPersonaInput } from './persona.js'
import { runMetabot, type MetabotCommandResult } from './cli-bridge.js'

export const STANDARD_PRESET_ID = 'standard'
export const USER_PRESET_DIR = '.agent-presets'
export const COMPOSITION_FILE = 'agent.cordis.yml'
export const METADATA_FILE = 'preset.yml'
/**
 * Pre-per-Bot installs (the oac-dsh-adaptation template) left one shared bare
 * `oac` preset ("Open Agent Connect (MetaBot)") mounting stale `metabot_*`
 * tool rows. The per-Bot design never creates it, so reconcile removes it.
 */
export const LEGACY_SHARED_PRESET_ID = 'oac'

export {
  isOacPresetId,
  presetIdForSlug,
  PRESET_ID_PREFIX,
} from './chip-logic.js'

function dshHomeFile(ctx: HostContext, ...segments: string[]): string {
  const fromGet = ctx.get?.('dshHomePath')
  if (typeof fromGet === 'function') {
    return (fromGet as (...parts: string[]) => string)(...segments)
  }
  if (typeof ctx.dshHomePath === 'function') {
    return ctx.dshHomePath(...segments)
  }
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), ...segments)
}

export function presetDir(ctx: HostContext, presetId: string): string {
  return dshHomeFile(ctx, USER_PRESET_DIR, presetId)
}

interface EntryRow {
  id?: string
  config?: Record<string, unknown>
}

function requirePresets(ctx: HostContext): AgentPresetsLike {
  if (ctx.agentPresets === undefined) {
    throw new Error('oac-dsh: agentPresets service is not available')
  }
  return ctx.agentPresets
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && /already exists/.test(error.message)
}

async function rewritePersona(ctx: HostContext, bot: BotPersonaInput, presetId: string): Promise<void> {
  const dir = presetDir(ctx, presetId)
  const compositionPath = join(dir, COMPOSITION_FILE)
  const entries: unknown = yaml.load(await readFile(compositionPath, 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(entries)) {
    throw new Error(`oac-dsh: preset composition is not an entry list: ${compositionPath}`)
  }
  const persona = (entries as EntryRow[]).find((entry) => entry?.id === 'persona')
  if (persona === undefined) {
    throw new Error(`oac-dsh: source preset has no "persona" row to rewrite: ${compositionPath}`)
  }
  const { text: _legacyText, ...rest } = persona.config ?? {}
  persona.config = { ...rest, prefix: buildPersonaPrompt(bot) }
  await writeFile(compositionPath, yaml.dump(entries, { schema: entryListSchema }), 'utf8')

  const metadataPath = join(dir, METADATA_FILE)
  let metadata: unknown
  try {
    metadata = yaml.load(await readFile(metadataPath, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const row = (metadata !== null && typeof metadata === 'object' ? metadata : {}) as Record<string, unknown>
  row.name = bot.name
  row.description = `Open Agent Connect Bot "${bot.name}" (slug ${bot.slug})`
  await writeFile(metadataPath, yaml.dump(row), 'utf8')
}

/**
 * Ensure `oac-<slug>` exists and its persona matches the Bot. Copy `standard`
 * only when the id is new; existing presets are rewritten in place.
 */
export async function generatePreset(ctx: HostContext, bot: BotPersonaInput): Promise<string> {
  const presets = requirePresets(ctx)
  const presetId = presetIdForSlug(bot.slug)
  try {
    await presets.copy(STANDARD_PRESET_ID, presetId, bot.name)
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
  }
  await rewritePersona(ctx, bot, presetId)
  return presetId
}

export async function removePreset(ctx: HostContext, slug: string): Promise<void> {
  const presetId = presetIdForSlug(slug)
  try {
    await requirePresets(ctx).remove(presetId)
  } catch (error) {
    if (error instanceof Error && /not found/.test(error.message)) return
    throw error
  }
}

export type ReconcileResult = {
  wanted: string[]
  createdOrUpdated: string[]
  removed: string[]
}

/**
 * A host whose `agent-presets.default` still points at the legacy shared
 * `oac` preset (removed by reconcile) heals to the stock `standard` preset —
 * a dangling default would otherwise break or silently degrade new sessions.
 * Returns true when the setting was rewritten. Only an exact `oac` default
 * is touched; any other value is the host's own choice.
 */
export async function healLegacyDefaultPresetSetting(ctx: HostContext): Promise<boolean> {
  const settingsPath = dshHomeFile(ctx, 'settings.yaml')
  let raw: string
  try {
    raw = await readFile(settingsPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  const settings = (yaml.load(raw) ?? {}) as Record<string, unknown>
  const presets = settings['agent-presets']
  if (presets === null || typeof presets !== 'object' || Array.isArray(presets)) return false
  const row = presets as Record<string, unknown>
  if (row.default !== LEGACY_SHARED_PRESET_ID) return false
  row.default = STANDARD_PRESET_ID
  await writeFile(settingsPath, yaml.dump(settings), 'utf8')
  return true
}

/**
 * Every `metabot bot list` entry ↔ `oac-<slug>`. Create missing, rewrite
 * persona, remove plugin-owned `oac-*` presets whose Bot is gone. Never touch
 * non-`oac-*` presets — except the legacy shared `oac` preset from pre
 * per-Bot installs, which is removed (and a dangling `agent-presets.default`
 * pointing at it healed to `standard`).
 */
export async function reconcilePresets(
  ctx: HostContext,
  listBots: () => Promise<MetabotCommandResult> = () => runMetabot(['bot', 'list']),
): Promise<ReconcileResult> {
  const result = await listBots()
  if (!result.ok || result.state !== 'success') {
    throw new Error(result.message ?? 'metabot bot list failed')
  }
  const bots = parseBotListData(result.data)
  const presets = requirePresets(ctx)
  const existing = await presets.list()
  const owned = existing.map((row) => row.id).filter(isOacPresetId)
  const wanted = bots.map((bot) => presetIdForSlug(bot.slug))
  const wantedSet = new Set(wanted)
  const createdOrUpdated: string[] = []
  for (const bot of bots) {
    createdOrUpdated.push(await generatePreset(ctx, bot))
  }
  const removed: string[] = []
  for (const id of owned) {
    if (wantedSet.has(id)) continue
    await presets.remove(id)
    removed.push(id)
  }
  if (existing.some((row) => row.id === LEGACY_SHARED_PRESET_ID)) {
    await presets.remove(LEGACY_SHARED_PRESET_ID)
    removed.push(LEGACY_SHARED_PRESET_ID)
    await healLegacyDefaultPresetSetting(ctx)
  }
  return { wanted, createdOrUpdated, removed }
}
