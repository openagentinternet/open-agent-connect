import type { PrivateChatInboundMessage } from './privateChatTypes';
export interface PrivateChatListenerIdentity {
    globalMetaId: string;
    privateKeyHex: string;
    chatPublicKey: string;
}
export interface PrivateChatListenerCallbacks {
    onMessage: (message: PrivateChatInboundMessage) => void | Promise<void>;
    onError?: (error: Error) => void;
    onConnect?: () => void;
    onDisconnect?: (reason: string) => void;
}
export interface PrivateChatListener {
    start(): void;
    stop(): void;
    isRunning(): boolean;
}
export interface MetaWebPrivateMessage {
    txId?: string | null;
    pinId?: string | null;
    content?: string | null;
    timestamp?: number | null;
    replyPin?: string | null;
    fromGlobalMetaId?: string | null;
    toGlobalMetaId?: string | null;
    fromUserInfo?: {
        name?: string | null;
        avatar?: string | null;
        chatPublicKey?: string | null;
    } | null;
}
export declare function pinIdFromPrivateChatSocketMessage(message: MetaWebPrivateMessage): string | null;
export declare function normalizePrivateChatSocketMessage(data: unknown): MetaWebPrivateMessage | null;
export declare function decryptPrivateChatSocketMessage(message: MetaWebPrivateMessage, identity: PrivateChatListenerIdentity, peerChatPublicKeyOverride: string | null): string | null;
export declare function createPrivateChatListener(input: {
    getIdentity: () => Promise<PrivateChatListenerIdentity | null>;
    callbacks: PrivateChatListenerCallbacks;
    resolvePeerChatPublicKey?: (globalMetaId: string) => Promise<string | null>;
    socketEndpoints?: Array<{
        url: string;
        path: string;
    }>;
    reconnectDelayMs?: number;
    maxReconnectDelayMs?: number;
}): PrivateChatListener;
