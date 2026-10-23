/**
 * Identity & service discovery tools — OAC ports of the IDBots MetaID pair
 * (metaIdSearchAgentTools: search_metaids / metaid_profile) and the online
 * services yellow pages (networkServicesAgentTools: list_online_services).
 * All three are READ-ONLY bridges over the OAC CLI through the established
 * runMetabot pattern (`metaid search`, `metaid detail`, `network services
 * --online`): no approval gates, no chain writes, no key material.
 *
 * Port deviations from IDBots, kept deliberate:
 * - The search runs through the CLI flag surface (`--query/--skill/--chain/
 *   --chat-pubkey/--homepage/--since-days/--until-days/--limit/--cursor`), so
 *   query or skill must be present (the CLI leaves an all-empty search
 *   undefined) and day windows are validated here instead of converted to
 *   unix bounds in-process.
 * - list_online_services pages locally (cursor = row offset) because the CLI
 *   `--limit` only shapes the TTY table, not the JSON it returns to us.
 * - Tool cross-references only name tools that already exist in this plugin
 *   (e.g. search_online_bots for the live presence list; there is no
 *   list_online_bots here and no separate social-post search).
 */
import { runMetabot } from './cli-bridge.js'
import type { RunFn } from './cli-payload.js'
import type { HostAgentLike, HostContext, HostToolDefinition } from './context-types.js'

const SEARCH_TIMEOUT_MS = 30_000
const SERVICES_TIMEOUT_MS = 30_000

const SEARCH_LIMIT_DEFAULT = 8
const SEARCH_LIMIT_MAX = 20
const SERVICES_LIMIT_DEFAULT = 20
const SERVICES_LIMIT_MAX = 100

/** Trimmed search item the CLI returns (runtime trimMetaIdSearchItems). */
interface SearchItem {
  globalMetaId?: string
  metaId?: string
  address?: string
  chainName?: string
  name?: string
  bio?: string
  chatSkills?: string[]
  hasChatPubkey?: boolean
  hasHomepage?: boolean
  updatedAt?: number
  isOwn?: boolean
  localUiUrl?: string
}

/** Detail record the CLI returns (MetaIdDetail, links optional). */
interface DetailRecord extends SearchItem {
  role?: string
  soul?: string
  goal?: string
  persona?: unknown
  llm?: unknown
  homepage?: unknown
  chatPubkey?: string
}

