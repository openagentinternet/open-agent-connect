export interface DeepConsolidationInventoryItem {
    id: string;
    kind: 'value_boundary' | 'work_review' | 'knowledge';
    text: string;
    extra?: string;
}
export interface DeepConsolidationRewrite {
    id: string;
    topic: string;
    summary: string;
    kind: 'know_how' | 'pitfall' | 'principle';
}
export interface DeepConsolidationOutput {
    retireMemoryIds: string[];
    retireKnowledgeIds: string[];
    rewriteKnowledge: DeepConsolidationRewrite[];
    notes: string;
}
export declare function shouldRunDeepConsolidation(itemCount: number): boolean;
/**
 * Maximum combined retire/rewrite actions one pass may propose — a quarter
 * of the inventory, rounded up. Shared by the prompt (so the model budgets
 * its own proposal) and the service guardrail (which refuses larger lists
 * as suspected hallucinated purges).
 */
export declare function deepConsolidationRetireCap(itemCount: number): number;
export declare function buildDeepConsolidationPrompt(input: {
    botName: string;
    items: DeepConsolidationInventoryItem[];
}): string;
export declare function parseDeepConsolidationOutput(raw: string): DeepConsolidationOutput | null;
/**
 * Human-readable diagnosis for a parse failure — distinguishes an answer
 * with no JSON object at all (prose drift or truncation before the object
 * finished, e.g. the output-token budget cut the stream mid-list) from a
 * complete-but-malformed object, so the surfaced error line points at the
 * actual cause instead of a bare "unparseable output".
 */
export declare function describeDeepConsolidationParseFailure(raw: string): string;
