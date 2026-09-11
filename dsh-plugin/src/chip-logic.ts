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
  /** Local Twin/Worker role; the Twin is the default for new blank sessions. */
  botType?: 'twin' | 'worker' | null
  /** Persona role (ROLE.md) — shown under the Bot name in the preset chip. */
  role?: string | null
  /** Profile creation time; local Bots sort oldest-first below the Twin. */
  createdAt?: number
  /** Settings → Bots availability toggle (off keeps the Bot out of the chip). */
  isAvailable?: boolean
}

/**
 * A Bot is available for new sessions and passive invocation when its
 * Settings toggle is on AND a DSH LLM pair is configured — the same rule the
 * daemon's group-task candidate search applies. Toggle-off or LLM-unset Bots
 * stay out of the chip and out of Twin delegation rosters.
 */
export function isChipBotAvailable(
  bot: Pick<ChipBot, 'isAvailable' | 'dshLlmProvider' | 'dshLlmModel'>,
): boolean {
  if (bot.isAvailable === false) return false
  return Boolean(bot.dshLlmProvider?.trim() && bot.dshLlmModel?.trim())
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

/**
 * OAC presets show the Bot's persona role under the name (the roster copy is a
 * static plugin-time description, identical for every Bot); every other preset
 * keeps its own roster description. Falls back to `fallback` when this Bot has
 * no role text.
 */
export function chipDescription(
  option: Pick<ChipPresetOption, 'id' | 'description'>,
  botsBySlug: Readonly<Record<string, Pick<ChipBot, 'role'>>>,
  fallback: string,
): string {
  const slug = slugFromPresetId(option.id)
  if (slug !== undefined) {
    const role = botsBySlug[slug]?.role?.trim()
    if (role) return role
  }
  return option.description?.trim() || fallback
}

/**
 * Chip option order: the available Twin Bot first, then every other row in
 * roster order, except that local Bots sort among themselves by profile
 * creation time (oldest first — the newest Bot lands at the bottom of the
 * Bot block). Unavailable Bots (Settings toggle off, or no DSH LLM pair) are
 * dropped; a preset whose Bot is missing from the roster (e.g. the Bot list
 * failed to load) stays visible so a transient list failure never blanks the
 * chip. Returns a new array; the input is not mutated.
 */
export function orderPresetsTwinFirst(
  options: readonly ChipPresetOption[],
  botsBySlug: Readonly<Record<string, Pick<ChipBot, 'botType' | 'createdAt' | 'isAvailable' | 'dshLlmProvider' | 'dshLlmModel'>>>,
): ChipPresetOption[] {
  const visible = options.filter((option) => {
    const slug = slugFromPresetId(option.id)
    if (slug === undefined) return true
    const bot = botsBySlug[slug]
    if (bot === undefined) return true
    return isChipBotAvailable(bot)
  })
  const twinSlug = Object.entries(botsBySlug)
    .find(([, bot]) => bot.botType === 'twin' && isChipBotAvailable(bot))?.[0]
  const twinId = twinSlug === undefined ? undefined : presetIdForSlug(twinSlug)
  const twin = twinId === undefined ? undefined : visible.find((option) => option.id === twinId)
  const rest = twin === undefined ? visible : visible.filter((option) => option !== twin)
  const createdAtOf = (option: ChipPresetOption): number => {
    const slug = slugFromPresetId(option.id)
    return slug === undefined ? 0 : (botsBySlug[slug]?.createdAt ?? 0)
  }
  // Stable sort: equal (or missing) timestamps keep the roster order.
  const oacSorted = rest
    .filter((option) => slugFromPresetId(option.id) !== undefined)
    .sort((left, right) => createdAtOf(left) - createdAtOf(right))
  let oacIndex = 0
  const merged = rest.map((option) => (
    slugFromPresetId(option.id) === undefined ? option : oacSorted[oacIndex++]
  ))
  return twin === undefined ? merged : [twin, ...merged]
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

/** What the hero identity block renders under the blank-session headline. */
export type HeroIdentity = {
  slug: string
  name: string
  avatarDataUrl?: string
}

/**
 * The selected `oac-*` Bot as a hero identity, when the staged preset is one.
 * Stock DSH presets (and not-yet-loaded rosters) return undefined so the
 * stock hero stays untouched.
 */
export function heroIdentityFor(
  state: { current: string; botsBySlug: Readonly<Record<string, Pick<ChipBot, 'name' | 'avatarDataUrl'>>> },
): HeroIdentity | undefined {
  const slug = slugFromPresetId(state.current)
  if (slug === undefined) return undefined
  const bot = state.botsBySlug[slug]
  const name = bot?.name?.trim()
  if (bot === undefined || name === undefined || name === '') return undefined
  const avatar = bot.avatarDataUrl?.trim()
  return { slug, name, ...(avatar === undefined || avatar === '' ? {} : { avatarDataUrl: avatar }) }
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
