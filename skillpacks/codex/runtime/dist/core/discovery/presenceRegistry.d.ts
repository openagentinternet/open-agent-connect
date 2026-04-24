import { type PresenceProviderState, type ServiceDirectorySnapshot } from './serviceDirectory';
export interface HeartbeatFetchResult {
    timestamp?: number | null;
    source?: string;
    error?: string | null;
}
export interface PresenceRegistryDeps {
    fetchHeartbeat: (mvcAddress: string) => Promise<HeartbeatFetchResult | null>;
    now?: () => number;
}
type HeartbeatListener = (snapshot: ServiceDirectorySnapshot) => void;
export declare class PresenceRegistry {
    private deps;
    private _onlineBots;
    private _availableServices;
    private _providerStates;
    private _localHeartbeatsByAddress;
    private _forcedOfflineGlobalMetaIds;
    private _listeners;
    private _intervalId;
    private _getServices;
    private _pollPromise;
    private _pendingRefresh;
    constructor(deps: PresenceRegistryDeps);
    get onlineBots(): Map<string, number>;
    get availableServices(): any[];
    get providerStates(): Map<string, PresenceProviderState>;
    getDiscoverySnapshot(): ServiceDirectorySnapshot;
    subscribe(listener: HeartbeatListener): () => void;
    checkOnlineStatus(timestampSec: number | null): boolean;
    recordLocalHeartbeat(input: {
        globalMetaId?: string | null;
        address?: string | null;
        timestampSec?: number | null;
    }): void;
    pollAll(services: any[]): Promise<void>;
    startPolling(getServices: () => any[]): void;
    refreshNow(): Promise<void>;
    stopPolling(): void;
    markOffline(globalMetaId: string): void;
    forceOffline(globalMetaId: string): void;
    clearForceOffline(globalMetaId: string): void;
    private nowMs;
    private emitChange;
    private evaluateProviderGroup;
    private mapWithConcurrency;
}
export {};
