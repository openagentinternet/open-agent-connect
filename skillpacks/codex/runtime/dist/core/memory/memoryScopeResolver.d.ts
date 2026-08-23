import { type MemoryScope } from './memoryScope';
export interface ResolveMemoryScopesInput {
    sourceChannel?: string | null;
    externalConversationId?: string | null;
    peerGlobalMetaId?: string | null;
}
export interface ResolvedMemoryScopes {
    writeScope: MemoryScope;
    readScopes: MemoryScope[];
    ownerReadPolicy: 'none' | 'operational_preference_only' | 'all';
    resolutionReason: 'owner_default' | 'contact_direct' | 'conversation_fallback';
}
export declare function resolveMemoryScopes(input: ResolveMemoryScopesInput): ResolvedMemoryScopes;
