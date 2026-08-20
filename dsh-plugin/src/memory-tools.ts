/**
 * Model-facing memory tools for oac-* preset agents, registered per agent on
 * agent/created. Every tool bridges to a `metabot memory` verb through the
 * injected run function. Tool names, parameters, and limits mirror the IDBots
 * toolset (coworkRunner.ts:6920-7228) so the ported prompt guidance stays
 * valid. The Memory Strategy prompt section (ported from
 * coworkRunner.ts:4401-4426) is installed alongside.
 */
import { runMetabot } from './cli-bridge.js'
import { runMetabotWithPayloadFile, type RunFn } from './cli-payload.js'
import type { HostAgentLike, HostToolDefinition } from './context-types.js'

/** Memory Strategy section, ported from IDBots and adapted to this toolset. */
export const MEMORY_STRATEGY_TEXT = [
  '## Memory Strategy',
  '- Historical retrieval is tool-first: when the user references previous chats, earlier outputs, prior decisions, or says "还记得/之前/上次/刚才", call `conversation_search` or `recent_chats` before answering.',
  '- Do not guess historical facts from partial context. If retrieval returns no evidence, explicitly say not found.',
  '- Do not call history tools for every request; only use them when historical context is required.',
  '- If retrieved history conflicts with the latest explicit user instruction, follow the latest explicit user instruction.',
  '- Memories may be injected as scoped blocks such as <ownerMemories>, <contactMemories>, <conversationMemories>, or <ownerOperationalPreferences>.',
  '- Treat each injected memory block as stable context only for that scope; do not assume omitted scopes are available.',
  '- Use `memory_user_edits` when the user asks to remember, update, list, or delete memory facts, or when you discover a durable fact worth persisting.',
  '- Use `experience_recall` to look up your own past days: a bare call returns the last 30 days of your daily summaries, `query` searches your full history, and `date_from`/`date_to` (YYYY-MM-DD) pin a range.',
  '- When a task resembles something you have done before, first search it with `experience_recall` (keyword), then inspect the referenced session with `conversation_search`: reuse the approaches that worked last time and avoid the pitfalls you already hit.',
  '- When <recent_daily_summaries> is present, those summaries are your own nightly dreams (做梦): questions like "did you dream / what did you dream about / do you remember that day" should be answered from them first.',
  '- Use `knowledge_recall` to search your reusable knowledge points (know-how, pitfalls, principles), and `knowledge_upsert` to save or revise one when you learn something worth reusing.',
  '- Never write transient conversation facts, news content, or source citations into user memory unless the user explicitly asks.',
].join('\n')

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
}

function toolText(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

/** Extract `data` from a CLI envelope, throwing the envelope code/message on failure. */
function dataOf(result: { ok: boolean; code?: string; message?: string; data?: unknown }): unknown {
  if (!result.ok) {
    throw new Error(result.message ?? result.code ?? 'metabot command failed')
  }
  return result.data
}

function textArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value.trim() : ''
}

function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringListArg(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined
}

function formatKnowledgeEntries(entries: Array<Record<string, unknown>>): string {
  if (entries.length === 0) {
    return 'No knowledge points found for the given query. You have not distilled a reusable point about this yet — if the current task taught you something worth reusing, save it with knowledge_upsert.'
  }
  const label = (kind: unknown): string => kind === 'pitfall' ? '坑' : kind === 'principle' ? '原则' : '做法'
  const lines = entries.map((entry) => {
    const category = typeof entry.category === 'string' && entry.category.trim() ? `[${entry.category}] ` : ''
    const version = typeof entry.version === 'number' && entry.version > 1 ? ` (v${entry.version})` : ''
    return `- 【${label(entry.kind)}】${category}${String(entry.topic ?? '')}${version}: ${String(entry.summary ?? '')}`
  })
  return [
    ...lines,
    '',
    'These are reusable knowledge points from your own past work. Apply the know-how, avoid the pitfalls (坑), and revise any entry with knowledge_upsert when you learn something better.',
  ].join('\n')
}

function formatChatSummaries(chats: Array<Record<string, unknown>>): string {
  if (chats.length === 0) return 'No recent chats found.'
  return chats.map((chat) => {
    const when = typeof chat.lastMessageAt === 'number' && chat.lastMessageAt > 0
      ? new Date(chat.lastMessageAt).toISOString().slice(0, 16).replace('T', ' ')
      : '-'
    const peer = chat.peerName ?? chat.peerGlobalMetaId ?? chat.sessionId
    return `- [${when}] ${chat.channel} ${peer}: ${String(chat.lastMessageText ?? '')} (session:${String(chat.sessionId)})`
  }).join('\n')
}

