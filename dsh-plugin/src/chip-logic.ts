/** Shared OAC preset-id helpers (host + client). No Node APIs. */

export const PRESET_ID_PREFIX = 'oac-'

export function presetIdForSlug(slug: string): string {
  return `${PRESET_ID_PREFIX}${slug}`
}

export function isOacPresetId(id: string): boolean {
  return id.startsWith(PRESET_ID_PREFIX) && id.length > PRESET_ID_PREFIX.length
}

export function slugFromPresetId(id: string): string | undefined {
  if (!isOacPresetId(id)) return undefined
  return id.slice(PRESET_ID_PREFIX.length)
}

export type ChipPresetOption = {
  id: string
  trust: 'system' | 'user'
  name?: string
  description?: string
  broken?: string
}

export type ChipBot = {
  name: string
  slug: string
  avatarDataUrl?: string
  dshLlmProvider?: string | null
  dshLlmModel?: string | null
}

export type ChipSession = {
  blank: boolean
  agentPreset?: string
}

export type AdvertisedGroup = {
  id: string
  models: ReadonlyArray<{ id: string }>
}

/** Healthy presets only, including non-OAC rows. Broken entries cannot compose a session. */
export function filterSelectablePresets(presets: readonly ChipPresetOption[]): ChipPresetOption[] {
  return presets.filter((preset) => preset.broken === undefined).map((preset) => ({
    id: preset.id,
    trust: preset.trust,
    ...(preset.name === undefined ? {} : { name: preset.name }),
    ...(preset.description === undefined ? {} : { description: preset.description }),
  }))
}

/** OAC presets show the Bot name; every other preset keeps its own roster copy. */
export function chipDisplayName(
  option: Pick<ChipPresetOption, 'id' | 'name'>,
  botsBySlug: Readonly<Record<string, Pick<ChipBot, 'name'>>>,
): string {
  const slug = slugFromPresetId(option.id)
  if (slug !== undefined) {
    const botName = botsBySlug[slug]?.name.trim()
    if (botName) return botName
  }
  return option.name?.trim() || option.id
}

export function chipAvatar(
  optionId: string,
  botsBySlug: Readonly<Record<string, Pick<ChipBot, 'avatarDataUrl'>>>,
): string | undefined {
  const slug = slugFromPresetId(optionId)
  if (slug === undefined) return undefined
  const avatar = botsBySlug[slug]?.avatarDataUrl?.trim()
  return avatar || undefined
}

/** Apply only on a blank session that is not already on this preset. */
export function shouldApplyStagedPreset(session: ChipSession | undefined, staged: string | undefined): boolean {
  if (staged === undefined || session === undefined) return false
  if (!session.blank) return false
  if (session.agentPreset === staged) return false
  return true
}

export function advertisedModelForBot(
  bot: Pick<ChipBot, 'dshLlmProvider' | 'dshLlmModel'> | undefined,
  groups: readonly AdvertisedGroup[],
): { provider: string; model: string } | undefined {
  const provider = bot?.dshLlmProvider?.trim()
  const model = bot?.dshLlmModel?.trim()
  if (!provider || !model) return undefined
  const group = groups.find((entry) => entry.id === provider)
  if (group === undefined) return undefined
  if (!group.models.some((entry) => entry.id === model)) return undefined
  return { provider, model }
}

export function botsBySlugFromList(bots: readonly ChipBot[]): Record<string, ChipBot> {
  const map: Record<string, ChipBot> = {}
  for (const bot of bots) map[bot.slug] = bot
  return map
}

/** Stored DSH model for an `oac-*` preset, only when that pair is still advertised. */
export function modelSelectionToApply(
  presetId: string,
  botsBySlug: Readonly<Record<string, Pick<ChipBot, 'dshLlmProvider' | 'dshLlmModel'>>>,
  groups: readonly AdvertisedGroup[],
): { provider: string; model: string } | undefined {
  const slug = slugFromPresetId(presetId)
  if (slug === undefined) return undefined
  return advertisedModelForBot(botsBySlug[slug], groups)
}
