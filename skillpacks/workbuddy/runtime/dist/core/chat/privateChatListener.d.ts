export interface PrivateChatListenerIdentity {
    globalMetaId: string;
    privateKeyHex: string;
    chatPublicKey: string;
}
export interface MetaWebPrivateMessage {
    txId?: string | null;
    pinId?: string | null;
    content?: string | null;
    contentType?: string | null;
    content_type?: string | null;
    timestamp?: number | null;
    replyPin?: string | null;
    fromGlobalMetaId?: string | null;
    toGlobalMetaId?: string | null;
    fromUserInfo?: {
        globalMetaId?: string | null;
        name?: string | null;
        avatar?: string | null;
        chatPublicKey?: string | null;
    } | null;
}
export declare function pinIdFromPrivateChatSocketMessage(message: MetaWebPrivateMessage): string | null;
export declare function senderGlobalMetaIdFromPrivateChatSocketMessage(message: MetaWebPrivateMessage): string;
export declare function normalizePrivateChatSocketMessage(data: unknown): MetaWebPrivateMessage | null;
export declare function decryptPrivateChatSocketMessage(message: MetaWebPrivateMessage, identity: PrivateChatListenerIdentity, peerChatPublicKeyOverride: string | null): string | null;