/** One yellow-pages row the daemon returns for `network services`. */
interface ServiceRow {
  servicePinId?: string
  displayName?: string
  serviceName?: string
  description?: string
  price?: string
  currency?: string
  providerGlobalMetaId?: string
  providerName?: string
  providerSkill?: string
  ratingAvg?: number | null
  ratingCount?: number
  lastSeenAgoSeconds?: number | null
  updatedAt?: number
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function boolArg(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true
}

/** Positive integer arg, or undefined; NaN/float/<=0 collapse to undefined. */
function positiveIntArg(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * A flag value that itself starts with `--` would be silently swallowed by
 * the CLI flag readers (readOptionalFlag treats it as the next flag), so the
 * tool rejects it up front — the model gets a real error instead of a query
 * that ran with the argument missing.
 */
function safeFlagValue(value: string, field: string): string | null {
  if (value.startsWith('--')) {
    return `${field} must not start with "--" (got: ${value.slice(0, 24)}).`
  }
  return null
}

function toolError(tool: string, message: string): string {
  return `${tool} failed: ${message}`
}

/** Strip a metaid:// wrapper so the detail flag receives a bare identity. */
export function parseIdentityInput(raw: string): string {
  const match = /^metaid:\/\/(.+)$/i.exec(raw.trim())
  return (match?.[1] ?? raw.trim()).trim()
}

function sanitizeLinkLabel(value: string): string {
  return value.replace(/[[\]]/g, '')
}

function truncate(value: string, max: number): string {
  // Lone surrogates would break JSON serialization downstream; strip first.
  const clean = value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

function dayStamp(seconds: unknown): string {
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString().slice(0, 10)
    : ''
}

/** Ready-to-quote markdown bullets for search candidates; names are already metaid:// links. */
export function formatMetaIdCandidates(items: SearchItem[]): string {
  return items.map((item) => {
    const globalMetaId = textOf(item.globalMetaId)
    const name = sanitizeLinkLabel(textOf(item.name) || globalMetaId || 'unknown')
    const bio = textOf(item.bio) ? ` — ${truncate(textOf(item.bio), 120)}` : ''
    const own = item.isOwn ? ' (your MetaBot)' : ''
    const skills = Array.isArray(item.chatSkills) ? item.chatSkills.map((s) => textOf(s)).filter(Boolean) : []
    const meta = [
      skills.length ? `skills: ${skills.join(', ')}` : '',
      textOf(item.chainName) ? `chain: ${textOf(item.chainName)}` : '',
      item.hasChatPubkey ? 'open to private chat' : '',
      item.hasHomepage ? 'custom homepage' : '',
      dayStamp(item.updatedAt) ? `updated: ${dayStamp(item.updatedAt)}` : '',
    ].filter(Boolean).join(' | ')
    const head = `- [${name}](metaid://${globalMetaId})${own}${bio}`
    return meta ? `${head}\n  ${meta}` : head
  }).join('\n')
}

function formatJsonField(value: unknown, max: number): string {
  if (value == null) return ''
  try {
    return truncate(JSON.stringify(value), max)
  } catch {
    return ''
  }
}

/** Human-readable profile sheet; the name line is a ready-to-quote metaid:// link. */
export function formatMetaIdProfile(detail: DetailRecord): string {
  const globalMetaId = textOf(detail.globalMetaId)
  const name = sanitizeLinkLabel(textOf(detail.name) || globalMetaId || 'unknown')
  const own = detail.isOwn ? ' (your MetaBot)' : ''
  const lines = [
    `Profile of [${name}](metaid://${globalMetaId})${own}:`,
    `- globalMetaId: ${globalMetaId}`,
  ]
  if (textOf(detail.chainName)) lines.push(`- chain: ${textOf(detail.chainName)}`)
  if (textOf(detail.address)) lines.push(`- address: ${textOf(detail.address)}`)
  if (textOf(detail.bio)) lines.push(`- bio: ${truncate(textOf(detail.bio), 400)}`)
  if (textOf(detail.role)) lines.push(`- role: ${truncate(textOf(detail.role), 200)}`)
  if (textOf(detail.soul)) lines.push(`- soul: ${truncate(textOf(detail.soul), 400)}`)
  if (textOf(detail.goal)) lines.push(`- goal: ${truncate(textOf(detail.goal), 400)}`)
  const skills = Array.isArray(detail.chatSkills) ? detail.chatSkills.map((s) => textOf(s)).filter(Boolean) : []
  if (skills.length) lines.push(`- chatSkills: ${skills.join(', ')}`)
  const llm = (detail.llm ?? null) as { provider?: unknown; model?: unknown; name?: unknown } | null
  if (llm && typeof llm === 'object') {
    const route = [textOf(llm.provider), textOf(llm.model)].filter(Boolean).join('/')
    if (route) lines.push(`- llm: ${route}${textOf(llm.name) ? ` (${truncate(textOf(llm.name), 60)})` : ''}`)
  }
  const persona = formatJsonField(detail.persona, 400)
  if (persona) lines.push(`- persona: ${persona}`)
  const homepage = formatJsonField(detail.homepage, 300)
  if (homepage) lines.push(`- homepage: ${homepage}`)
  lines.push(`- private chat: ${textOf(detail.chatPubkey) ? 'available (chatpubkey set)' : 'not available'}`)
  const created = dayStamp((detail as { createdAt?: number }).createdAt)
  const updated = dayStamp(detail.updatedAt)
  if (created || updated) {
    const stamps = [
      ...(created ? [`registered: ${created}`] : []),
      ...(updated ? [`last updated: ${updated}`] : []),
    ]
    lines.push(`- ${stamps.join(' | ')}`)
  }
  return lines.join('\n')
}

function escapeTableCell(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
}

function formatPrice(service: ServiceRow): string {
  const price = textOf(service.price)
  if (!price) return '-'
  return `${price}${textOf(service.currency)}`
}

function formatProviderCell(service: ServiceRow): string {
  const gmid = textOf(service.providerGlobalMetaId)
  if (!gmid) return '-'
  const name = sanitizeLinkLabel(truncate(textOf(service.providerName), 20))
  return name
    ? `[${escapeTableCell(name)}](metaid://${gmid})`
    : `[${gmid}](metaid://${gmid})`
}

function formatLastSeen(service: ServiceRow): string {
  return typeof service.lastSeenAgoSeconds === 'number' && Number.isFinite(service.lastSeenAgoSeconds)
    ? `${Math.max(0, Math.floor(service.lastSeenAgoSeconds))}s 🟢`
    : '-'
}

/** Markdown table mirroring the CLI `network services` TTY rendering, with metaid:// provider links. */
export function formatOnlineServicesTable(services: ServiceRow[]): string {
  const rows = services.map((service, index) => {
    const title = escapeTableCell(truncate(sanitizeLinkLabel(
      textOf(service.displayName) || textOf(service.serviceName) || 'untitled',
    ), 40))
    return `| ${index + 1} | ${title} | ${formatProviderCell(service)} | ${escapeTableCell(formatPrice(service))} | ${formatLastSeen(service)} |`
  })
  return [
    '| # | service | provider | price | Last Seen |',
    '|---|---------|----------|-------|-----------|',
    ...rows,
  ].join('\n')
}

/** Routing lines under the table: pin ids must be copied verbatim when ordering. */
export function formatOnlineServicesDetails(services: ServiceRow[]): string {
  const lines = services.map((service, index) => {
    const pinId = textOf(service.servicePinId)
    const ratingAvg = typeof service.ratingAvg === 'number' && service.ratingAvg != null
      ? `rating ${service.ratingAvg}`
      : 'rating n/a'
    const ratingCount = typeof service.ratingCount === 'number' ? ` (${service.ratingCount})` : ''
    const skill = textOf(service.providerSkill) ? `skill: ${truncate(textOf(service.providerSkill), 40)}` : 'skill: -'
    const description = escapeTableCell(truncate(textOf(service.description), 120))
    const routing = pinId ? `pin ${pinId}` : 'pin: not listed'
    return `${index + 1}. ${routing} | ${skill} | ${ratingAvg}${ratingCount}${description ? ` | ${description}` : ''}`
  })
  return ['Routing details (copy pin ids verbatim; do not invent them):', ...lines].join('\n')
}

export function buildDiscoveryToolDefinitions(input: {
  host: HostContext
  hostAgent: HostAgentLike
  run?: RunFn
}): HostToolDefinition[] {
  // host/hostAgent are kept in the signature so the install call sites stay
  // uniform with the other tool families; these three reads are actor-
  // independent, so no slug resolution ever rides the CLI call.
  void input.host
  void input.hostAgent
  const run = input.run ?? runMetabot

  const render = (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
  ]

  const searchMetaids: HostToolDefinition = {
    name: 'search_metaids',
    description:
      'Search on-chain MetaID identities (bots AND users) - find a person or bot by name or by skill. '
      + 'Returns up to limit (1-20, default 8) candidates, best first, as scannable bullets whose names are already '
      + 'metaid:// links (chain, skills, private-chat availability, homepage flag, last update). '
      + 'Use metaid_profile on the best match for the full profile; use search_online_bots for who is online RIGHT '
      + 'NOW (presence, not search), and search_metaapps when the user wants apps rather than people. '
      + 'Never invent a globalMetaId: if nothing matches, say so honestly. Page with cursor when hasMore is set.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name/keyword query; derive it from the user\'s words.' },
        skill: { type: 'string', description: 'Filter by chat skill (e.g. "weather", "translation").' },
        chain: { type: 'string', description: 'Filter by chain name (e.g. mvc); matched case-insensitively.' },
        chat_only: { type: 'boolean', description: 'Only identities that can receive private messages (chatpubkey set).' },
        has_homepage: { type: 'boolean', description: 'Only identities with a custom homepage.' },
        since_days: { type: 'number', description: 'Only identities registered in the last N days.' },
        until_days: { type: 'number', description: 'Only identities registered before N days ago.' },
        limit: { type: 'number', description: 'Candidates per page, 1-20 (default 8).' },
        cursor: { type: 'string', description: 'Pagination cursor from a previous page.' },
      },
      required: [],
    },
    output: { schema: { type: 'string' }, render },
    timeoutMs: SEARCH_TIMEOUT_MS,
    execute: async (args: Record<string, unknown>) => {
      const query = textOf(args.query)
      const skill = textOf(args.skill)
      if (!query && !skill) {
        return toolError('search_metaids', 'query or skill is required (narrow by chain/flags afterwards).')
      }
      for (const [field, value] of [['query', query], ['skill', skill]] as const) {
        if (value) {
          const blocked = safeFlagValue(value, field)
          if (blocked) return toolError('search_metaids', blocked)
        }
      }
      const chain = textOf(args.chain).toLowerCase()
      if (chain) {
        const blocked = safeFlagValue(chain, 'chain')
        if (blocked) return toolError('search_metaids', blocked)
      }
      const cursor = textOf(args.cursor)
      if (cursor) {
        const blocked = safeFlagValue(cursor, 'cursor')
        if (blocked) return toolError('search_metaids', blocked)
      }
      const sinceDays = args.since_days == null ? undefined : positiveIntArg(args.since_days)
      const untilDays = args.until_days == null ? undefined : positiveIntArg(args.until_days)
      if (args.since_days != null && sinceDays == null) {
        return toolError('search_metaids', 'since_days must be a positive integer.')
      }
      if (args.until_days != null && untilDays == null) {
        return toolError('search_metaids', 'until_days must be a positive integer.')
      }
      const limit = Math.min(SEARCH_LIMIT_MAX, Math.max(1, positiveIntArg(args.limit) ?? SEARCH_LIMIT_DEFAULT))

      const cliArgs = ['metaid', 'search']
      if (query) cliArgs.push('--query', query)
      if (skill) cliArgs.push('--skill', skill)
      if (chain) cliArgs.push('--chain', chain)
      if (boolArg(args, 'chat_only')) cliArgs.push('--chat-pubkey')
      if (boolArg(args, 'has_homepage')) cliArgs.push('--homepage')
      if (sinceDays != null) cliArgs.push('--since-days', String(sinceDays))
      if (untilDays != null) cliArgs.push('--until-days', String(untilDays))
      cliArgs.push('--limit', String(limit))
      if (cursor) cliArgs.push('--cursor', cursor)

      try {
        const result = await run(cliArgs, { timeoutMs: SEARCH_TIMEOUT_MS })
        if (!result.ok) {
          return toolError('search_metaids', result.message ?? result.code ?? 'metaid search failed')
        }
        const data = (result.data ?? {}) as { items?: SearchItem[]; hasMore?: boolean; nextCursor?: string | null }
        const items = Array.isArray(data.items) ? data.items : []
        if (!items.length) {
          return `No on-chain MetaID identities matched${query ? ` "${query}"` : ''}${skill ? ` with skill "${skill}"` : ''}. `
            + 'Tell the user honestly; do NOT invent people or bots.'
        }
        const sections = [
          `${items.length} on-chain MetaID candidate(s), best first:`,
          formatMetaIdCandidates(items),
          'Reuse the bullet lines above verbatim in your reply: names MUST stay markdown links (metaid://<globalMetaId>) — '
          + 'never mention a person or bot as plain text, never shorten a globalMetaId. '
          + 'Open the best match\'s bot page with bot_browser_open_uri when the user wants to view it; '
          + 'use metaid_profile for the full profile.',
        ]
        if (data.hasMore && textOf(data.nextCursor)) {
          sections.push(`More results are available — call search_metaids again with cursor="${textOf(data.nextCursor)}" if the user wants them.`)
        }
        return sections.join('\n\n')
      } catch (error) {
        return toolError('search_metaids', error instanceof Error ? error.message : String(error))
      }
    },
  }

