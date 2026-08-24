/**
 * Derived per-KB search index — OAC port of the IDBots knowledgeBaseIndexStore,
 * on a portable pure-JS inverted index instead of FTS5 (OAC targets Node >=20
 * where node:sqlite is unavailable). Everything here is derived state: delete
 * the file + run learn to rebuild. Ranking mirrors the IDBots blend:
 * normalized bm25-style tf/idf + phraseScore (0.85 / 0.15), minScore 0.18.
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
}
export interface KbQueryHit {
    docRelPath: string;
    ord: number;
    snippet: string;
    score: number;
    title: string;
}
interface IndexFileV1 {
    version: 1;
    docs: KbIndexDocRow[];
    chunks: KbIndexChunkRow[];
    /** token -> chunk indexes (positional into chunks). */
    inverted: Record<string, number[]>;
}
export interface KbIndexStore {
    filePath: string;
    load(): Promise<IndexFileV1 | null>;
    rebuild(rawDir: string, now: () => number): Promise<{
        docCount: number;
        chunkCount: number;
    }>;
    query(query: string, options: {
        topK?: number;
        minScore?: number;
    }): Promise<KbQueryHit[]>;
    clear(): Promise<void>;
}
export declare const KB_QUERY_DEFAULT_TOP_K = 8;
export declare const KB_QUERY_DEFAULT_MIN_SCORE = 0.18;
export declare function createKnowledgeBaseIndexStore(filePath: string): KbIndexStore;
export { cleanKnowledgeBaseText };
