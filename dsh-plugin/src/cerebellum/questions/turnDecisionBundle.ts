/**
 * Cerebellum (小脑) per-turn decision bundle — port of IDBots
 * src/main/cerebellum/turnDecisionBundle.ts @ commit d75bea8ac2249da4886bfa0f6f1db838d234ef1f
 * (byte-synced semantics; import specifiers are extension-ful for NodeNext,
 * and this header replaces the Electron-session note).
 *
 * ONE /v1/systemone request per turn covering the five turn-scoped decisions
 * that used to fire five parallel requests: memory re-rank, skill shortlist,
 * remote-service shortlist, volatile block gate, and the knowledge hot-layer
 * rank.
 *
 * The JEV protocol natively multiplexes questions: `questions` is an id-keyed
 * map and `answers` comes back keyed the same way, and the five decisions'
 * question ids are already pairwise disjoint (`mem_<i>`, `best_skill`,
 * `best_service`, the gate's section keys, `kn_<i>`). The bundle therefore
 * reuses each decision module's own question builders and answer parsers
 * verbatim — only the transport is merged. One shared state carries the
 * current user message plus the memory and knowledge pools ONCE, instead of
 * five requests each serializing their own copy (the memory ranker's state
 * alone was ~20KB): five round-trips and five quota bills collapse into one.
 *
 * Per-decision failure semantics are preserved from the split-call era: each
 * answer section degrades independently inside one response (a missing
 * `best_skill` answer costs only the shortlist), the memory and knowledge
 * coverage floors still discard partial score maps as a whole, and any
 * transport failure (HTTP error, network error, abort/timeout, malformed
 * payload) returns null so the turn proceeds with lexical ranking, no
 * shortlists, and every volatile block injected.
 *
 * Deliberately NOT bundled: the reasoning-effort selector keeps its own
 * 1s-budget call (different semantics and consumer), and the brain-invoked
 * intuition tool is not turn-scoped at all.
 *
 * OAC difference from IDBots: this port compiles with the rest of the plugin
 * (tsc), so it carries sibling imports directly — no dist-electron split,
 * plain-Node tests can import the built module.
 */

import type { ResolvedCerebellumConfig } from '../config.js';
import type { CerebellumFetchLike, CerebellumMemoryCandidate } from './memoryRank.js';
import {
  CEREBELLUM_MEMORY_CURRENT_MESSAGE_MAX_CHARS,
  CEREBELLUM_MEMORY_MIN_ANSWER_COVERAGE,
  CEREBELLUM_MEMORY_MIN_POOL,
  buildMemoryRankQuestions,
  parseMemoryRankAnswers,
  selectMemoryRankCandidates,
} from './memoryRank.js';
import {
  CEREBELLUM_KNOWLEDGE_MIN_ANSWER_COVERAGE,
  CEREBELLUM_KNOWLEDGE_MIN_POOL,
  buildKnowledgeRankQuestions,
  parseKnowledgeRankAnswers,
  selectKnowledgeRankCandidates,
} from './knowledgeHotRank.js';
import type { CerebellumKnowledgeCandidate } from './knowledgeHotRank.js';
import {
  CEREBELLUM_SKILL_MAX_OPTIONS,
  CEREBELLUM_SKILL_SHORTLIST_MIN_POOL,
  buildSkillChoiceQuestions,
  parseSkillShortlistAnswers,
} from './skillShortlist.js';
import type { CerebellumSkillCandidate, CerebellumSkillChoiceQuestion, CerebellumSkillRankEntry } from './skillShortlist.js';
import {
  CEREBELLUM_REMOTE_SERVICE_MAX_OPTIONS,
  CEREBELLUM_REMOTE_SERVICE_SHORTLIST_MIN_POOL,
  buildRemoteServiceChoiceQuestions,
  parseRemoteServiceShortlistAnswers,
} from './remoteServiceShortlist.js';
import type {
  CerebellumRemoteServiceCandidate,
  CerebellumRemoteServiceChoiceQuestion,
  CerebellumRemoteServiceRankEntry,
} from './remoteServiceShortlist.js';
import { buildVolatileGateQuestions, parseVolatileGateAnswers } from './volatileBlockGate.js';

/**
 * Same hard abort deadline as every other cerebellum call site, unchanged by
 * the merge. The 2026-10-16 server baseline (relay P50 217ms / P99 412ms /
 * max 452ms, all < 600ms) leaves ~3x headroom over the observed worst case,
 * so the budget stays put.
 */
