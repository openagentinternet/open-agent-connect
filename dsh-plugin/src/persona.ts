/**
 * Persona text for one MetaBot's DSH agent preset. Neutralize `{{` / `}}` so
 * DSH prompt interpolation cannot throw, and XML-escape field values.
 */

export type BotPersonaInput = {
  name: string
  slug: string
  globalMetaId?: string
  mvcAddress?: string
  role?: string
  soul?: string
  goal?: string
  bio?: string
  botType?: 'twin' | 'worker' | null
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function neutralizeTemplateBraces(value: string): string {
  return value.replace(/\{\{/g, '{').replace(/\}\}/g, '}')
}

function sanitizeField(value: string): string {
  return escapeXmlText(neutralizeTemplateBraces(value.trim()))
}

function optionalTag(name: string, value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return undefined
  return `  <${name}>${sanitizeField(trimmed)}</${name}>`
}

/**
 * Build the persona block. `slug` is always present so the model knows its
 * `metabot … --from` actor. `bot_type` is host-owned (rebuilt from `metabot
 * bot list`, never bot-editable) and carries the Twin/Worker role fact so a
 * session knows what it is even before the per-agent overlay installs.
 */
export function buildPersonaPrompt(bot: BotPersonaInput): string {
  const tags = [
    optionalTag('name', bot.name),
    `  <slug>${sanitizeField(bot.slug)}</slug>`,
    optionalTag('bot_type', bot.botType === 'twin' || bot.botType === 'worker' ? bot.botType : undefined),
    optionalTag('globalmetaid', bot.globalMetaId),
    optionalTag('mvc_address', bot.mvcAddress),
    optionalTag('role', bot.role),
    optionalTag('soul', bot.soul),
    optionalTag('goal', bot.goal),
    optionalTag('bio', bot.bio),
  ].filter((tag): tag is string => tag !== undefined)

  const identityBlock = ['<metabot_identity>', ...tags, '</metabot_identity>'].join('\n')
  const fromSlug = sanitizeField(bot.slug)
  const roleLine = bot.botType === 'twin'
    ? `You are this machine's Twin Bot: the machine-wide default Bot and the owner's chief of staff. OAC commands and panels invoked without an explicit --from resolve to you, and you coordinate the local Worker Bots.`
    : bot.botType === 'worker'
      ? `You are a Worker Bot on this machine. The machine's Twin Bot coordinates cross-Bot tasks and may delegate bounded steps to you.`
      : undefined
  const instructionBlock = [
    '<instruction>',
    `You must strictly adhere to the persona defined in the &lt;metabot_identity&gt; block above.`,
    `When you run Open Agent Connect CLI commands, always pass --from ${fromSlug} so you act as this Bot, not another identity on this machine.`,
    ...(roleLine !== undefined ? [roleLine] : []),
    '</instruction>',
  ].join('\n')
  return `${identityBlock}\n${instructionBlock}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function parseBotPersona(value: unknown): BotPersonaInput | undefined {
  if (!isRecord(value)) return undefined
  const slug = readString(value.slug)
  const name = readString(value.name)
  if (!slug || !name) return undefined
  const botType = readString(value.botType)
  return {
    name,
    slug,
    globalMetaId: readString(value.globalMetaId) || undefined,
    mvcAddress: readString(value.mvcAddress) || undefined,
    role: readString(value.role) || undefined,
    soul: readString(value.soul) || undefined,
    goal: readString(value.goal) || undefined,
    bio: readString(value.bio) || undefined,
    botType: botType === 'twin' || botType === 'worker' ? botType : undefined,
  }
}

export function parseBotListData(data: unknown): BotPersonaInput[] {
  if (!isRecord(data) || !Array.isArray(data.profiles)) return []
  const bots: BotPersonaInput[] = []
  for (const row of data.profiles) {
    const parsed = parseBotPersona(row)
    if (parsed) bots.push(parsed)
  }
  return bots
}