function formatSearchRecords(records: Array<Record<string, unknown>>): string {
  if (records.length === 0) return 'No matching messages found. Try different keywords or a wider time range.'
  return records.map((record) => {
    const when = typeof record.ts === 'number' && record.ts > 0
      ? new Date(record.ts).toISOString().slice(0, 16).replace('T', ' ')
      : '-'
    const who = record.role === 'assistant' ? 'you' : (record.peerName ?? record.peerGlobalMetaId ?? 'peer')
    return `- [${when}] ${who}: ${String(record.text ?? '')} (session:${String(record.sessionId)})`
  }).join('\n')
}

/** The six memory tools, bound to one Bot slug. */
export function buildMemoryToolDefinitions(slug: string, run: RunFn = runMetabot): HostToolDefinition[] {
  const viaPayload = (verb: string[], payload: Record<string, unknown>) =>
    runMetabotWithPayloadFile([...verb, '--from', slug], payload, '--payload-file', [], run)

  return [
    {
      name: 'memory_user_edits',
      description: 'Manage durable user memories: list, add, update, or delete facts the bot remembers about its owner or a contact. Use when the user asks to remember/forget something, or when you discover a durable fact worth persisting.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'add', 'update', 'delete'], description: 'The edit action.' },
          id: { type: 'string', description: 'Memory id (update/delete).' },
          text: { type: 'string', description: 'Memory text (add/update).' },
          confidence: { type: 'number', description: '0..1 confidence (add/update).' },
          status: { type: 'string', enum: ['created', 'stale', 'deleted'], description: 'Status filter or target.' },
          is_explicit: { type: 'boolean', description: 'Mark an added memory as user-explicit.' },
          limit: { type: 'number', description: 'List limit, 1-200 (default 50).' },
          query: { type: 'string', description: 'Substring filter for list.' },
        },
        required: ['action'],
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const action = textArg(args, 'action')
        if (action === 'list') {
          const result = await viaPayload(['memory', 'list'], {
            ...(textArg(args, 'query') ? { query: textArg(args, 'query') } : {}),
            limit: numberArg(args, 'limit') ?? 50,
          })
          const entries = (dataOf(result) as { entries?: Array<Record<string, unknown>> }).entries ?? []
          if (entries.length === 0) return 'No memories stored yet.'
          return entries.map((entry) =>
            `- [${String(entry.id)}] (${String(entry.usageClass)}) ${String(entry.text)}`
          ).join('\n')
        }
        if (action === 'add') {
          const result = await viaPayload(['memory', 'add'], {
            text: textArg(args, 'text'),
            ...(numberArg(args, 'confidence') !== undefined ? { confidence: numberArg(args, 'confidence') } : {}),
            ...(typeof args.is_explicit === 'boolean' ? { isExplicit: args.is_explicit } : {}),
          })
          const memory = (dataOf(result) as { memory?: Record<string, unknown> }).memory ?? {}
          return `Memory saved [${String(memory.id)}]: ${String(memory.text ?? '')}`
        }
        if (action === 'update' || action === 'delete') {
          const result = await viaPayload(['memory', action], {
            id: textArg(args, 'id'),
            ...(textArg(args, 'text') ? { text: textArg(args, 'text') } : {}),
            ...(textArg(args, 'status') ? { status: textArg(args, 'status') } : {}),
          })
          return action === 'update'
            ? `Memory updated: ${JSON.stringify((dataOf(result) as { memory?: Record<string, unknown> }).memory ?? {})}`
            : 'Memory deleted.'
        }
        throw new Error(`unknown action: ${action}`)
      },
    },
    {
      name: 'experience_recall',
      description: 'Recall your own past days (dream diaries). A bare call returns the last 30 days; query searches full history; date_from/date_to (YYYY-MM-DD) pin a range.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          date_from: { type: 'string', description: 'YYYY-MM-DD' },
          date_to: { type: 'string', description: 'YYYY-MM-DD' },
          granularity: { type: 'string', enum: ['day', 'week', 'month'] },
          limit: { type: 'number', description: '1-30, default 10' },
        },
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const result = await viaPayload(['memory', 'recall'], {
          ...(textArg(args, 'query') ? { query: textArg(args, 'query') } : {}),
          ...(textArg(args, 'date_from') ? { dateFrom: textArg(args, 'date_from') } : {}),
          ...(textArg(args, 'date_to') ? { dateTo: textArg(args, 'date_to') } : {}),
          ...(textArg(args, 'granularity') ? { granularity: textArg(args, 'granularity') } : {}),
          ...(numberArg(args, 'limit') !== undefined ? { limit: numberArg(args, 'limit') } : {}),
        })
        return toolText((dataOf(result) as { text?: unknown }).text ?? '')
      },
    },
    {
      name: 'knowledge_recall',
      description: 'Search your reusable knowledge points (know-how, pitfalls, principles) by keyword, kind, or category.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          kind: { type: 'string', enum: ['know_how', 'pitfall', 'principle'] },
          category: { type: 'string' },
          limit: { type: 'number', description: '1-50, default 20' },
        },
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const result = await viaPayload(['memory', 'knowledge', 'list'], {
          ...(textArg(args, 'query') ? { query: textArg(args, 'query') } : {}),
          ...(textArg(args, 'kind') ? { kind: textArg(args, 'kind') } : {}),
          ...(textArg(args, 'category') ? { category: textArg(args, 'category') } : {}),
          limit: numberArg(args, 'limit') ?? 20,
        })
        const entries = (dataOf(result) as { entries?: Array<Record<string, unknown>> }).entries ?? []
        return formatKnowledgeEntries(entries)
      },
    },
    {
      name: 'knowledge_upsert',
      description: 'Save or revise a reusable knowledge point. Reusing an existing topic rewrites it (version bump); a fresh topic creates a new entry.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Retrievable topic, not a one-off detail.' },
          summary: { type: 'string', description: 'Actionable conclusion that guides the next similar task.' },
          kind: { type: 'string', enum: ['know_how', 'pitfall', 'principle'] },
          category: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['topic', 'summary'],
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const result = await viaPayload(['memory', 'knowledge', 'upsert'], {
          topic: textArg(args, 'topic'),
          summary: textArg(args, 'summary'),
          ...(textArg(args, 'kind') ? { kind: textArg(args, 'kind') } : {}),
          ...(textArg(args, 'category') ? { category: textArg(args, 'category') } : {}),
          ...(stringListArg(args, 'tags') ? { tags: stringListArg(args, 'tags') } : {}),
        })
        const data = dataOf(result) as { text?: unknown }
        return toolText(data.text ?? data)
      },
    },
    {
      name: 'recent_chats',
      description: 'List your most recent conversations (local DSH sessions and A2A private chats) with previews and session references.',
      parameters: {
        type: 'object',
        properties: {
          n: { type: 'number', description: '1-20, default 10' },
          sort_order: { type: 'string', enum: ['asc', 'desc'], description: 'By last message time, default desc.' },
        },
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const result = await viaPayload(['memory', 'chats'], {
          ...(numberArg(args, 'n') !== undefined ? { limit: numberArg(args, 'n') } : {}),
          ...(textArg(args, 'sort_order') ? { sortOrder: textArg(args, 'sort_order') } : {}),
        })
        const chats = (dataOf(result) as { chats?: Array<Record<string, unknown>> }).chats ?? []
        return formatChatSummaries(chats)
      },
    },
    {
      name: 'conversation_search',
      description: 'Keyword-search your past conversation messages (local DSH sessions and A2A private chats).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search phrase; per-token terms are also matched.' },
          max_results: { type: 'number', description: '1-10, default 5' },
          before: { type: 'number', description: 'Only messages before this epoch ms.' },
          after: { type: 'number', description: 'Only messages after this epoch ms.' },
        },
        required: ['query'],
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const result = await viaPayload(['memory', 'search'], {
          query: textArg(args, 'query'),
          ...(numberArg(args, 'maxResults') !== undefined ? { maxResults: numberArg(args, 'maxResults') } : {}),
          ...(numberArg(args, 'max_results') !== undefined ? { maxResults: numberArg(args, 'max_results') } : {}),
          ...(numberArg(args, 'before') !== undefined ? { before: numberArg(args, 'before') } : {}),
          ...(numberArg(args, 'after') !== undefined ? { after: numberArg(args, 'after') } : {}),
        })
        const records = (dataOf(result) as { records?: Array<Record<string, unknown>> }).records ?? []
        return formatSearchRecords(records)
      },
    },
  ]
}

/** Register the Memory Strategy prompt section and the memory tools on one agent. */
export function installMemoryToolsOnAgent(
  agent: HostAgentLike,
  slug: string,
  run: RunFn = runMetabot,
): void {
  agent.ctx.systemPrompt?.section({
    name: 'oac:memory-strategy',
    order: 150,
    text: MEMORY_STRATEGY_TEXT,
  })
  for (const definition of buildMemoryToolDefinitions(slug, run)) {
    agent.ctx.tools?.register(definition)
  }
}
