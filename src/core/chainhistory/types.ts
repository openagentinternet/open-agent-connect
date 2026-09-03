// Chain history record types and store-wide limits. Records are machine
// managed JSON files under `.runtime/chain-history/` (storage layout v2
// amendment 2026-09-03); this module owns the on-disk schema (version 1).

export type ChainHistoryKind = 'write' | 'read';
export type ChainSummaryStatus = 'pending' | 'skipped' | 'done' | 'failed';

export interface ChainWriteRecord {
  version: 1;
  pinId: string;
  txId: string | null;
  path: string | null;
  operation: string | null;
  network: string | null;
  contentText: string | null;      // full text for text payloads, capped; null for binary
  contentTruncated: boolean;
  contentBytes: number;            // utf8 bytes of the original payload
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
  contentExcerpt: string | null;   // capped excerpt
  contentBytes: number;            // utf8 bytes of the original full text
  summary: string | null;
  summaryStatus: ChainSummaryStatus;
  summaryAttempts: number;
  summarizedAtMs: number | null;
  savedToKb: boolean;
  kbId: string | null;
  source: string | null;           // e.g. 'read_metaweb_pin' | 'study_job'
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
  contentText?: string | null;     // full text; the store derives the excerpt
  source?: string | null;
  readAtMs?: number;
}

export interface ChainHistorySearchOptions {
  query?: string | null;
  fromMs?: number;
  toMs?: number;
  limit?: number;
}

export type ChainSummaryOutcome =
  | { status: 'done'; summary: string }
  | { status: 'failed' };

/** One pending-summary candidate plus the shard its record file lives in. */
export interface PendingSummaryEntry<T> {
  shard: string;
  record: T;
}

export const MAX_WRITE_CONTENT_CHARS = 16_000;
export const MAX_READ_EXCERPT_CHARS = 8_000;
export const SUMMARY_MIN_CONTENT_CHARS = 800;
export const MAX_SUMMARY_ATTEMPTS = 3;
export const SUMMARY_MAX_CHARS = 500;
export const DEFAULT_SEARCH_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;
export const DAY_LIST_MAX_PER_KIND = 50;
export const PENDING_SCAN_MONTHS = 2;
export const PENDING_DEFAULT_LIMIT = 50;
export const PENDING_MAX_LIMIT = 200;
