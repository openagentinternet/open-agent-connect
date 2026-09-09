import type { MemoryGuardLevel } from './memoryExtractor';
/** One LLM-extracted change: a durable fact to add or an instruction to delete. */
export interface MemoryTurnExtractionChange {
    action: 'add' | 'delete';
    text: string;
    isExplicit: boolean;
}
/** Substantive-turn gate (IDBots isSubstantiveMemoryText): ≥8 chars of
 * non-code-block text — tiny acknowledgements skip the LLM entirely. */
export declare function isSubstantiveMemoryText(userText: string): boolean;
export interface TurnMemoryExtractionPromptInput {
    userText: string;
    assistantText: string;
    guardLevel: MemoryGuardLevel;
    implicitEnabled: boolean;
}
export declare function buildTurnMemoryExtractionPrompts(input: TurnMemoryExtractionPromptInput): {
    system: string;
    user: string;
};
/** Tolerant parse of the extraction payload: strips code fences, takes the
 * outermost braces, drops malformed entries, enforces the 2/2/2 caps. */
export declare function parseTurnMemoryExtractionPayload(raw: string): MemoryTurnExtractionChange[] | null;
