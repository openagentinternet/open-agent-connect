/**
 * Cerebellum wiring, Round 3 PR-2: the turn-end memory write gate (design
 * design-assistant-cerebellum-port.md §2.2 B4) and the conversation_search
 * re-rank (§2.2 B5), riding the PR-1 cerebellum core (`src/cerebellum/` —
 * the builders/parsers are byte-synced to IDBots
 * src/main/cerebellum/memoryWriteGate.ts + conversationSearchRank.ts at
 * commit d75bea8ac2249da4886bfa0f6f1db838d234ef1f; this file only adds the
 * plugin-side call sequencing, exactly the "cheapest" plugin-only shape the
 * design doc prescribes — no OAC core change).
 *
 * DEFAULT OFF, fail-open everywhere: when the cerebellum is disabled (the
 * shipped default) both helpers make ZERO calls (no JEV fetch, no CLI read)
 * and return the pre-cerebellum behavior — the memory-extract call proceeds
 * and the search hits keep the keyword order verbatim. Never block a turn:
 * every failure mode degrades silently. Never logs turn text or the API
 * key: verdict/latency/counts only.
 */

import type { CerebellumRuntime } from './cerebellum/client.js'
import { gateMemoryWriteWithCerebellum } from './cerebellum/questions/memoryWriteGate.js'
import {
  CEREBELLUM_CONVERSATION_RANK_MIN_POOL,
  formatConversationCandidateText,
  orderConversationHits,
  rankConversationsWithCerebellum,
} from './cerebellum/questions/conversationSearchRank.js'

/** One `records[]` row of the `metabot memory search` CLI result. */
export interface ConversationSearchRecordLike {
  sessionId?: unknown
  channel?: unknown
  peerGlobalMetaId?: unknown
  peerName?: unknown
  role?: unknown
  text?: unknown
  ts?: unknown
}

export interface TurnMemoryExtractGateInput {
  /** The PR-1 cerebellum runtime (bindCerebellumCore in index.ts). */
  runtime: CerebellumRuntime
  userText: string
  assistantText: string
  /**
   * Reads the Bot's effective `memoryImplicitUpdateEnabled` policy flag —
   * the explicitOnly source. IDBots reads the same policy in-process at the
   * extraction site (main.ts createCerebellumMemoryWriteGate:
   * `explicitOnly: !implicitEnabled`); the dsh-plugin cannot reach the core
   * policy store in-process, so the caller bridges `memory policy get`.
   * Null / absent / throwing → explicitOnly=false (the implicit
   * definition), the fail-open direction: the implicit question ALSO
   * accepts explicit remember/forget instructions, so a wrong guess can
   * only cost an extraction call, never a memory.
   */
  readImplicitEnabled?: (() => Promise<boolean | null>) | null
  /** Verdict/latency log sink (no turn text). */
  log?: ((message: string) => void) | null
}

/**
 * Ask the cerebellum whether this turn is worth the brain memory-extraction
 * call (IDBots roadmap #1 semantics: one Noul `worth_remembering`, gate at
 * P >= 0.5, fail-open — `null` and `true` BOTH proceed). Returns true to
 * proceed with the extract call, false to skip it (positive skip verdict
 * only). NEVER throws, and with the cerebellum disabled (runtime resolves
 * no config — the shipped default) it makes ZERO calls and proceeds.
 */
export async function gateTurnMemoryExtract(input: TurnMemoryExtractGateInput): Promise<boolean> {
  let context: Awaited<ReturnType<CerebellumRuntime['resolveCallContext']>> = null
  try {
    context = await input.runtime.resolveCallContext()
  } catch {
    return true
  }
  if (!context) {
    return true
  }
  let implicitEnabled: boolean | null = null
  if (input.readImplicitEnabled) {
    try {
      implicitEnabled = await input.readImplicitEnabled()
    } catch {
      implicitEnabled = null
    }
  }
  const startedAt = Date.now()
  let verdict: boolean | null = null
  try {
    verdict = await gateMemoryWriteWithCerebellum({
      config: context.config,
      fetchImpl: context.fetchImpl,
      userText: input.userText,
      assistantText: input.assistantText,
      explicitOnly: implicitEnabled === null ? false : !implicitEnabled,
    })
  } catch {
    verdict = null
  }
  input.log?.(
    `cerebellum memory write gate: verdict=${verdict === null ? 'no-verdict' : verdict ? 'extract' : 'skip'} `
    + `latencyMs=${Date.now() - startedAt}`,
  )
  return verdict !== false
}

export interface ConversationSearchRerankInput<T extends ConversationSearchRecordLike = ConversationSearchRecordLike> {
  runtime: CerebellumRuntime
  query: string
  records: readonly T[]
  /** Counts/latency log sink (no query text, no snippets). */
  log?: ((message: string) => void) | null
}

/**
 * Re-rank `conversation_search` hits with the cerebellum conversation
 * ranker (IDBots roadmap #15 semantics: one Noul `chat_<i>` per hit, the
 * noul replaces recency as the rank key, `chat_<i>` question ids over a
 * capped ≤10 pool with the 0.8 answer-coverage floor; a score map below
 * the floor is discarded so the keyword order is kept VERBATIM). Fail-open:
 * a blank query, a pool below `CEREBELLUM_CONVERSATION_RANK_MIN_POOL`, a
 * disabled runtime, or ANY failure returns the input order untouched.
 *
 * OAC grain difference (diff table): IDBots' search returns one hit per
 * SESSION (`{sessionId, title, human, assistant}`), so the candidate id is
 * the bare sessionId. OAC's `memory search` returns one hit per MESSAGE
 * (`{ts, role, text, sessionId, …}`) and one session can contribute several
 * records, so the candidate id is a per-call composite `sessionId#index` —
 * unique per record (a bare sessionId would collapse the coverage floor's
 * `scores.size` math) and opaque (never turn text).
 */
export async function rerankConversationSearch<T extends ConversationSearchRecordLike>(
  input: ConversationSearchRerankInput<T>,
): Promise<T[]> {
  const records = input.records.slice()
  const query = String(input.query ?? '').trim()
  if (!query || records.length < CEREBELLUM_CONVERSATION_RANK_MIN_POOL) {
    return records
  }
  let context: Awaited<ReturnType<CerebellumRuntime['resolveCallContext']>> = null
  try {
    context = await input.runtime.resolveCallContext()
  } catch {
    return records
  }
  if (!context) {
    return records
  }
  const candidates = records.map((record, index) => ({
    id: `${String(record?.sessionId ?? '')}#${index}`,
    text: formatConversationCandidateText({
      title: typeof record?.peerName === 'string' ? record.peerName : undefined,
      human: record?.role === 'user' ? String(record?.text ?? '') : undefined,
      assistant: record?.role === 'assistant' ? String(record?.text ?? '') : undefined,
    }),
  }))
  const startedAt = Date.now()
  let scores: ReadonlyMap<string, number> | null = null
  try {
    scores = await rankConversationsWithCerebellum({
      config: context.config,
      fetchImpl: context.fetchImpl,
      searchQuery: query,
      chats: candidates,
    })
  } catch {
    scores = null
  }
  input.log?.(
    `cerebellum conversation re-rank: pooled=${records.length} `
    + `ranked=${scores?.size ?? 0} used=${scores != null} latencyMs=${Date.now() - startedAt}`,
  )
  if (!scores) {
    return records
  }
  const keyed = records.map((record, index) => ({ record, id: candidates[index].id }))
  const ordered = orderConversationHits(keyed, scores)
  // The render payload keeps its original record shape, order changed only.
  return ordered.map((row) => row.record)
}
