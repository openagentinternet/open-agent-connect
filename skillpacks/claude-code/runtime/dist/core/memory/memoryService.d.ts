import type { MetabotPaths } from '../state/paths';
import { type DreamStore } from './dreamStore';
import { type ExperienceStore } from './experienceStore';
import { type ImpressionStore } from './impressionStore';
import { type KnowledgeStore } from './knowledgeStore';
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
 * Build the full memory injection for one turn: scoped fact blocks plus the
 * experience hot layer (self-identity, value boundaries). Dream summaries and
 * knowledge blocks join in their own phases — the builders already tolerate
 * their absence.
 */
export declare function buildMemoryBlocksForRequest(paths: MetabotPaths, input: MemoryBlocksRequest, stores?: {
    memory?: MemoryStore;
    policy?: MemoryPolicyStore;
    dream?: DreamStore;
    knowledge?: KnowledgeStore;
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
