/**
 * Barrel for the ported pure question builders/parsers (IDBots parity scope).
 * One module per feature, each pinned to the upstream file + commit in its
 * header comment (design doc §5.1 byte-sync discipline).
 *
 * Ported (IDBots src/main/cerebellum/ @ d75bea8ac2249da4886bfa0f6f1db838d234ef1f):
 * - memoryWriteGate.ts   (roadmap #1)
 * - memoryRank.ts        (first integration; defines CerebellumFetchLike)
 * - skillShortlist.ts    (#2)
 * - volatileBlockGate.ts (#3)
 * - knowledgeHotRank.ts  (#4)
 * - conversationSearchRank.ts (#15)
 * - remoteServiceShortlist.ts (#16)
 * - workerRank.ts        (#13)
 * - turnDecisionBundle.ts (2026-10-16 merge)
 * - intuitionTool.ts     (#12 — Round 3 PR-3; the agent-tool wiring lives in
 *   ../../cerebellum-tools.ts)
 *
 * NOT ported here: groupReplyGate (#5 — OAC has no on-chain group-chat
 * substrate, design doc §4 do-not-port), effortSelector (#11 — lives in
 * ../effort.ts).
 */

export type { CerebellumFetchLike } from './memoryRank.js';

export * from './memoryWriteGate.js';
export * from './memoryRank.js';
export * from './skillShortlist.js';
export * from './remoteServiceShortlist.js';
// knowledgeHotRank re-exported by name: it also declares a structurally
// identical CerebellumNoulQuestion (both byte-synced from IDBots, which has
// no barrel so the two never collide upstream) — the duplicate type is
// omitted here; import it from memoryRank.js.
export {
  CEREBELLUM_KNOWLEDGE_RANK_TIMEOUT_MS,
  CEREBELLUM_KNOWLEDGE_MAX_CANDIDATES,
  CEREBELLUM_KNOWLEDGE_MIN_POOL,
  CEREBELLUM_KNOWLEDGE_MIN_ANSWER_COVERAGE,
  CEREBELLUM_KNOWLEDGE_TEXT_MAX_CHARS,
  CEREBELLUM_KNOWLEDGE_RANK_INSTRUCTIONS,
  CEREBELLUM_KNOWLEDGE_RANK_CRITERIA,
  type CerebellumKnowledgeCandidate,
  type CerebellumKnowledgeRankRequest,
  cerebellumKnowledgeQuestionId,
  formatKnowledgeCandidateText,
  selectKnowledgeRankCandidates,
  buildKnowledgeRankQuestions,
  buildKnowledgeRankRequest,
  parseKnowledgeRankAnswers,
  rankKnowledgeWithCerebellum,
} from './knowledgeHotRank.js';
export * from './volatileBlockGate.js';
export * from './conversationSearchRank.js';
export * from './workerRank.js';
export * from './turnDecisionBundle.js';
export * from './intuitionTool.js';
