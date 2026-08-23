import { type MemoryOrigin, type MemoryScope, type MemoryUsageClass, type MemoryVisibility } from './memoryScope';
export declare const MEMORY_NEAR_DUPLICATE_MIN_SCORE = 0.82;
export declare const MEMORY_TEXT_MAX_CHARS = 360;
/** self_identity holds the dream pipeline's four-part self-distillation
 * (200+ chars by contract, typically 350–600) — the generic 360-char memory
 * cap used to cut every identity entry mid-sentence. */
export declare const SELF_IDENTITY_TEXT_MAX_CHARS = 1200;
export declare function normalizeMemoryText(value: string): string;
export declare function truncateMemoryText(value: string, maxChars: number): string;
export declare function normalizeMemoryUsageClass(value?: string | null): MemoryUsageClass;
export declare function normalizeMemoryOrigin(value?: string | null): MemoryOrigin;
export declare function normalizeMemoryVisibility(value?: string | null): MemoryVisibility;
export declare function maxMemoryTextChars(usageClass?: string | null): number;
export declare function normalizeMemoryMatchKey(value: string): string;
export declare function normalizeMemorySemanticKey(value: string): string;
export declare function scoreMemorySimilarity(left: string, right: string): number;
export declare function choosePreferredMemoryText(currentText: string, incomingText: string): string;
export declare function scoreDeleteMatch(targetKey: string, queryKey: string): number;
export declare function buildMemoryFingerprint(text: string): string;
/**
 * Rough token estimate for mixed Chinese/English text, ported from IDBots
 * coworkContextBudget.estimateCoworkTextTokens: CJK codepoints count as one
 * token each, everything else as ~4 chars per token.
 */
export declare function estimateTextTokens(value: string): number;
export declare function classifyMemoryText(text: string, scope: MemoryScope): {
    usageClass: MemoryUsageClass;
    visibility: MemoryVisibility;
};
export declare function resolveMemoryClassification(text: string, scope: MemoryScope, overrides?: {
    usageClass?: MemoryUsageClass | null;
    visibility?: MemoryVisibility | null;
}): {
    usageClass: MemoryUsageClass;
    visibility: MemoryVisibility;
};
/** Terms for transcript/conversation search: full phrase plus per-token terms, max 8. */
export declare function extractConversationSearchTerms(value: string): string[];
export declare function inferPeerGlobalMetaIdFromConversationId(sourceChannel?: string | null, externalConversationId?: string | null): string | null;
