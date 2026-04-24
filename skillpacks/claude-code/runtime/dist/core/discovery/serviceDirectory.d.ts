export interface PresenceProviderState {
    key: string;
    globalMetaId: string;
    address: string;
    lastSeenSec: number | null;
    lastCheckAt: number | null;
    lastSource: string | null;
    lastError: string | null;
    online: boolean;
    optimisticLocal: boolean;
}
export interface ServiceDirectorySnapshot {
    onlineBots: Record<string, number>;
    availableServices: any[];
    providers: Record<string, PresenceProviderState>;
}
export interface LocalPresenceState {
    lastSeenSec: number;
    expiresAtSec?: number | null;
    peerIds?: string[] | null;
}
export interface LocalPresenceSnapshot {
    healthy: boolean;
    peerCount: number;
    onlineBots: Record<string, LocalPresenceState>;
    unhealthyReason: string | null;
    lastConfigReloadError: string | null;
    nowSec: number | null;
}
export interface ProviderGroup {
    key: string;
    globalMetaId: string;
    address: string;
    services: any[];
}
export declare const normalizeComparableGlobalMetaId: (value: unknown) => string;
export declare const resolveServiceGlobalMetaId: (service: any) => string;
export declare const resolveServiceProviderAddress: (service: any) => string;
export declare const buildProviderKey: (globalMetaId: string, address: string) => string;
export declare const cloneProviderState: (state: PresenceProviderState) => PresenceProviderState;
export declare const cloneDiscoverySnapshot: (snapshot: ServiceDirectorySnapshot) => ServiceDirectorySnapshot;
export declare const serializeDiscoverySnapshot: (snapshot: ServiceDirectorySnapshot) => string;
export declare const buildProviderGroups: (services: any[]) => ProviderGroup[];
export declare const buildPresenceSnapshot: (services: any[], presence: LocalPresenceSnapshot, fallbackNowSec: number, forcedOfflineGlobalMetaIds: ReadonlySet<string>) => ServiceDirectorySnapshot;
