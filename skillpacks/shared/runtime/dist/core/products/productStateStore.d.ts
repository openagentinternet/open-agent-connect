import type { MetabotPaths } from '../state/paths';
import type { ProductListingPayload, ProductOrderPayload, ProductOrderState, ProductSku } from './productTypes';
export interface OwnedProductListingRecord {
    listingPinId: string;
    localMetabotSlug: string | null;
    name: string;
    title: string;
    productType: ProductListingPayload['productType'];
    skuCount: number;
    fulfillmentSkills: string[];
    payload: ProductListingPayload;
    available: boolean;
    revokedAt: number | null;
    localUpdatedAt: number;
}
export interface ProductDirectoryCacheRecord {
    listingPinId: string;
    name: string;
    title: string;
    productType: ProductListingPayload['productType'];
    skuCount: number;
    fulfillmentSkills: string[];
    payload: ProductListingPayload;
    sellerGlobalMetaId: string | null;
    sellerName: string | null;
    sellerMvcAddress: string | null;
    sellerChatPublicKey: string | null;
    online: boolean;
    cachedAt: number;
}
export interface ProductDeliverySummary {
    result: string | null;
    deliveryPinId: string | null;
    deliveredAt: number | null;
}
export interface ProductBuyerOrderRecord {
    role: 'buyer';
    productOrderPinId: string | null;
    listingPinId: string;
    skuId: string;
    paymentTxid: string | null;
    productOrderPayload: ProductOrderPayload | null;
    orderTxid: string | null;
    sellerGlobalMetaId: string | null;
    buyerGlobalMetaId: string | null;
    traceId: string | null;
    sessionId: string | null;
    deliverySummary: ProductDeliverySummary | null;
    state: ProductOrderState;
    localUpdatedAt: number;
}
export interface ProductSellerOrderRecord {
    role: 'seller';
    productOrderPinId: string;
    listingPinId: string;
    skuId: string;
    paymentTxid: string;
    productOrderPayload: ProductOrderPayload | null;
    orderTxid: string | null;
    buyerGlobalMetaId: string | null;
    fulfillmentSkills: string[];
    paymentVerified: boolean | null;
    selectedSku: ProductSku | null;
    fulfillmentState: ProductOrderState | null;
    deliveryPinId: string | null;
    deliverySummary: ProductDeliverySummary | null;
    failureReason: string | null;
    state: ProductOrderState;
    localUpdatedAt: number;
}
export interface ProductState {
    version: number;
    ownedListings: OwnedProductListingRecord[];
    directoryCache: ProductDirectoryCacheRecord[];
    buyerOrders: ProductBuyerOrderRecord[];
    sellerOrders: ProductSellerOrderRecord[];
}
export interface ProductStateStore {
    paths: MetabotPaths;
    productsRoot: string;
    productStatePath: string;
    ensureLayout(): Promise<MetabotPaths>;
    readState(): Promise<ProductState>;
    writeState(nextState: ProductState): Promise<ProductState>;
    updateState(updater: (currentState: ProductState) => ProductState | Promise<ProductState>): Promise<ProductState>;
    upsertOwnedListing(input: UpsertOwnedListingInput): Promise<OwnedProductListingRecord>;
    upsertDirectoryItem(input: UpsertDirectoryItemInput): Promise<ProductDirectoryCacheRecord>;
    upsertBuyerOrder(input: UpsertBuyerOrderInput): Promise<ProductBuyerOrderRecord>;
    upsertSellerOrder(input: UpsertSellerOrderInput): Promise<ProductSellerOrderRecord>;
    claimSellerOrderFulfillment(input: ClaimSellerOrderFulfillmentInput): Promise<ClaimSellerOrderFulfillmentResult>;
    findListingByPinId(listingPinId: string): Promise<ProductListingLookup | null>;
    listOrders(): Promise<ProductOrderLookup[]>;
    findOrderByOrderId(orderId: string): Promise<ProductOrderLookup | null>;
    findOrderByProductOrderPinId(productOrderPinId: string): Promise<ProductOrderLookup | null>;
    findSellerOrderByProductOrderPinId(productOrderPinId: string): Promise<ProductSellerOrderLookup | null>;
    findOrderByPaymentTxid(paymentTxid: string): Promise<ProductOrderLookup | null>;
    findOrderByOrderTxid(orderTxid: string): Promise<ProductOrderLookup | null>;
}
export interface UpsertOwnedListingInput {
    listingPinId: string;
    localMetabotSlug?: string | null;
    payload: ProductListingPayload;
    available?: boolean;
    revokedAt?: number | null;
    localUpdatedAt?: number;
}
export interface UpsertDirectoryItemInput {
    listingPinId: string;
    payload: ProductListingPayload;
    sellerGlobalMetaId?: string | null;
    sellerName?: string | null;
    sellerMvcAddress?: string | null;
    sellerChatPublicKey?: string | null;
    online?: boolean;
    cachedAt?: number;
}
export interface UpsertBuyerOrderInput {
    productOrderPinId?: string | null;
    listingPinId: string;
    skuId: string;
    paymentTxid?: string | null;
    productOrderPayload?: ProductOrderPayload | null;
    orderTxid?: string | null;
    sellerGlobalMetaId?: string | null;
    buyerGlobalMetaId?: string | null;
    traceId?: string | null;
    sessionId?: string | null;
    deliverySummary?: ProductDeliverySummary | null;
    state?: ProductOrderState;
    localUpdatedAt?: number;
}
export interface UpsertSellerOrderInput {
    productOrderPinId: string;
    listingPinId: string;
    skuId: string;
    paymentTxid: string;
    productOrderPayload?: ProductOrderPayload | null;
    orderTxid?: string | null;
    buyerGlobalMetaId?: string | null;
    fulfillmentSkills?: string[];
    paymentVerified?: boolean | null;
    selectedSku?: ProductSku | null;
    fulfillmentState?: ProductOrderState | null;
    deliveryPinId?: string | null;
    deliverySummary?: ProductDeliverySummary | null;
    failureReason?: string | null;
    state?: ProductOrderState;
    localUpdatedAt?: number;
}
export interface ClaimSellerOrderFulfillmentInput {
    productOrderPinId: string;
    listingPinId: string;
    skuId: string;
    paymentTxid: string;
    productOrderPayload?: ProductOrderPayload | null;
    orderTxid: string;
    buyerGlobalMetaId?: string | null;
    fulfillmentSkills?: string[];
    selectedSku?: ProductSku | null;
    localUpdatedAt?: number;
}
export type ClaimSellerOrderFulfillmentResult = {
    status: 'claimed';
    record: ProductSellerOrderRecord;
} | {
    status: 'duplicate_delivered';
    record: ProductSellerOrderRecord;
} | {
    status: 'in_progress';
    record: ProductSellerOrderRecord;
};
export type ProductListingLookup = {
    source: 'ownedListings';
    item: OwnedProductListingRecord;
} | {
    source: 'directoryCache';
    item: ProductDirectoryCacheRecord;
};
export type ProductOrderLookup = {
    source: 'buyerOrders';
    item: ProductBuyerOrderRecord;
} | {
    source: 'sellerOrders';
    item: ProductSellerOrderRecord;
};
export type ProductSellerOrderLookup = {
    source: 'sellerOrders';
    item: ProductSellerOrderRecord;
};
export declare function getProductOrderRecordId(record: ProductBuyerOrderRecord | ProductSellerOrderRecord): string;
export declare function createProductStateStore(homeDirOrPaths: string | MetabotPaths): ProductStateStore;
