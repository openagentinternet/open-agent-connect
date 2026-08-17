/**
 * One MetaBot = one DSH agent preset (`oac-<slug>`). Copy shipped `standard`,
 * rewrite the persona row, leave other composition rows (including `!!js`)
 * untouched. Persona edits rewrite the file in place so running sessions keep
 * DSH's composition stamp; later sessions see the new text.
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

export {
  isOacPresetId,
  presetIdForSlug,
  PRESET_ID_PREFIX,
} from './chip-logic.js'

export function presetDir(ctx: HostContext, presetId: string): string {
  const fromGet = ctx.get?.('dshHomePath')
  if (typeof fromGet === 'function') {
    return (fromGet as (...segments: string[]) => string)(USER_PRESET_DIR, presetId)
  }
  if (typeof ctx.dshHomePath === 'function') {
    return ctx.dshHomePath(USER_PRESET_DIR, presetId)
  }
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), USER_PRESET_DIR, presetId)
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
  persona.config = { ...(persona.config ?? {}), text: buildPersonaPrompt(bot) }
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
 * Every `metabot bot list` entry ↔ `oac-<slug>`. Create missing, rewrite
 * persona, remove plugin-owned `oac-*` presets whose Bot is gone. Never touch
 * non-`oac-*` presets.
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
  return { wanted, createdOrUpdated, removed }
}
