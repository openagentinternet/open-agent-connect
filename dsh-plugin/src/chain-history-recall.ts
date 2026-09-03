/**
 * chain_history_recall — model-facing search over the Bot's own chain history
 * ledger (pins it published + chain pins it fully read). The pure halves
 * (argument resolution, result formatting) are ported from the IDBots
 * chainHistoryRecallBlocks; the execute half bridges to
 * `metabot chainhistory recall`, so the CLI owns the ledger read and this
 * module does no I/O apart from the injected run fn.
 *
 * Port deviations from IDBots: the OAC ledger has no write origin field, so
 * the `via <origin>` segment of the write line is omitted; and
 * resolveChainHistoryRecallQuery keeps the validated YYYY-MM-DD strings
 * (dateFrom/dateTo) instead of converting to local-midnight ms — the CLI
 * handler performs that conversion with getDayBoundsMs. Malformed dates are
 * still dropped, never fatal.
 */
import { runMetabot } from './cli-bridge.js'
import type { RunFn } from './cli-payload.js'
import { oacSlugOf } from './browser-tools.js'
import type { HostAgentLike, HostContext, HostToolDefinition, HostToolExec } from './context-types.js'

export type ChainHistoryRecallKind = 'write' | 'read'

export interface ChainHistoryRecallArgs {
  query?: string
  date_from?: string
  date_to?: string
  kind?: string
  limit?: number
}

export interface ResolvedChainHistoryRecallQuery {
  query: string | null
  kind: 'both' | ChainHistoryRecallKind
  /** Validated YYYY-MM-DD start day (local-day inclusive), or null. */
  dateFrom: string | null
  /** Validated YYYY-MM-DD end day (local-day inclusive), or null. */
  dateTo: string | null
  limit: number
}

export const DEFAULT_CHAIN_HISTORY_RECALL_LIMIT = 20
export const MAX_CHAIN_HISTORY_RECALL_LIMIT = 50

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function resolveChainHistoryRecallQuery(args: ChainHistoryRecallArgs): ResolvedChainHistoryRecallQuery {
  const query = typeof args.query === 'string' && args.query.trim() ? args.query.trim() : null
  const kind: ResolvedChainHistoryRecallQuery['kind'] = args.kind === 'write' || args.kind === 'read'
    ? args.kind
    : 'both'
  const dateFrom = typeof args.date_from === 'string' && DATE_PATTERN.test(args.date_from.trim())
    ? args.date_from.trim()
    : null
  const dateTo = typeof args.date_to === 'string' && DATE_PATTERN.test(args.date_to.trim())
    ? args.date_to.trim()
    : null
  const limit = Math.max(
    1,
    Math.min(MAX_CHAIN_HISTORY_RECALL_LIMIT, Math.floor(args.limit ?? DEFAULT_CHAIN_HISTORY_RECALL_LIMIT)),
  )
  return { query, kind, dateFrom, dateTo, limit }
}

/** Slim write record as returned by `metabot chainhistory recall`. */
export interface ChainHistoryRecallWrite {
  pinId: string
  path?: string | null
  operation?: string | null
  occurredAtMs: number
  summary?: string | null
  contentText?: string | null
}

/** Slim read record as returned by `metabot chainhistory recall`. */
export interface ChainHistoryRecallRead {
  pinId: string
  path?: string | null
  protocol?: string | null
  title?: string | null
  authorGlobalMetaId?: string | null
  savedToKb?: boolean
  readCount: number
  lastReadAtMs: number
  summary?: string | null
  contentExcerpt?: string | null
}

/** Gist cap per result line — the full text stays in the ledger, not in the reply. */
const RECALL_GIST_CHARS = 240

const truncateGist = (text: string): string => {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= RECALL_GIST_CHARS) return normalized
  return `${normalized.slice(0, RECALL_GIST_CHARS)}…`
}

const formatWhen = (ms: number): string => new Date(ms).toISOString()

/**
 * Render recall results for the tool output. Writes first, then reads, each
 * newest-first; every line carries the pinId so the bot can re-open the pin
 * (read_metaweb_pin) or cite it.
 */
export function formatChainHistoryRecallResults(
  writes: ChainHistoryRecallWrite[],
  reads: ChainHistoryRecallRead[],
): string {
  if (writes.length === 0 && reads.length === 0) {
    return 'No matching records in your chain content history — nothing you published or fully read matches this query/range.'
  }
  const lines: string[] = []
  for (const write of writes) {
    const gist = write.summary?.trim() || write.contentText?.trim() || '(binary content)'
    const where = write.path?.trim() || '(unknown path)'
    const operation = write.operation ? `, ${write.operation}` : ''
    lines.push(
      `- [write] pinId=${write.pinId} (${where}${operation}) at ${formatWhen(write.occurredAtMs)}: ${truncateGist(gist)}`,
    )
  }
  for (const read of reads) {
    const gist = read.summary?.trim() || read.contentExcerpt?.trim() || '(no excerpt)'
    const label = read.title?.trim() || read.path?.trim() || read.protocol?.trim() || '(unknown)'
    const extras = [
      read.authorGlobalMetaId ? `author=${read.authorGlobalMetaId}` : null,
      read.savedToKb ? 'saved to knowledge base' : null,
      read.readCount > 1 ? `read ${read.readCount} times` : null,
    ].filter(Boolean).join(', ')
    lines.push(
      `- [read] pinId=${read.pinId} 「${label}」${extras ? ` (${extras})` : ''} at ${formatWhen(read.lastReadAtMs)}: ${truncateGist(gist)}`,
    )
  }
  return [
    'Your chain content history (pins you published + chain pins you fully read), newest first:',
    ...lines,
    '',
    'To fetch a pin\'s full content again, pass its pinId to read_metaweb_pin.',
  ].join('\n')
}

