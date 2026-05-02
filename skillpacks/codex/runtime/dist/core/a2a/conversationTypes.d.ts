export type A2AConversationDirection = 'incoming' | 'outgoing';
export type A2AConversationMessageKind = 'private_chat' | 'order_protocol';
export type A2AConversationProtocolTag = 'ORDER' | 'ORDER_STATUS' | 'DELIVERY' | 'NeedsRating' | 'ORDER_END' | string;
export interface A2AConversationActor {
    globalMetaId: string;
    name?: string | null;
    avatar?: string | null;
    chatPublicKey?: string | null;
}
export interface A2AConversationMessage {
    messageId: string;
    sessionId: string;
    orderSessionId?: string | null;
    direction: A2AConversationDirection;
    kind: A2AConversationMessageKind;
    protocolTag?: A2AConversationProtocolTag | null;
    orderTxid?: string | null;
    paymentTxid?: string | null;
    content: string;
    contentType?: string | null;
    chain?: string | null;
    pinId?: string | null;
    txid?: string | null;
    txids?: string[];
    replyPinId?: string | null;
    timestamp: number;
    chainTimestamp?: number | null;
    sender: A2AConversationActor;
    recipient: A2AConversationActor;
    raw?: Record<string, unknown> | null;
}
export interface A2AConversationLocalProfile extends A2AConversationActor {
    profileSlug?: string | null;
}
export interface A2AConversationPeerProfile extends A2AConversationActor {
}
export interface A2APeerConversationSession {
    sessionId: string;
    type: 'peer';
    state: 'active' | 'closed' | string;
    createdAt: number;
    updatedAt: number;
    latestMessageId?: string | null;
}
export interface A2AOrderConversationSession {
    sessionId: string;
    type: 'service_order';
    role?: 'caller' | 'seller' | 'provider' | string | null;
    state: string;
    orderTxid?: string | null;
    paymentTxid?: string | null;
    servicePinId?: string | null;
    serviceName?: string | null;
    outputType?: string | null;
    createdAt: number;
    updatedAt: number;
    firstResponseAt?: number | null;
    deliveredAt?: number | null;
    ratingRequestedAt?: number | null;
    endedAt?: number | null;
    endReason?: string | null;
    failureReason?: string | null;
}
export type A2AConversationSession = A2APeerConversationSession | A2AOrderConversationSession;
export interface A2AConversationIndexes {
    messageIds: string[];
    orderTxidToSessionId: Record<string, string>;
    paymentTxidToSessionId: Record<string, string>;
}
export interface A2AConversationState {
    version: number;
    local: A2AConversationLocalProfile;
    peer: A2AConversationPeerProfile;
    messages: A2AConversationMessage[];
    sessions: A2AConversationSession[];
    indexes: A2AConversationIndexes;
    updatedAt: number;
}
