import { type OnlineMetaBotDirectoryItem } from './socketPresenceDirectory';
export type SocketPresenceFailureMode = 'throw' | 'assume_service_providers_online';
export interface SocketPresenceProjection {
    online: boolean;
    lastSeenSec: number | null;
    lastSeenAt: number | null;
    lastSeenAgoSeconds: number | null;
    deviceCount: number | null;
    providerName: string;
}
export interface SocketPresenceRecordProjectionOptions {
    fetchImpl?: typeof fetch;
    socketPresenceApiBaseUrl?: string;
    socketPresenceLimit?: number;
    socketPresenceFailureMode?: SocketPresenceFailureMode;
    onlineOnly?: boolean;
}
export declare function decorateRecordsWithOnlineBots<T extends object>(input: {
    records: T[];
    onlineBots: OnlineMetaBotDirectoryItem[];
    onlineOnly?: boolean;
}): Array<T & SocketPresenceProjection>;
export declare function decorateRecordsWithSocketPresence<T extends object>(records: T[], options?: SocketPresenceRecordProjectionOptions): Promise<Array<T & SocketPresenceProjection>>;
