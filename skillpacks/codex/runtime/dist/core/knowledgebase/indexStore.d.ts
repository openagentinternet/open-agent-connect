/**
 * Derived per-KB search index — OAC port of the IDBots knowledgeBaseIndexStore,
 * on a portable pure-JS inverted index instead of FTS5 (OAC targets Node >=20
 * where node:sqlite is unavailable). Everything here is derived state: delete
 * the file + run learn to rebuild. Ranking mirrors the IDBots blend:
 * normalized bm25-style tf/idf + phraseScore (0.85 / 0.15), minScore 0.18.
 *
 * Incremental learn mirrors the IDBots docs-table semantics: a document whose
 * raw bytes are unchanged (size+mtime short-circuit, else sha256 of the file
 * bytes) reuses its stored chunks AND their precomputed token lists — the
 * expensive extraction/chunking/tokenization steps only rerun for changed or
 * new files, and docs that vanished from the raw dir drop out. Tokens live in
 * the chunk rows (the equivalent of IDBots' FTS5 `token_text` column), which
 * also removes the per-generation re-tokenization from the query path.
 */
import { cleanKnowledgeBaseText } from './text';
export interface KbIndexDocRow {
    relpath: string;
    sha256: string;
    size: number;
    mtimeMs: number;
    title: string;
    chunkCount: number;
    ingestedAt: number;
}
export interface KbIndexChunkRow {
    docRelPath: string;
    ord: number;
    text: string;
    /** Precomputed query tokens (v2); absent rows fall back to on-the-fly tokenization. */
    tokens?: string[];
}
export interface KbQueryHit {
    docRelPath: string;
    ord: number;
    snippet: string;
    score: number;
    title: string;
}
interface IndexFile {
    version: 1 | 2;
    docs: KbIndexDocRow[];
    chunks: KbIndexChunkRow[];
    /** token -> chunk indexes (positional into chunks). */
    inverted: Record<string, number[]>;
}
export interface KbIndexStore {
    filePath: string;
    load(): Promise<IndexFile | null>;
    rebuild(rawDir: string, now: () => number, options?: {
        full?: boolean;
    }): Promise<KbLearnStats & {
        docCount: number;
        chunkCount: number;
    }>;
    /**
     * Learn ONE raw doc into the current index without walking the corpus
     * (the addDocument hot path). Returns null when the stored index is v1
     * (no token lists) and a full rebuild is required to migrate.
     */
    upsertDoc(rawDir: string, filePath: string, now: () => number): Promise<{
        changed: boolean;
        docCount: number;
        chunkCount: number;
    } | null>;
    query(query: string, options: {
        topK?: number;
        minScore?: number;
    }): Promise<KbQueryHit[]>;
    clear(): Promise<void>;
}
/** What one learn pass did relative to the previous index (IDBots parity). */
export interface KbLearnStats {
    /** Documents that were not in the previous index. */
    added: number;
    /** Documents whose raw bytes changed since the previous index. */
    updated: number;
    /** Documents that vanished from the raw dir. */
    removed: number;
    /** Raw docs whose extraction failed this pass — first 20, with reasons (IDBots `summary.failed` parity). */
    failed: Array<{
        file: string;
        reason: string;
    }>;
    /** Total extraction failures this pass (`failed` is the bounded sample). */
    failedTotal: number;
}
export declare const KB_QUERY_DEFAULT_TOP_K = 8;
export declare const KB_QUERY_DEFAULT_MIN_SCORE = 0.18;
export declare class KbIndexLockError extends Error {
    readonly code: 'learn_busy';
    constructor(code: 'learn_busy', message: string);
}
export declare const KB_INDEX_LOCK_WAIT_MS: number;
export declare const KB_INDEX_LOCK_STALE_MS: number;
export interface KbIndexLockOptions {
    waitMs?: number;
    staleMs?: number;
    now?: () => number;
    log?: (message: string) => void;
}
export declare function withKbIndexLock<T>(indexPath: string, fn: () => Promise<T>, options?: KbIndexLockOptions): Promise<T>;
export declare function createKnowledgeBaseIndexStore(filePath: string): KbIndexStore;
export { cleanKnowledgeBaseText };
