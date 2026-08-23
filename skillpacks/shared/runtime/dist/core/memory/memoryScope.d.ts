export type MemoryScopeKind = 'owner' | 'contact' | 'conversation';
export type MemoryUsageClass = 'profile_fact' | 'preference' | 'operational_preference' | 'self_identity' | 'work_review' | 'value_boundary';
export type MemoryVisibility = 'local_only' | 'external_safe';
export type MemoryOrigin = 'conversation' | 'dream';
export interface MemoryScope {
    kind: MemoryScopeKind;
    key: string;
}
export interface MemoryScopeSelectorInputLike {
    scope?: MemoryScope | null;
    scopeKind?: MemoryScopeKind | null;
    scopeKey?: string | null;
}
export declare const OWNER_SCOPE_KEY = "owner:self";
/**
 * Channels that mean "the local human's own UI session". Anything else is an
 * external channel and follows the contact/conversation privacy rules.
 * 'cowork_ui' kept for IDBots port parity.
 */
export declare const LOCAL_MEMORY_CHANNELS: Set<string>;
export declare function isLocalMemoryChannel(channel?: string | null): boolean;
export declare function normalizeScopeChannel(channel?: string | null): string;
export declare function normalizeScopeIdentity(value?: string | null): string;
export declare function createOwnerMemoryScope(): MemoryScope;
export declare function buildContactScopeKey(input: {
    sourceChannel?: string | null;
    peerGlobalMetaId?: string | null;
}): string | null;
/**
 * Reverse of `buildContactScopeKey`: extracts the peer identity from a
 * contact scope key of the form `<channel>:peer:<peerGlobalMetaId>`.
 * Returns null when the key does not follow the contact shape.
 */
export declare function parseContactScopeKey(scopeKey?: string | null): {
    sourceChannel: string | null;
    peerGlobalMetaId: string | null;
} | null;
export declare function createContactMemoryScope(input: {
    sourceChannel?: string | null;
    peerGlobalMetaId?: string | null;
}): MemoryScope | null;
export declare function buildConversationScopeKey(input: {
    sourceChannel?: string | null;
    externalConversationId?: string | null;
}): string | null;
export declare function createConversationMemoryScope(input: {
    sourceChannel?: string | null;
    externalConversationId?: string | null;
}): MemoryScope | null;
export declare function normalizeMemoryScopeSelector(input: MemoryScopeSelectorInputLike): MemoryScope | null;
