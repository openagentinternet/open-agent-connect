import type { MetabotPaths } from '../state/paths';
import type { ChainHistoryKind, ChainHistorySearchOptions, ChainReadRecord, ChainSummaryOutcome, ChainWriteRecord, PendingSummaryEntry, RecordChainReadInput, RecordChainWriteInput } from './types';
export * from './types';
export { listMonthDirs, monthShardForMs, monthsInWindow, recentMonthShards } from './monthShard';
export interface ChainHistoryStore {
    /** Idempotent per pinId: an existing record is never overwritten. */
    recordWrite(input: RecordChainWriteInput): Promise<{
        created: boolean;
    }>;
    /** Upsert per pinId: re-reads bump readCount/lastReadAtMs and refresh only
     * the metadata the new input actually provides; summary/KB fields are never
     * clobbered. */
    recordRead(input: RecordChainReadInput): Promise<void>;
    getWrite(pinId: string): Promise<ChainWriteRecord | null>;
    getRead(pinId: string): Promise<ChainReadRecord | null>;
    markReadSavedToKb(pinId: string, kbId: string): Promise<boolean>;
    listWritesForDay(options: {
        startMs: number;
        endMs: number;
        limit?: number;
    }): Promise<ChainWriteRecord[]>;
    listReadsForDay(options: {
        startMs: number;
        endMs: number;
        limit?: number;
    }): Promise<ChainReadRecord[]>;
    /** Pending-summary candidates from the current + previous month shards only,
     * oldest first. */
    listPendingSummaries(kind: 'write', limit?: number): Promise<Array<PendingSummaryEntry<ChainWriteRecord>>>;
    listPendingSummaries(kind: 'read', limit?: number): Promise<Array<PendingSummaryEntry<ChainReadRecord>>>;
    applySummaryOutcome(kind: ChainHistoryKind, pinId: string, outcome: ChainSummaryOutcome): Promise<boolean>;
    /** Records with summarizedAtMs >= sinceMs; kind null counts both kinds. */
    countSummariesSince(kind: ChainHistoryKind | null, sinceMs: number): Promise<number>;
    searchWrites(options?: ChainHistorySearchOptions): Promise<ChainWriteRecord[]>;
    searchReads(options?: ChainHistorySearchOptions): Promise<ChainReadRecord[]>;
}
export declare function createChainHistoryStore(paths: MetabotPaths): ChainHistoryStore;