  const metaidProfile: HostToolDefinition = {
    name: 'metaid_profile',
    description:
      'Get the full on-chain profile of one MetaID identity (bot or user): name, bio, role/soul/goal, persona, LLM, '
      + 'chat skills, homepage, private-chat availability, registered/updated dates. `identity` accepts a globalMetaId, '
      + 'a legacy metaId, an address, or a metaid://<globalMetaId> URI. Use after search_metaids when the user asks for '
      + 'details about a specific person/bot, or when you already hold an identity string. When NOT to use: do not call '
      + 'before you have a concrete identity - search_metaids finds one first; for that identity\'s published content use '
      + 'search_metaweb with the publisher filter, not this profile tool. When the identity is unknown on-chain the tool '
      + 'says so - never invent a profile.',
    parameters: {
      type: 'object',
      properties: {
        identity: { type: 'string', description: 'GlobalMetaId (idq1...), legacy metaId, address, or metaid:// URI.' },
      },
      required: ['identity'],
    },
    output: { schema: { type: 'string' }, render },
    timeoutMs: SEARCH_TIMEOUT_MS,
    execute: async (args: Record<string, unknown>) => {
      const identity = parseIdentityInput(textOf(args.identity))
      if (!identity) {
        return toolError('metaid_profile', 'identity is required (globalMetaId, metaId, address, or metaid:// URI).')
      }
      const blocked = safeFlagValue(identity, 'identity')
      if (blocked) return toolError('metaid_profile', blocked)
      try {
        const result = await run(['metaid', 'detail', '--identity', identity], { timeoutMs: SEARCH_TIMEOUT_MS })
        if (!result.ok) {
          if (result.code === 'metaid_not_found') {
            return `No on-chain MetaID identity matches "${identity}" (tried as globalMetaId/metaId/address). `
              + 'Tell the user honestly; do NOT invent a profile.'
          }
          return toolError('metaid_profile', result.message ?? result.code ?? 'metaid detail failed')
        }
        const detail = (result.data ?? {}) as DetailRecord
        return `${formatMetaIdProfile(detail)}\n\n`
          + 'Present these fields with the name kept as a clickable metaid:// link; open the bot page with '
          + 'bot_browser_open_uri when the user wants to view it.'
      } catch (error) {
        return toolError('metaid_profile', error instanceof Error ? error.message : String(error))
      }
    },
  }

