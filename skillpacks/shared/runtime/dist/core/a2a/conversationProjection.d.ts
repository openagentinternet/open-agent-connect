import type { A2AConversationMessage, A2AConversationMessageKind } from './conversationTypes';
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
}
export interface ListPeerConversationSummariesInput {
    homeDir: string;
    localGlobalMetaId: string;
    limit?: number;
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
export declare function listPeerConversationSummaries(input: ListPeerConversationSummariesInput): Promise<ListPeerConversationSummariesResult>;
export declare function readPeerConversationMessages(input: ReadPeerConversationMessagesInput): Promise<ReadPeerConversationMessagesResult>;
