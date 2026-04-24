export declare const CHAIN_HEARTBEAT_PROTOCOL_PATH = "/protocols/metabot-heartbeat";
export declare const HEARTBEAT_ONLINE_WINDOW_SEC: number;
export interface ChainHeartbeatEntry {
    address: string;
    timestamp: number | null;
    source?: string | null;
    error?: string | null;
}
export declare function isChainHeartbeatSemanticMiss(payload: unknown): boolean;
export declare function parseHeartbeatTimestamp(payload: unknown): number | null;
export declare function isHeartbeatFresh(timestampSec: number | null, nowMs?: number): boolean;
export declare function applyHeartbeatOnlineState<T extends {
    providerAddress?: unknown;
}>(services: T[], heartbeats: ChainHeartbeatEntry[], options?: {
    now?: () => number;
}): Array<T & {
    online: boolean;
    lastSeenSec: number | null;
}>;
export declare function filterOnlineChainServices<T extends {
    providerAddress?: unknown;
}>(services: T[], heartbeats: ChainHeartbeatEntry[], options?: {
    now?: () => number;
}): Array<T & {
    online: true;
    lastSeenSec: number | null;
}>;
