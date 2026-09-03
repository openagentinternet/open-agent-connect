export type ChainHistoryKind = 'write' | 'read';
export type ChainSummaryStatus = 'pending' | 'skipped' | 'done' | 'failed';
export interface ChainWriteRecord {
    version: 1;
    pinId: string;
    txId: string | null;
    path: string | null;
    operation: string | null;
    network: string | null;
    contentText: string | null;
    contentTruncated: boolean;
    contentBytes: number;
    contentType: string | null;
    summary: string | null;
    summaryStatus: ChainSummaryStatus;
    summaryAttempts: number;
    summarizedAtMs: number | null;
    occurredAtMs: number;
    createdAtMs: number;
}
export interface ChainReadRecord {
    version: 1;
    pinId: string;
    path: string | null;
    protocol: string | null;
    title: string | null;
    authorGlobalMetaId: string | null;
    contentExcerpt: string | null;
    contentBytes: number;
    summary: string | null;
    summaryStatus: ChainSummaryStatus;
    summaryAttempts: number;
    summarizedAtMs: number | null;
    savedToKb: boolean;
    kbId: string | null;
    source: string | null;
    firstReadAtMs: number;
    lastReadAtMs: number;
    readCount: number;
}
export interface RecordChainWriteInput {
    pinId: string;
    txId?: string | null;
    path?: string | null;
    operation?: string | null;
    network?: string | null;
    contentText?: string | null;
    contentBytes?: number;
    contentType?: string | null;
    occurredAtMs?: number;
}
export interface RecordChainReadInput {
    pinId: string;
    path?: string | null;
    protocol?: string | null;
    title?: string | null;
    authorGlobalMetaId?: string | null;
    contentText?: string | null;
    source?: string | null;
    readAtMs?: number;
}
export interface ChainHistorySearchOptions {
    query?: string | null;
    fromMs?: number;
    toMs?: number;
    limit?: number;
}
export type ChainSummaryOutcome = {
    status: 'done';
    summary: string;
} | {
    status: 'failed';
};
/** One pending-summary candidate plus the shard its record file lives in. */
export interface PendingSummaryEntry<T> {
    shard: string;
    record: T;
}
export declare const MAX_WRITE_CONTENT_CHARS = 16000;
export declare const MAX_READ_EXCERPT_CHARS = 8000;
export declare const SUMMARY_MIN_CONTENT_CHARS = 800;
export declare const MAX_SUMMARY_ATTEMPTS = 3;
export declare const SUMMARY_MAX_CHARS = 500;
export declare const DEFAULT_SEARCH_WINDOW_MS: number;
export declare const SEARCH_DEFAULT_LIMIT = 20;
export declare const SEARCH_MAX_LIMIT = 50;
export declare const DAY_LIST_MAX_PER_KIND = 50;
export declare const PENDING_SCAN_MONTHS = 2;
export declare const PENDING_DEFAULT_LIMIT = 50;
export declare const PENDING_MAX_LIMIT = 200;
