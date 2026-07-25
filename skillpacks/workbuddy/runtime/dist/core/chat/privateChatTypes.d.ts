export interface PrivateChatConversation {
    conversationId: string;
    peerGlobalMetaId: string;
    peerName: string | null;
    topic: string | null;
    strategyId: string | null;
    state: 'active' | 'paused' | 'closed';
    turnCount: number;
    lastDirection: 'inbound' | 'outbound';
    createdAt: number;
    updatedAt: number;
    pendingGuidanceText: string | null;
    pendingGuidanceCreatedAt: number | null;
    pendingGuidanceLeaseId?: string | null;
    pendingGuidanceLeaseExpiresAt?: number | null;
}
export interface PrivateChatMessage {
    conversationId: string;
    messageId: string;
    direction: 'inbound' | 'outbound';
    senderGlobalMetaId: string;
    content: string;
    messagePinId: string | null;
    extensions: Record<string, unknown> | null;
    timestamp: number;
    deliveryRecovery?: {
        failedPinIds: string[];
        retryCount: number;
    } | null;
}
export interface PrivateChatState {
    version: number;
    conversations: PrivateChatConversation[];
    messages: PrivateChatMessage[];
}
export interface ChatStrategy {
    id: string;
    maxTurns: number;
    maxIdleMs: number;
    exitCriteria: string;
}
export interface ChatStrategiesState {
    strategies: ChatStrategy[];
}
export interface ChatPersona {
    soul: string;
    goal: string;
    role: string;
}
export interface PrivateChatInboundMessage {
    fromGlobalMetaId: string;
    content: string;
    contentType?: string | null;
    messagePinId: string | null;
    fromChatPublicKey: string | null;
    timestamp: number;
    rawMessage: Record<string, unknown> | null;
}
export interface ChatReplyRunnerInput {
    conversation: PrivateChatConversation;
    recentMessages: PrivateChatMessage[];
    persona: ChatPersona;
    strategy: ChatStrategy | null;
    inboundMessage?: PrivateChatMessage | null;
    operatorGuidanceText?: string | null;
}
export interface ChatReplyRunnerResult {
    state: 'reply' | 'end_conversation' | 'skip';
    content?: string;
    extensions?: Record<string, unknown>;
}
export type ChatReplyRunner = (input: ChatReplyRunnerInput) => ChatReplyRunnerResult | Promise<ChatReplyRunnerResult>;
export interface PrivateChatAutoReplyConfig {
    enabled: boolean;
    acceptPolicy: 'accept_all';
    defaultStrategyId: string | null;
    maxTurns?: number;
    cooldownMs?: number;
}