export const CEREBELLUM_TURN_DECISION_TIMEOUT_MS = 1500;

/** The five turn-scoped decisions, gathered by the caller before the call. */
export interface CerebellumTurnDecisionSet {
  currentUserText: string;
  /** Raw memory pool (last-used-DESC); the module prefilter bounds the payload. */
  memories: readonly CerebellumMemoryCandidate[];
  /** Raw knowledge pool (newest-first); blank entries drop at selection. */
  knowledge: readonly CerebellumKnowledgeCandidate[];
  /** Visible skill catalog; pools below the min size make no question. */
  skills: readonly CerebellumSkillCandidate[];
  /** Discovered remote-service directory; pools below the min make no question. */
  services: readonly CerebellumRemoteServiceCandidate[];
  /** Whether the volatile block gate questions ride (blank text skips all). */
  includeGate: boolean;
}

/**
 * The candidate slices the request and the answer parsers share: question
 * indexes refer to THESE arrays, not the raw inputs. null when nothing is
 * eligible (blank text, or every pool below its floor with the gate off).
 */
export interface CerebellumTurnDecisionSelection {
  currentUserText: string;
  memories: CerebellumMemoryCandidate[];
  knowledge: Array<{ id: string; text: string }>;
  skills: CerebellumSkillCandidate[];
  services: CerebellumRemoteServiceCandidate[];
  includeGate: boolean;
}

export type CerebellumTurnQuestion =
  | { type: 'noul'; instructions: string; criteria: { true: string; false: string } }
  | CerebellumSkillChoiceQuestion
  | CerebellumRemoteServiceChoiceQuestion;

export interface CerebellumTurnDecisionRequest {
  state: {
    current_message: string;
    memories?: CerebellumMemoryCandidate[];
    knowledge?: Array<{ id: string; text: string }>;
  };
  model: string;
  questions: Record<string, CerebellumTurnQuestion>;
}

/** Per-decision outcomes; each field degrades to null independently. */
export interface CerebellumTurnDecisionResults {
  memoryScores: ReadonlyMap<string, number> | null;
  knowledgeScores: ReadonlyMap<string, number> | null;
  skillRanking: CerebellumSkillRankEntry[] | null;
  serviceRanking: CerebellumRemoteServiceRankEntry[] | null;
  gateVerdicts: Record<string, boolean> | null;
}

/**
 * Local UTF-16-unit prefix cut (same semantics as truncateUtf16Units,
 * inlined to match the sibling decision modules).
 */
function truncateUtf16Prefix(text: string, maxUnits: number): string {
  if (maxUnits <= 0) return '';
  if (text.length <= maxUnits) return text;
  const cut = text.slice(0, maxUnits);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * Apply each decision's own floor (the same min-pool rules the split call
 * sites used) and candidate selection. Floors compare the RAW input size —
 * exactly where the old call sites checked — so behavior is unchanged.
 */
export function selectTurnDecisionCandidates(
  decisions: CerebellumTurnDecisionSet,
): CerebellumTurnDecisionSelection | null {
  const currentUserText = String(decisions.currentUserText ?? '');
  if (!currentUserText.trim()) {
    return null;
  }
  const memories = decisions.memories.length >= CEREBELLUM_MEMORY_MIN_POOL
    ? selectMemoryRankCandidates(decisions.memories, currentUserText)
    : [];
  const knowledge = decisions.knowledge.length >= CEREBELLUM_KNOWLEDGE_MIN_POOL
    ? selectKnowledgeRankCandidates(decisions.knowledge)
    : [];
  const skills = decisions.skills.length >= CEREBELLUM_SKILL_SHORTLIST_MIN_POOL
    ? decisions.skills.slice(0, CEREBELLUM_SKILL_MAX_OPTIONS)
    : [];
  const services = decisions.services.length >= CEREBELLUM_REMOTE_SERVICE_SHORTLIST_MIN_POOL
    ? decisions.services.slice(0, CEREBELLUM_REMOTE_SERVICE_MAX_OPTIONS)
    : [];
  const includeGate = decisions.includeGate;
  if (memories.length === 0 && knowledge.length === 0 && skills.length === 0 && services.length === 0 && !includeGate) {
    return null;
  }
  return { currentUserText, memories, knowledge, skills, services, includeGate };
}

/**
 * Assemble the merged request: one state (message + the two scored pools,
 * each sent once), and every eligible decision's questions under their
 * existing disjoint ids so the per-decision parsers keep working verbatim.
 */
