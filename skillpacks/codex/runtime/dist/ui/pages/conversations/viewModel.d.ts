export interface LocalBotOptionViewModel {
    label: string;
    slug: string;
    globalMetaId: string;
    avatar: string;
    isSelected: boolean;
}
export interface ConversationSummaryViewModel {
    conversationId: string;
    conversationIdPreview: string;
    localGlobalMetaId: string;
    localAvatar: string;
    peerLabel: string;
    peerGlobalMetaId: string;
    peerAvatar: string;
    latestText: string;
    latestAt: number;
    latestAtLabel: string;
    kinds: string[];
    stateLabel: string;
    messageCountLabel: string;
    localBotLabel: string;
    isSelected: boolean;
}
export interface ConversationMessageViewModel {
    messageId: string;
    direction: string;
    directionLabel: string;
    kindLabel: string;
    content: string;
    contentType: string;
    isMarkdown: boolean;
    senderLabel: string;
    senderAvatar: string;
    txid: string;
    txidPreview: string;
    timestampLabel: string;
}
export interface ConversationsEmptyStateViewModel {
    title: string;
    message: string;
}
export interface ConversationsPageViewModel {
    localBots: LocalBotOptionViewModel[];
    selectedLocalGlobalMetaId: string;
    selectedPeerGlobalMetaId: string;
    conversations: ConversationSummaryViewModel[];
    selectedConversation: ConversationSummaryViewModel | null;
    messages: ConversationMessageViewModel[];
    emptyState: ConversationsEmptyStateViewModel;
    detailEmptyState: ConversationsEmptyStateViewModel;
}
export interface ConversationsPageViewModelInput {
    localBots?: unknown[];
    botProfilesResponse?: unknown;
    conversations?: unknown[];
    conversationsResponse?: unknown;
    traceSessions?: unknown[];
    traceSessionsResponse?: unknown;
    messages?: unknown[];
    messagesResponse?: unknown;
    selectedLocalGlobalMetaId?: string;
    selectedPeerGlobalMetaId?: string;
    selectedConversationId?: string;
}
export declare function buildConversationsPageViewModel(input?: ConversationsPageViewModelInput): ConversationsPageViewModel;
export declare function buildConversationsPageViewModelRuntimeSource(): string;
