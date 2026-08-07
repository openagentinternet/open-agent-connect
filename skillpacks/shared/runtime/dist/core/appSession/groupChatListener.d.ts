/**
 * Daemon-side group chat socket listener for the App/Game Runtime.
 *
 * Reuses the existing Metaso socket infrastructure (same endpoint and
 * `type: 'pc'` connection parameters as the MetaApp chat client and the A2A
 * simplemsg listener). The socket is a realtime notification only: the
 * runtime always catches up through `group-chat-list-by-index`. Messages that
 * do not belong to a running app session are ignored (normal group chat
 * traffic is not processed by the daemon).
 */
import type { IdentityProfileRecord } from '../identity/identityProfiles';
import type { GroupChatMessage } from './types';
export interface GroupChatSocketEndpoint {
    url: string;
    path: string;
}
export interface GroupChatSocketClient {
    on(event: string, handler: (...args: any[]) => void | Promise<void>): GroupChatSocketClient;
    emit(event: string, ...args: unknown[]): unknown;
    removeAllListeners(): unknown;
    disconnect(): unknown;
}
export interface GroupChatSocketOptions {
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
export type GroupChatSocketClientFactory = (endpoint: GroupChatSocketEndpoint, options: GroupChatSocketOptions) => GroupChatSocketClient;
export interface GroupChatListenerManager {
    start(): Promise<{
        started: string[];
        skipped: Array<{
            slug: string;
            reason: string;
        }>;
    }>;
    stop(): void;
    isRunning(): boolean;
}
export interface GroupChatListenerOptions {
    systemHomeDir: string;
    listProfiles: () => Promise<IdentityProfileRecord[]>;
    resolveSocketEndpoints: () => Promise<GroupChatSocketEndpoint[]>;
    onGroupMessage: (profile: IdentityProfileRecord, message: GroupChatMessage) => void | Promise<void>;
    onError?: (error: Error) => void;
    socketClientFactory?: GroupChatSocketClientFactory;
    now?: () => number;
    logger?: (...args: unknown[]) => void;
}
/**
 * Normalize a socket payload into a group chat message. Accepts the raw
 * message object, a `{ M, D }` envelope, or the two-element array form used by
 * older clients. Only group chat notifications are returned.
 */
export declare function normalizeGroupChatSocketPayload(data: unknown): GroupChatMessage | null;
export declare function createGroupChatListenerManager(options: GroupChatListenerOptions): GroupChatListenerManager;
