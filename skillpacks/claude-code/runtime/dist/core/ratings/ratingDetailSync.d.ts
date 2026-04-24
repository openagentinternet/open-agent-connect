import { type RatingDetailItem, type RatingDetailState, type RatingDetailStateStore } from './ratingDetailState';
export declare const CHAIN_SERVICE_RATING_PROTOCOL_PATH = "/protocols/skill-service-rate";
export declare const DEFAULT_CHAIN_SERVICE_RATING_PAGE_SIZE = 200;
export declare const DEFAULT_CHAIN_SERVICE_RATING_MAX_PAGES = 20;
export interface RatingDetailListPage {
    list: Array<Record<string, unknown>>;
    nextCursor: string | null;
}
export interface RefreshRatingDetailCacheInput {
    store: RatingDetailStateStore;
    fetchPage: (cursor?: string) => Promise<RatingDetailListPage>;
    maxPages?: number;
    now?: () => number;
}
export interface RefreshRatingDetailCacheFromChainInput {
    store: RatingDetailStateStore;
    chainApiBaseUrl?: string;
    fetchImpl?: typeof fetch;
    pageSize?: number;
    maxPages?: number;
    now?: () => number;
}
export interface RefreshRatingDetailCacheResult {
    state: RatingDetailState;
    insertedCount: number;
    newestPinId: string | null;
    hitLatestPinId: boolean;
}
export declare function getRatingDetailListPage(payload: unknown): RatingDetailListPage;
export declare function parseRatingDetailItem(item: Record<string, unknown>, options?: {
    now?: () => number;
}): RatingDetailItem | null;
export declare function fetchRatingDetailPageFromChain(input: {
    chainApiBaseUrl?: string;
    fetchImpl?: typeof fetch;
    pageSize?: number;
}, cursor?: string): Promise<RatingDetailListPage>;
export declare function findRatingDetailByServicePayment(source: RatingDetailState | RatingDetailItem[], lookup: {
    serviceId: string;
    servicePaidTx: string;
}): RatingDetailItem | null;
export declare function refreshRatingDetailCache(input: RefreshRatingDetailCacheInput): Promise<RefreshRatingDetailCacheResult>;
export declare function refreshRatingDetailCacheFromChain(input: RefreshRatingDetailCacheFromChainInput): Promise<RefreshRatingDetailCacheResult>;
