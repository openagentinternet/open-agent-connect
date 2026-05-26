import { type SocketPresenceFailureMode } from '../discovery/socketPresenceProjection';
import type { OnlineMetaBotDirectoryItem } from '../discovery/socketPresenceDirectory';
import type { ProductStateStore } from './productStateStore';
import type { ProductListingPayload } from './productTypes';
export interface ProductDirectoryProduct {
    listingPinId: string;
    name: string;
    title: string;
    productType: ProductListingPayload['productType'];
    skuCount: number;
    skus: ProductListingPayload['skus'];
    fulfillment: Pick<ProductListingPayload['fulfillment'], 'fulfillmentType' | 'deliveryEndpoint'> & Partial<ProductListingPayload['fulfillment']>;
    payload: ProductListingPayload;
    sellerGlobalMetaId: string | null;
    sellerName: string | null;
    sellerMvcAddress?: string | null;
    sellerChatPublicKey?: string | null;
    online: boolean;
    lastSeenAt?: number | null;
    lastSeenAgoSeconds?: number | null;
    deviceCount?: number | null;
    cachedAt?: number;
    updatedAt?: number;
}
export interface ProductDirectoryResult {
    products: ProductDirectoryProduct[];
    total: number;
    source: 'cache' | 'chain';
    onlineOnly: boolean;
    cacheUpdatedAt: number | null;
}
export interface ListProductDirectoryOptions {
    productStateStore: ProductStateStore;
    cached?: boolean;
    onlineOnly?: boolean;
    query?: string;
    limit?: number;
    fetchImpl?: typeof fetch;
    chainApiBaseUrl?: string;
    productPageSize?: number;
    productMaxPages?: number;
    socketPresenceApiBaseUrl?: string;
    socketPresenceLimit?: number;
    socketPresenceFailureMode?: SocketPresenceFailureMode;
    onlineBots?: OnlineMetaBotDirectoryItem[];
}
export declare function projectProductDirectory(input: {
    products: ProductDirectoryProduct[];
    onlineOnly?: boolean;
    query?: string;
    limit?: number;
}): ProductDirectoryProduct[];
export declare function listProductDirectory(options: ListProductDirectoryOptions): Promise<ProductDirectoryResult>;
