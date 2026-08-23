export interface MemoryPromptEntryLike {
    text: string;
    usageClass?: string | null;
    visibility?: string | null;
    updatedAt: number;
    lastUsedAt?: number | null;
}
/**
 * Byte budget for the whole rendered memory injection (all scoped blocks
 * combined). Memory earns its context (recall quality beats another tool
 * schema), so the default is generous — 12K chars ≈ 3K tokens, ~5x the
 * typical 20-entry block — but unbounded growth must not crowd out the
 * conversation itself. Over budget, entries are evicted oldest-first (by
 * lastUsedAt ?? updatedAt), never below the single top-ranked entry.
 */
export declare const DEFAULT_MEMORY_PROMPT_MAX_CHARS = 12000;
export declare function clampMemoryPromptMaxChars(value: number): number;
export interface RankedScopedMemoryEntry extends MemoryPromptEntryLike {
    block: 'owner' | 'contact' | 'conversation' | 'ownerOperationalPreference';
    relevanceScore: number;
}
export interface ScopedMemoryPromptSelection {
    ownerMemories: RankedScopedMemoryEntry[];
    contactMemories: RankedScopedMemoryEntry[];
    conversationMemories: RankedScopedMemoryEntry[];
    ownerOperationalPreferences: RankedScopedMemoryEntry[];
}
export interface RankScopedMemoryEntriesInput {
    requestChannel?: string | null;
    ownerEntries?: MemoryPromptEntryLike[];
    contactEntries?: MemoryPromptEntryLike[];
    conversationEntries?: MemoryPromptEntryLike[];
    currentUserText?: string;
    maxOwnerEntries?: number;
    maxScopedEntries?: number;
    maxOwnerOperationalPreferences?: number;
    /**
     * Combined char budget across all rendered memory blocks. Over budget,
     * entries are evicted oldest-first (lastUsedAt ?? updatedAt), never below
     * the single top-ranked entry. Defaults to DEFAULT_MEMORY_PROMPT_MAX_CHARS.
     */
    maxTotalChars?: number;
}
export interface BuildScopedMemoryPromptBlocksInput extends RankScopedMemoryEntriesInput {
    channel?: string | null;
}
export declare function selectScopedMemoryPromptEntries(input: RankScopedMemoryEntriesInput): ScopedMemoryPromptSelection;
export declare function rankScopedMemoryEntries(input: RankScopedMemoryEntriesInput): RankedScopedMemoryEntry[];
export declare function buildScopedMemoryPromptBlocks(input: BuildScopedMemoryPromptBlocksInput): string;
