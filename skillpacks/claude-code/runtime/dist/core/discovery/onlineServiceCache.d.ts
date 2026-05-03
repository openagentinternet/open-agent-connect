import type { RatingDetailItem } from '../ratings/ratingDetailState';
import { type MetabotPaths } from '../state/paths';
export declare const ONLINE_SERVICE_CACHE_LIMIT = 1000;
export declare const DEFAULT_ONLINE_SERVICE_CACHE_SYNC_INTERVAL_MS: number;
export type OnlineServiceDiscoverySource = 'chain' | 'seeded' | 'cache';
export interface OnlineServiceCachePaths {
    servicesRoot: string;
    servicesPath: string;
}
export interface OnlineServiceCacheEntry {
    servicePinId: string;
    sourceServicePinId: string;
    chainPinIds: string[];
    providerGlobalMetaId: string;
    providerMetaId: string | null;
    providerAddress: string | null;
    providerName: string | null;
    providerSkill: string | null;
    providerDaemonBaseUrl: string | null;
    providerChatPublicKey: string | null;
    serviceName: string;
    displayName: string;
    description: string;
    price: string;
    currency: string;
    serviceIcon: string | null;
    skillDocument: string | null;
    inputType: string | null;
    outputType: string | null;
    endpoint: string | null;
    paymentAddress: string | null;
    available: boolean;
    online: boolean;
    lastSeenSec: number | null;
    lastSeenAt: number | null;
    lastSeenAgoSeconds: number | null;
    updatedAt: number;
    ratingAvg: number | null;
    ratingCount: number;
    cachedAt: number;
}
export interface OnlineServiceCacheState {
    version: 1;
    services: OnlineServiceCacheEntry[];
    totalServices: number;
    limit: number;
    discoverySource: OnlineServiceDiscoverySource;
    fallbackUsed: boolean;
    lastSyncedAt: number | null;
    lastError: string | null;
}
export interface BuildOnlineServiceCacheStateInput {
    services: Array<Record<string, unknown>>;
    ratingDetails?: RatingDetailItem[];
    discoverySource: OnlineServiceDiscoverySource;
    fallbackUsed: boolean;
    limit?: number;
    now?: () => number;
    lastError?: string | null;
}
export interface SearchOnlineServiceCacheOptions {
    query?: string | null;
    onlineOnly?: boolean;
    currency?: string | null;
    maxPrice?: string | number | null;
    minRating?: number | null;
    limit?: number | null;
}
export interface OnlineServiceCacheStore {
    paths: OnlineServiceCachePaths;
    ensureLayout(): Promise<OnlineServiceCachePaths>;
    read(): Promise<OnlineServiceCacheState>;
    write(nextState: OnlineServiceCacheState): Promise<OnlineServiceCacheState>;
    update(updater: (currentState: OnlineServiceCacheState) => OnlineServiceCacheState | Promise<OnlineServiceCacheState>): Promise<OnlineServiceCacheState>;
}
export declare function buildOnlineServiceCacheState(input: BuildOnlineServiceCacheStateInput): OnlineServiceCacheState;
export declare function createOnlineServiceCacheStore(homeDirOrPaths: string | MetabotPaths): OnlineServiceCacheStore;
export declare function searchOnlineServiceCacheServices(services: OnlineServiceCacheEntry[], options?: SearchOnlineServiceCacheOptions): OnlineServiceCacheEntry[];
