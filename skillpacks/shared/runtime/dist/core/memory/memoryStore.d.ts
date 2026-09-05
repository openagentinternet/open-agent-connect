import type { MetabotPaths } from '../state/paths';
import { type MemoryScope } from './memoryScope';
import type { MemoryCreateInput, MemoryDeleteInput, MemoryEntry, MemoryEntrySourceInput, MemoryEntryStats, MemoryListOptions, MemoryScopesOverview, MemoryScopeSelectorInput, MemoryUpdateInput } from './memoryTypes';
export interface MemoryWriteResult {
    memory: MemoryEntry;
    created: boolean;
    updated: boolean;
}
export interface MemoryStore {
    list(options?: MemoryListOptions): Promise<MemoryEntry[]>;
    create(input: MemoryCreateInput): Promise<MemoryEntry>;
    createOrRevive(input: MemoryCreateInput): Promise<MemoryWriteResult>;
    update(input: MemoryUpdateInput): Promise<MemoryEntry | null>;
    remove(input: MemoryDeleteInput): Promise<boolean>;
    /** Dream pipeline: replace one day's dream batch (self_identity excluded). */
    softDeleteDreamMemoriesForDate(dreamDate: string): Promise<number>;
    /** Hygiene: soft-archive specific memories by id (deep-consolidation retire).
     * self_identity is always refused; `notUsedSince` guards against the LLM
     * await window — rows touched after that snapshot survive. */
    archiveMemories(input: {
        ids: string[];
        archivedAt: string;
        notUsedSince?: number;
    }): Promise<number>;
    /** Hygiene reverse: clear the soft-archive mark on specific memories. */
    unarchiveMemories(ids: string[]): Promise<number>;
    /** Hygiene decay: dream-origin rows untouched past the cutoff get the mark
     * (self_identity and conversation-origin rows are never auto-archived). */
    archiveDecayedDreamMemories(input: {
        cutoffMs: number;
        archivedAt: string;
    }): Promise<number>;
    /** Hygiene purge: physically remove `status='deleted'` tombstones past the
     * grace period — the one low-risk delete in the memory layer. */
    purgeDeletedMemoryTombstones(cutoffMs: number): Promise<number>;
    /** Append one provenance source to an existing entry (no field changes). */
    addSource(id: string, scope: MemoryScope, source: MemoryEntrySourceInput): Promise<boolean>;
    /** Startup repair: revive the newest deleted self_identity when none is live. */
    restoreMissingSelfIdentity(): Promise<boolean>;
    markMemorySourcesInactiveBySession(sessionId: string): Promise<void>;
    markOrphanImplicitMemoriesStale(selector?: MemoryScopeSelectorInput): Promise<void>;
    stats(selector?: MemoryScopeSelectorInput): Promise<MemoryEntryStats>;
    listScopes(): Promise<MemoryScopesOverview>;
}
export declare function createMemoryStore(paths: MetabotPaths): MemoryStore;
