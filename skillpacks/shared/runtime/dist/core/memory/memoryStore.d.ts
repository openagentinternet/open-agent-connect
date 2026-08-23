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
