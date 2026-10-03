import type { MetabotPaths } from '../state/paths';
import { type DreamStore } from './dreamStore';
import { type ExperienceStore } from './experienceStore';
import { type ImpressionStore } from './impressionStore';
import { type KnowledgeStore } from './knowledgeStore';
import type { KnowledgeBaseStore } from '../knowledgebase/store';
import { type ResolvedMemoryScopes } from './memoryScopeResolver';
import { type MemoryPolicyStore } from './memoryPolicy';
import { type MemoryStore } from './memoryStore';
import type { ApplyTurnMemoryUpdatesOptions, ApplyTurnMemoryUpdatesResult, MemoryEffectivePolicy } from './memoryTypes';
export interface MemoryBlocksRequest {
    channel?: string;
    peerGlobalMetaId?: string;
    externalConversationId?: string;
    userText?: string;
}
export interface MemoryBlocksResult {
    xml: string;
    policy: MemoryEffectivePolicy;
    resolution: ResolvedMemoryScopes;
}
/**
 * Experience-only hot layer: the dream-written self-identity, self-distilled
 * value boundaries, work reviews, and recent dream diaries. For scenarios
 * that must NOT receive scoped owner/contact memories (public-facing or
 * protocol-short outputs) but whose behavior must still align with the bot's
 * self-cognition. Returns '' when memory is disabled by policy; never throws.
 */
export declare function buildExperienceContext(paths: MetabotPaths, stores?: {
    memory?: MemoryStore;
    policy?: MemoryPolicyStore;
    dream?: DreamStore;
}): Promise<string>;
/**
 * Build the full memory injection for one turn: scoped fact blocks plus the
 * experience hot layer (self-identity, value boundaries, work reviews, recent
 * dream diaries). Knowledge blocks join in their own phase — the builders
 * already tolerate their absence.
 */
export declare function buildMemoryBlocksForRequest(paths: MetabotPaths, input: MemoryBlocksRequest, stores?: {
    memory?: MemoryStore;
    policy?: MemoryPolicyStore;
    dream?: DreamStore;
    knowledge?: KnowledgeStore;
    knowledgeBases?: KnowledgeBaseStore;
    experience?: ExperienceStore;
    impressions?: ImpressionStore;
}): Promise<MemoryBlocksResult>;
/**
 * Post-turn memory write path: regex extraction (+ optional LLM judge for
 * borderline candidates), then create/revive or delete inside the resolved
 * write scope. Ported from CoworkStore.applyTurnMemoryUpdates.
 */
export declare function applyTurnMemoryExtraction(paths: MetabotPaths, options: ApplyTurnMemoryUpdatesOptions, stores?: {
    memory?: MemoryStore;
    policy?: MemoryPolicyStore;
}): Promise<ApplyTurnMemoryUpdatesResult>;
