export type ConversationSource = 'private_chat' | 'service_trace';
export interface ConversationActionViewModel {
    label: string;
    href: string;
}
export interface ConversationSummaryViewModel {
    conversationId: string;
    peerLabel: string;
    peerGlobalMetaId: string;
    source: ConversationSource;
    latestText: string;
    latestAt: number;
    latestAtLabel: string;
    kinds: string[];
    stateLabel: string;
    turnCountLabel: string;
    localBotLabel: string;
    serviceName: string;
    traceHref: string;
    sessionHref: string;
    refundHref: string;
    advancedActions: ConversationActionViewModel[];
    isSelected: boolean;
}
export interface ConversationMessageViewModel {
    messageId: string;
    directionLabel: string;
    content: string;
    timestampLabel: string;
}
export interface ConversationsEmptyStateViewModel {
    title: string;
    message: string;
}
export interface ConversationsPageViewModel {
    conversations: ConversationSummaryViewModel[];
    selectedConversation: ConversationSummaryViewModel | null;
    messages: ConversationMessageViewModel[];
    emptyState: ConversationsEmptyStateViewModel;
    detailEmptyState: ConversationsEmptyStateViewModel;
}
export interface ConversationsPageViewModelInput {
    conversations?: unknown[];
    conversationsResponse?: unknown;
    traceSessions?: unknown[];
    traceSessionsResponse?: unknown;
    messages?: unknown[];
    messagesResponse?: unknown;
    selectedConversationId?: string;
}
export declare function buildConversationsPageViewModel(input?: ConversationsPageViewModelInput): ConversationsPageViewModel;
export declare function buildConversationsPageViewModelRuntimeSource(): string;
