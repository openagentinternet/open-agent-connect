/**
 * Knowledge-base prompt block — the volatile per-turn slice that tells the bot
 * which knowledge bases it owns and how to use them. Port of the IDBots
 * knowledgeBasePromptBlocks lib: pure builder, callers pass already-loaded KB
 * records, so the caller stays the only place that touches the store. Kept
 * bounded (top 5 KBs) and injected into the volatile per-turn tail, never the
 * cacheable system-prompt head.
 */
export declare const KNOWLEDGE_BASES_PROMPT_MAX_ITEMS = 5;
export interface KnowledgeBasePromptRecord {
    name: string;
    description?: string | null;
    docCount?: number;
    chunkCount?: number;
    isDefault?: boolean;
}
/**
 * Hot layer: a bounded listing of the bot's knowledge bases (name +
 * description + document counts), so the model knows which corpora exist
 * before answering domain questions and where to save new finds. KBs are
 * listed even at 0 documents — the bot may add documents itself. Returns ''
 * when the bot has no knowledge bases at all.
 */
export declare function buildKnowledgeBasesPromptBlock(records: KnowledgeBasePromptRecord[], maxItems?: number): string;
