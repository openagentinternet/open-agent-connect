import type { A2AConversationMessage, A2AConversationMessageKind, A2AConversationState } from './conversationTypes';
export interface PeerConversationSummary {
    conversationId: string;
    localGlobalMetaId: string;
    localName: string | null;
    localAvatar: string | null;
    peerGlobalMetaId: string;
    peerName: string | null;
    peerAvatar: string | null;
    peerLlmPrimaryProvider?: string | null;
    peerLlmFallbackProvider?: string | null;
    latestText: string;
    latestAt: number;
    messageCount: number;
    kinds: A2AConversationMessageKind[];
    state: string;
    /** UI meta (pin/archive/rename override); defaults when never touched. */
    pinned: boolean;
    archivedAt: number | null;
    displayName: string | null;
}
export interface ListPeerConversationSummariesInput {
    homeDir: string;
    localGlobalMetaId: string;
    limit?: number;
    /** Keep archived conversations in the list (archived-surfaces hook). */
    includeArchived?: boolean;
}
export interface ListPeerConversationSummariesResult {
    localBot: {
        globalMetaId: string;
        name: string | null;
        avatar: string | null;
    };
    conversations: PeerConversationSummary[];
}
export interface ReadPeerConversationMessagesInput {
    homeDir: string;
    localGlobalMetaId: string;
    peerGlobalMetaId: string;
    before?: number;
    after?: number;
    limit?: number;
}
export interface ReadPeerConversationMessagesResult {
    localBot: {
        globalMetaId: string;
        name: string | null;
        avatar: string | null;
    };
    peerBot: {
        globalMetaId: string;
        name: string | null;
        avatar: string | null;
    };
    messages: A2AConversationMessage[];
    pagination: {
        beforeCursor: number | null;
        afterCursor: number | null;
        hasMoreBefore: boolean;
    };
}
export declare function peerConversationId(conversation: A2AConversationState): string;
/** Drop every cached conversation parse (test helper; production never needs it). */
export declare function clearConversationProjectionCache(): void;
export declare function listPeerConversationSummaries(input: ListPeerConversationSummariesInput): Promise<ListPeerConversationSummariesResult>;
/**
 * Load the raw stored conversation between one local Bot and one peer (any
 * message/session shape), for the meta writer and other pair-addressed reads.
 */
export declare function findPeerConversationState(input: {
    homeDir: string;
    localGlobalMetaId: string;
    peerGlobalMetaId: string;
}): Promise<A2AConversationState | null>;
export declare function readPeerConversationMessages(input: ReadPeerConversationMessagesInput): Promise<ReadPeerConversationMessagesResult>;
