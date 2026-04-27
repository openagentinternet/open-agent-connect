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