const RECALL_TIMEOUT_MS = 30_000

/** Tool error convention: a readable message the model can act on. */
function toolError(message: string): { error: string } {
  return { error: message }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function msOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function normalizeWrites(value: unknown): ChainHistoryRecallWrite[] {
  if (!Array.isArray(value)) return []
  const records: ChainHistoryRecallWrite[] = []
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const raw = entry as Record<string, unknown>
    if (typeof raw.pinId !== 'string' || !raw.pinId) continue
    records.push({
      pinId: raw.pinId,
      path: stringOrNull(raw.path),
      operation: stringOrNull(raw.operation),
      occurredAtMs: msOrZero(raw.occurredAtMs),
      summary: stringOrNull(raw.summary),
      contentText: stringOrNull(raw.contentText),
    })
  }
  return records
}

function normalizeReads(value: unknown): ChainHistoryRecallRead[] {
  if (!Array.isArray(value)) return []
  const records: ChainHistoryRecallRead[] = []
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const raw = entry as Record<string, unknown>
    if (typeof raw.pinId !== 'string' || !raw.pinId) continue
    records.push({
      pinId: raw.pinId,
      path: stringOrNull(raw.path),
      protocol: stringOrNull(raw.protocol),
      title: stringOrNull(raw.title),
      authorGlobalMetaId: stringOrNull(raw.authorGlobalMetaId),
      savedToKb: raw.savedToKb === true,
      readCount: msOrZero(raw.readCount),
      lastReadAtMs: msOrZero(raw.lastReadAtMs),
      summary: stringOrNull(raw.summary),
      contentExcerpt: stringOrNull(raw.contentExcerpt),
    })
  }
  return records
}

export function buildChainHistoryRecallToolDefinitions(input: {
  host: HostContext
  hostAgent: HostAgentLike
  run?: RunFn
}): HostToolDefinition[] {
  const { host, hostAgent } = input
  const run = input.run ?? runMetabot

  const actorSlug = (exec: HostToolExec): string => {
    const agent = exec.agent ?? hostAgent
    const live = oacSlugOf(host, agent)
    if (live) return live
    const preset = host.agentPresets?.composedPreset?.(agent.ctx)
    return typeof preset === 'string' ? preset.replace(/^oac-/, '') : ''
  }

  return [
    {
      name: 'chain_history_recall',
      description:
        'Search YOUR OWN on-chain history: pins you published (writes) and chain pins you fully read (reads), '
        + 'newest first. Complements memory recall: experience_recall covers distilled daily diaries, this covers '
        + 'the actual chain content ledger — use it when you need to remember what you posted or read on the '
        + 'MetaWeb. Every hit carries a pinId; pass it to read_metaweb_pin to fetch the full content again.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keyword filter over content/summary/path/title; omit to browse the window.' },
          kind: { type: 'string', enum: ['write', 'read'], description: 'write = pins you published, read = pins you fully read; default both.' },
          date_from: { type: 'string', description: 'YYYY-MM-DD local start day (inclusive). Default window: the last 90 days.' },
          date_to: { type: 'string', description: 'YYYY-MM-DD local end day (covers the whole day).' },
          limit: { type: 'number', description: '1-50 per kind, default 20.' },
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [
          { type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) },
        ],
      },
      timeoutMs: RECALL_TIMEOUT_MS,
      execute: async (args: Record<string, unknown>, exec: HostToolExec) => {
        const slug = actorSlug(exec)
        if (!slug) {
          return toolError('chain_history_recall is only available in an OAC Bot session (no Bot slug resolved for this agent).')
        }
        const resolved = resolveChainHistoryRecallQuery(args as ChainHistoryRecallArgs)
        const cliArgs = ['chainhistory', 'recall', '--from', slug]
        if (resolved.query) cliArgs.push('--query', resolved.query)
        if (resolved.kind !== 'both') cliArgs.push('--kind', resolved.kind)
        if (resolved.dateFrom) cliArgs.push('--from-date', resolved.dateFrom)
        if (resolved.dateTo) cliArgs.push('--to-date', resolved.dateTo)
        cliArgs.push('--limit', String(resolved.limit))
        try {
          const result = await run(cliArgs, { timeoutMs: RECALL_TIMEOUT_MS })
          if (!result.ok) {
            return toolError(result.message ?? result.code ?? 'metabot chainhistory recall failed')
          }
          const data = (result.data ?? {}) as { writes?: unknown; reads?: unknown }
          return formatChainHistoryRecallResults(normalizeWrites(data.writes), normalizeReads(data.reads))
        } catch (error) {
          return toolError(error instanceof Error ? error.message : String(error))
        }
      },
    },
  ]
}

/** Register chain_history_recall on one agent (memory-family per-agent install). */
export function installChainHistoryRecallOnAgent(
  host: HostContext,
  agent: HostAgentLike,
  run: RunFn = runMetabot,
): void {
  for (const definition of buildChainHistoryRecallToolDefinitions({ host, hostAgent: agent, run })) {
    agent.ctx.tools?.register(definition)
  }
}