  const listOnlineServices: HostToolDefinition = {
    name: 'list_online_services',
    description:
      'List MetaWeb services whose providers are currently online (Gig Square yellow pages). Use when the user asks '
      + 'for online Bot services, who can do a task right now, or to browse the live service directory. Pass query '
      + 'with short task keywords to rank matches. When NOT to use: finding a person/bot by name or personality '
      + '(search_metaids), listing currently-online bots without a service intent (search_online_bots), or reading '
      + 'plain on-chain content (search_metaweb). Returns a markdown table of up to limit rows (1-100, default 20) '
      + 'with provider metaid:// links, price, last-seen, and routing pin ids. Page with cursor (a row offset).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Short task keywords to rank/filter matches.' },
        limit: { type: 'number', description: 'Rows per page, 1-100 (default 20).' },
        cursor: { type: 'number', description: 'Row offset from a previous page (default 0).' },
      },
      required: [],
    },
    output: { schema: { type: 'string' }, render },
    timeoutMs: SERVICES_TIMEOUT_MS,
    execute: async (args: Record<string, unknown>) => {
      const query = textOf(args.query)
      if (query) {
        const blocked = safeFlagValue(query, 'query')
        if (blocked) return toolError('list_online_services', blocked)
      }
      const limit = Math.min(SERVICES_LIMIT_MAX, Math.max(1, positiveIntArg(args.limit) ?? SERVICES_LIMIT_DEFAULT))
      const rawCursor = args.cursor == null ? 0 : positiveIntArg(args.cursor)
      if (args.cursor != null && rawCursor == null) {
        return toolError('list_online_services', 'cursor must be a non-negative integer row offset.')
      }
      const cursor = rawCursor ?? 0

      const cliArgs = ['network', 'services', '--online']
      if (query) cliArgs.push('--query', query)

      try {
        const result = await run(cliArgs, { timeoutMs: SERVICES_TIMEOUT_MS })
        if (!result.ok) {
          return toolError('list_online_services', result.message ?? result.code ?? 'network services failed')
        }
        const data = (result.data ?? {}) as { services?: ServiceRow[] }
        const rows = Array.isArray(data.services)
          ? data.services.filter((row) => textOf(row?.servicePinId) || textOf(row?.providerGlobalMetaId))
          : []
        const total = rows.length
        const slice = rows.slice(cursor, cursor + limit)
        if (!slice.length) {
          const empty = query
            ? `No currently-online MetaWeb services matched "${query}". Tell the user honestly; do NOT invent services.`
            : 'No MetaWeb services are currently online. Tell the user honestly; do NOT invent services.'
          return empty
        }
        const shownFrom = cursor + 1
        const shownTo = cursor + slice.length
        const sections = [
          `Currently online MetaWeb services (${shownFrom}–${shownTo} of ${total}${query ? `, query "${query}"` : ''}):`,
          formatOnlineServicesTable(slice),
          formatOnlineServicesDetails(slice),
          'Present the table to the user by REUSING it verbatim: provider names/ids MUST stay markdown links — '
          + 'never mention a provider as plain text, never shorten a globalMetaId. Use metaid_profile for a '
          + 'provider\'s full profile. To order a service, follow the host service-ordering flow with the pin id '
          + 'from the details list — do not invent pin ids.',
        ]
        if (cursor + slice.length < total) {
          sections.push(`More online services are available — call list_online_services again with cursor=${cursor + slice.length}${query ? ' and the same query' : ''} if the user wants them.`)
        }
        return sections.join('\n\n')
      } catch (error) {
        return toolError('list_online_services', error instanceof Error ? error.message : String(error))
      }
    },
  }

  return [searchMetaids, metaidProfile, listOnlineServices]
}

function isDuplicateToolError(error: unknown): boolean {
  return error instanceof Error && /already.*(registered|exists)|duplicate/i.test(error.message)
}

/** Register the three discovery tools on the host global tool layer during plugin apply. */
export function bindDiscoveryToolInstall(ctx: HostContext): void {
  const hostAgent: HostAgentLike = { ctx }
  for (const definition of buildDiscoveryToolDefinitions({ host: ctx, hostAgent })) {
    try {
      ctx.tools?.register(definition)
    } catch (error) {
      if (!isDuplicateToolError(error)) {
        ctx.logger?.warn?.(`[oac-dsh] discovery tool install failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
