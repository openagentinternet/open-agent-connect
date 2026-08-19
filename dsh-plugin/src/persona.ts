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
 * `metabot … --from` actor.
 */
export function buildPersonaPrompt(bot: BotPersonaInput): string {
  const tags = [
    optionalTag('name', bot.name),
    `  <slug>${sanitizeField(bot.slug)}</slug>`,
    optionalTag('globalmetaid', bot.globalMetaId),
    optionalTag('mvc_address', bot.mvcAddress),
    optionalTag('role', bot.role),
    optionalTag('soul', bot.soul),
    optionalTag('goal', bot.goal),
    optionalTag('bio', bot.bio),
  ].filter((tag): tag is string => tag !== undefined)

  const identityBlock = ['<metabot_identity>', ...tags, '</metabot_identity>'].join('\n')
  const fromSlug = sanitizeField(bot.slug)
  const instructionBlock = [
    '<instruction>',
    `You must strictly adhere to the persona defined in the &lt;metabot_identity&gt; block above.`,
    `When you run Open Agent Connect CLI commands, always pass --from ${fromSlug} so you act as this Bot, not another identity on this machine.`,
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
  return {
    name,
    slug,
    globalMetaId: readString(value.globalMetaId) || undefined,
    mvcAddress: readString(value.mvcAddress) || undefined,
    role: readString(value.role) || undefined,
    soul: readString(value.soul) || undefined,
    goal: readString(value.goal) || undefined,
    bio: readString(value.bio) || undefined,
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
