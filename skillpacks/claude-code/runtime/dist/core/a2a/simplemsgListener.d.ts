import { type IdentityProfileRecord } from '../identity/identityProfiles';
import { type MetabotPaths } from '../state/paths';
import { type MetaWebPrivateMessage, type PrivateChatListenerIdentity } from '../chat/privateChatListener';
import type { PrivateChatInboundMessage } from '../chat/privateChatTypes';
import { type A2AConversationMessagePersister } from './conversationPersistence';
export interface A2ASimplemsgSocketEndpoint {
    url: string;
    path: string;
}
export interface A2ASimplemsgSocketClient {
    on(event: string, handler: (...args: any[]) => void | Promise<void>): A2ASimplemsgSocketClient;
    emit(event: string, ...args: any[]): unknown;
    removeAllListeners(): unknown;
    disconnect(): unknown;
}
export interface A2ASimplemsgSocketOptions {
    path: string;
    query: {
        metaid: string;
        type: 'pc';
    };
    reconnection: boolean;
    reconnectionDelay: number;
    reconnectionDelayMax: number;
    transports: string[];
}
export type A2ASimplemsgSocketClientFactory = (endpoint: A2ASimplemsgSocketEndpoint, options: A2ASimplemsgSocketOptions) => A2ASimplemsgSocketClient;
export interface A2ASimplemsgStartedProfile {
    slug: string;
    name: string;
    homeDir: string;
    globalMetaId: string;
}
export interface A2ASimplemsgSkippedProfile {
    slug: string;
    name: string;
    homeDir: string;
    globalMetaId: string | null;
    reason: string;
}
export interface A2ASimplemsgListenerStartReport {
    started: A2ASimplemsgStartedProfile[];
    skipped: A2ASimplemsgSkippedProfile[];
}
export interface A2ASimplemsgListenerManager {
    start(): Promise<A2ASimplemsgListenerStartReport>;
    stop(): void;
    isRunning(): boolean;
}
interface LoadedProfileIdentity {
    paths: MetabotPaths;
    identity: PrivateChatListenerIdentity;
}
export declare function normalizeSimplemsgSocketMessage(data: unknown): MetaWebPrivateMessage | null;
export declare function createA2ASimplemsgListenerManager(input: {
    systemHomeDir: string;
    socketEndpoints?: A2ASimplemsgSocketEndpoint[];
    socketClientFactory?: A2ASimplemsgSocketClientFactory;
    resolvePeerChatPublicKey?: (globalMetaId: string) => Promise<string | null>;
    persister?: A2AConversationMessagePersister;
    listProfiles?: (systemHomeDir: string) => Promise<IdentityProfileRecord[]>;
    loadProfileIdentity?: (profile: IdentityProfileRecord) => Promise<LoadedProfileIdentity | null>;
    onMessage?: (profile: IdentityProfileRecord, message: PrivateChatInboundMessage) => void | Promise<void>;
    reconnectDelayMs?: number;
    maxReconnectDelayMs?: number;
    heartbeatIntervalMs?: number;
    onError?: (error: Error) => void;
}): A2ASimplemsgListenerManager;
export {};
