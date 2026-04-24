export interface OnlineMetaBotDirectoryItem {
    globalMetaId: string;
    lastSeenAt: number;
    lastSeenAgoSeconds: number;
    deviceCount: number;
    online: true;
}
export interface ReadOnlineMetaBotsFromSocketPresenceOptions {
    fetchImpl?: typeof fetch;
    apiBaseUrl?: string;
    limit?: number;
}
export interface ReadOnlineMetaBotsFromSocketPresenceResult {
    source: 'socket_presence';
    total: number;
    onlineWindowSeconds: number | null;
    bots: OnlineMetaBotDirectoryItem[];
}
export declare function readOnlineMetaBotsFromSocketPresence(options?: ReadOnlineMetaBotsFromSocketPresenceOptions): Promise<ReadOnlineMetaBotsFromSocketPresenceResult>;
