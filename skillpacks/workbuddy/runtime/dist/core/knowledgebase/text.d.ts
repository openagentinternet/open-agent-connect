/**
 * Pure text processing for the MetaBot knowledge base. OAC port of the
 * IDBots knowledgeBaseText lib (itself ported from the metabot-create-wiki
 * runtime), keeping the three deliberate changes:
 *  1. The tokenizer additionally emits CJK bigrams (per CJK run, never
 *     across punctuation) so two-character Chinese words match reliably in
 *     FTS5 — the FTS5 trigram tokenizer cannot match queries shorter than
 *     3 chars.
 *  2. Chunking prefers paragraph/line boundaries inside the sliding window.
 *  3. `.json` files that look like a SimpleNote-protocol payload
 *     ({ title, contentType, content }) index only title + content as the
 *     document body; other JSON (e.g. raw MetaWeb pins) is indexed verbatim.
 */
export declare const SUPPORTED_KB_EXTENSIONS: ReadonlySet<string>;
export declare const KB_DEFAULT_CHUNK_SIZE = 1200;
export declare const KB_DEFAULT_CHUNK_OVERLAP = 180;
export declare const KB_SNIPPET_MAX_CHARS = 220;
export declare class KnowledgeBaseTextError extends Error {
    readonly code: 'dependency_missing' | 'unsupported_format' | 'extract_failed';
    constructor(code: KnowledgeBaseTextError['code'], detail: string);
}
export declare function cleanKnowledgeBaseText(value: string): string;
export declare function sha256Text(value: string): string;
export declare function sha256File(filePath: string): string;
export declare function commandExists(command: string): boolean;
export declare function getPdftotextInstallHint(): string;
export declare function getDocxDependencyHint(): string;
export interface KnowledgeBaseExtraction {
    text: string;
    title?: string;
}
export declare function extractKnowledgeBaseText(filePath: string): KnowledgeBaseExtraction;
/** Async sha256File: hashing a large file no longer blocks the event loop on a synchronous read. */
export declare function sha256FileAsync(filePath: string): Promise<string>;
/** Async extractKnowledgeBaseText — identical semantics, non-blocking I/O. */
export declare function extractKnowledgeBaseTextAsync(filePath: string): Promise<KnowledgeBaseExtraction>;
export declare function extractKbDocTitle(filePath: string, text: string): string;
/**
 * Latin words + CJK unigrams + CJK bigrams within each CJK run.
 * Bigrams make two-character Chinese words (民法, 合同, …) directly matchable.
 */
export declare function tokenizeKnowledgeBaseText(text: string): string[];
/** Pre-tokenized document text stored into the FTS5 index. */
export declare function toKnowledgeBaseFtsText(text: string): string;
/**
 * Builds a safe FTS5 MATCH expression from a free-form query.
 *
 * Token selection favors precision: latin words and CJK *bigrams* (a CJK
 * unigram is only emitted for an isolated single char, never for chars inside
 * a longer run — otherwise every doc containing e.g. 法 in 做法 would match a
 * 民法 query). Tokens are double-quoted (they only ever contain [a-z0-9_] or
 * CJK chars) and OR-ed so bm25() ranks chunks covering more of the query
 * higher.
 */
export declare function buildKbFtsQuery(query: string, maxTokens?: number): string;
export interface KnowledgeBaseChunk {
    text: string;
    startOffset: number;
    endOffset: number;
}
/** Sliding-window chunker that prefers breaking on paragraph/line boundaries. */
export declare function chunkKnowledgeBaseText(text: string, chunkSize?: number, chunkOverlap?: number): KnowledgeBaseChunk[];
export declare function buildKbCitationSnippet(text: string, maxChars?: number): string;
/**
 * Exact-phrase boost, ported from the wiki runtime's phraseScore:
 * full substring hit + shared CJK bigram ratio + latin token coverage.
 */
export declare function phraseScore(question: string, text: string): number;