export function buildTurnDecisionRequest(input: {
  selection: CerebellumTurnDecisionSelection;
  model: string;
}): CerebellumTurnDecisionRequest {
  const { selection } = input;
  return {
    state: {
      current_message: truncateUtf16Prefix(selection.currentUserText, CEREBELLUM_MEMORY_CURRENT_MESSAGE_MAX_CHARS),
      ...(selection.memories.length > 0 ? { memories: selection.memories } : {}),
      ...(selection.knowledge.length > 0 ? { knowledge: selection.knowledge } : {}),
    },
    model: input.model,
    questions: {
      ...buildMemoryRankQuestions(selection.memories.length),
      ...buildSkillChoiceQuestions(selection.skills),
      ...buildRemoteServiceChoiceQuestions(selection.services),
      ...(selection.includeGate ? buildVolatileGateQuestions() : {}),
      ...buildKnowledgeRankQuestions(selection.knowledge.length),
    },
  };
}

/**
 * Split one merged answer payload back into the five decisions, reusing each
 * decision module's parser plus its coverage floor. A section that is absent
 * or unusable resolves to null for that decision alone.
 */
export function parseTurnDecisionAnswers(
  payload: unknown,
  selection: CerebellumTurnDecisionSelection,
): CerebellumTurnDecisionResults {
  const memoryScores = parseMemoryRankAnswers(payload, selection.memories);
  const memoryScoresUsable = memoryScores !== null
    && memoryScores.size >= selection.memories.length * CEREBELLUM_MEMORY_MIN_ANSWER_COVERAGE
    ? memoryScores
    : null;
  const knowledgeScores = parseKnowledgeRankAnswers(payload, selection.knowledge);
  const knowledgeScoresUsable = knowledgeScores !== null
    && knowledgeScores.size >= selection.knowledge.length * CEREBELLUM_KNOWLEDGE_MIN_ANSWER_COVERAGE
    ? knowledgeScores
    : null;
  return {
    memoryScores: memoryScoresUsable,
    knowledgeScores: knowledgeScoresUsable,
    skillRanking: selection.skills.length > 0 ? parseSkillShortlistAnswers(payload, selection.skills) : null,
    serviceRanking: selection.services.length > 0
      ? parseRemoteServiceShortlistAnswers(payload, selection.services)
      : null,
    gateVerdicts: selection.includeGate ? parseVolatileGateAnswers(payload) : null,
  };
}

/** Payload accounting for the JEV cost budget (counts/chars, never text). */
export interface CerebellumTurnDecisionPayloadStats {
  memoriesSent: number;
  knowledgeSent: number;
  skillsSent: number;
  servicesSent: number;
  gateQuestions: number;
  totalQuestions: number;
  currentMessageChars: number;
  totalChars: number;
}

/**
 * Run every eligible turn decision through ONE /v1/systemone request.
 * Returns null on blank/uneligible input, HTTP errors, network errors,
 * abort/timeout, and malformed payloads — the caller then degrades each
 * decision exactly as the split call sites did. Never throws.
 */
export async function runCerebellumTurnDecisions(input: {
  config: ResolvedCerebellumConfig;
  fetchImpl: CerebellumFetchLike;
  decisions: CerebellumTurnDecisionSet;
  timeoutMs?: number;
  /** Debug hook: payload accounting (counts/chars only, never text). */
  onPayload?: (stats: CerebellumTurnDecisionPayloadStats) => void;
}): Promise<CerebellumTurnDecisionResults | null> {
  const { config, fetchImpl } = input;
  const selection = selectTurnDecisionCandidates(input.decisions);
  if (!selection) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1, input.timeoutMs ?? CEREBELLUM_TURN_DECISION_TIMEOUT_MS),
  );
  try {
    const request = buildTurnDecisionRequest({ selection, model: config.model });
    const body = JSON.stringify(request);
    input.onPayload?.({
      memoriesSent: selection.memories.length,
      knowledgeSent: selection.knowledge.length,
      skillsSent: selection.skills.length,
      servicesSent: selection.services.length,
      gateQuestions: selection.includeGate ? 4 : 0,
      totalQuestions: Object.keys(request.questions).length,
      currentMessageChars: request.state.current_message.length,
      totalChars: body.length,
    });
    const response = await fetchImpl(`${config.baseUrl}/v1/systemone`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    return parseTurnDecisionAnswers(await response.json(), selection);
  } catch {
    // Network errors, aborts/timeouts and JSON parse failures all land here:
    // every decision degrades to its pre-cerebellum behavior silently.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
