export declare const KNOWLEDGE_PROMPT_MAX_ITEMS = 8;
export declare const KNOWLEDGE_PROMPT_MAX_CHARS = 2400;
export interface KnowledgePromptEntry {
    topic: string;
    summary: string;
    kind: 'know_how' | 'pitfall' | 'principle';
    category?: string | null;
    version?: number;
}
/**
 * Hot layer: a bounded slice of the bot's reusable knowledge points (mix of
 * know-how and pitfalls), newest-first, dropped when over the char budget.
 * Injected so prior knowledge actively constrains new work instead of sitting
 * in storage.
 */
export declare function buildKnowledgeBlock(entries: KnowledgePromptEntry[], maxItems?: number, maxChars?: number): string;
/** Plain-text rendering of recall results for the knowledge_recall tool response. */
export declare function formatKnowledgeRecallResults(entries: KnowledgePromptEntry[]): string;
/** Human-readable confirmation for the knowledge_upsert tool response. */
export declare function formatKnowledgeUpsertResult(input: {
    topic: string;
    created: boolean;
    revised: boolean;
    version: number;
    kind: string;
}): string;
