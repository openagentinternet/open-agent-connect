import type { ChainAdapterRegistry } from '../chain/adapters/types';
import { type VerifiedServiceOrderPayment } from '../payments/servicePaymentVerification';
import type { OwnedProductListingRecord, ProductDirectoryCacheRecord, ProductSellerOrderRecord, ProductStateStore } from './productStateStore';
import type { ProductListingPayload, ProductOrderPayload, ProductSku } from './productTypes';
export type ProductFulfillmentFailureCode = 'product_order_not_found' | 'invalid_product_order_protocol' | 'product_listing_not_found' | 'invalid_product_listing_protocol' | 'product_listing_not_owned' | 'product_sku_not_found' | 'product_buyer_mismatch' | 'product_unsupported_fulfillment' | 'product_payment_invalid' | 'product_fulfillment_failed';
export interface ProductFulfillmentFailure {
    ok: false;
    code: ProductFulfillmentFailureCode;
    message: string;
    data?: Record<string, unknown>;
}
export interface ProductSellerIdentity {
    globalMetaId?: string | null;
    name?: string | null;
    mvcAddress?: string | null;
    addresses?: {
        mvc?: string | null;
        btc?: string | null;
    } | null;
    chatPublicKey?: string | null;
}
export interface ProductFulfillmentBuyerIdentity {
    globalMetaId?: string | null;
    name?: string | null;
    chatPublicKey?: string | null;
}
export interface ProductOrderA2AMetadata {
    messagePinId?: string | null;
    timestamp?: number | null;
    sessionId?: string | null;
    traceId?: string | null;
    rawContent?: string | null;
}
export interface ProductChainPin {
    pinId?: string | null;
    id?: string | null;
    pinID?: string | null;
    path?: string | null;
    content?: unknown;
    contentSummary?: unknown;
    payload?: unknown;
    globalMetaId?: string | null;
    creatorGlobalMetaId?: string | null;
    createGlobalMetaId?: string | null;
    createMetaId?: string | null;
    createAddress?: string | null;
    creatorAddress?: string | null;
    mvcAddress?: string | null;
    timestamp?: number | string | null;
    updatedAt?: number | string | null;
}
export interface ProductFulfillmentChainFetcher {
    fetchProductOrderPin(productOrderPinId: string): Promise<ProductChainPin | null>;
    fetchProductListingPin(listingPinId: string): Promise<ProductChainPin | null>;
}
type ResolveSellerProductStateStore = Pick<ProductStateStore, 'findSellerOrderByProductOrderPinId' | 'findListingByPinId' | 'upsertSellerOrder' | 'upsertOwnedListing' | 'upsertDirectoryItem'>;
type FulfillSellerProductStateStore = ResolveSellerProductStateStore & Pick<ProductStateStore, 'claimSellerOrderFulfillment'>;
export interface ResolveSellerProductOrderInput {
    productOrderPinId: string;
    orderTxid?: string | null;
    buyer?: ProductFulfillmentBuyerIdentity | null;
    localSeller: ProductSellerIdentity;
    productStateStore: ResolveSellerProductStateStore;
    chainFetcher: ProductFulfillmentChainFetcher;
    now?: () => number;
}
export interface ResolvedProductOrderReference {
    source: 'cache' | 'chain';
    pinId: string;
    pin: ProductFulfillmentPinMetadata;
    payload: ProductOrderPayload;
    buyerGlobalMetaId: string | null;
    orderTxid: string | null;
    record: ProductSellerOrderRecord | null;
}
export interface ResolvedProductListingReference {
    source: 'cache' | 'chain';
    pinId: string;
    pin: ProductFulfillmentPinMetadata;
    payload: ProductListingPayload;
    sellerGlobalMetaId: string | null;
    sellerMvcAddress: string | null;
    record: OwnedProductListingRecord | ProductDirectoryCacheRecord | null;
}
export interface ResolvedSellerProductOrder {
    ok: true;
    order: ResolvedProductOrderReference;
    listing: ResolvedProductListingReference;
    selectedSku: ProductSku;
}
export type ResolveSellerProductOrderResult = ResolvedSellerProductOrder | ProductFulfillmentFailure;
export interface ProductPaymentVerifierInput {
    paymentTxid: string;
    paymentChain: 'mvc' | 'btc';
    settlementKind: 'native';
    paymentAddress: string;
    amount: string;
    currency: string;
}
export type ProductPaymentVerifier = (input: ProductPaymentVerifierInput) => Promise<VerifiedServiceOrderPayment> | VerifiedServiceOrderPayment;
export interface ProductFulfillmentRuntimeContext {
    productOrder: {
        pinId: string;
        pin: ProductFulfillmentPinMetadata;
        payload: ProductOrderPayload;
        metadata: {
            buyerGlobalMetaId: string | null;
            orderTxid: string | null;
            source: 'cache' | 'chain';
        };
    };
    productListing: {
        pinId: string;
        pin: ProductFulfillmentPinMetadata;
        payload: ProductListingPayload;
        metadata: {
            sellerGlobalMetaId: string | null;
            sellerMvcAddress: string | null;
            source: 'cache' | 'chain';
        };
    };
    selectedSku: ProductSku;
    buyer: ProductFulfillmentBuyerIdentity;
    orderA2AMetadata: ProductOrderA2AMetadata;
    payment: VerifiedServiceOrderPayment;
    fulfillmentSkills: string[];
}
export interface ProductFulfillmentRoundInput {
    fulfillmentSkills: string[];
    context: ProductFulfillmentRuntimeContext;
}
export type ProductFulfillmentRoundResult = {
    state: 'completed';
    responseText: string;
    metadata?: Record<string, unknown> | null;
} | {
    state: 'failed';
    code: string;
    message: string;
    metadata?: Record<string, unknown> | null;
} | {
    state: 'needs_clarification';
    question: string;
    metadata?: Record<string, unknown> | null;
};
export interface ProductFulfillmentRunner {
    execute(input: ProductFulfillmentRoundInput): Promise<ProductFulfillmentRoundResult> | ProductFulfillmentRoundResult;
}
export interface ProductDeliverySendInput {
    toGlobalMetaId: string;
    orderTxid: string;
    productOrderPinId: string;
    content: string;
}
export interface ProductDeliverySendResult {
    pinId?: string | null;
    txids?: string[] | null;
}
export interface ProductDeliverySender {
    send(input: ProductDeliverySendInput): Promise<ProductDeliverySendResult> | ProductDeliverySendResult;
}
export interface FulfillProductOrderForSellerInput extends ResolveSellerProductOrderInput {
    productStateStore: FulfillSellerProductStateStore;
    orderTxid: string;
    buyer: ProductFulfillmentBuyerIdentity;
    orderA2AMetadata?: ProductOrderA2AMetadata | null;
    paymentVerifier: ProductPaymentVerifier;
    fulfillmentRunner: ProductFulfillmentRunner | ((input: ProductFulfillmentRoundInput) => Promise<ProductFulfillmentRoundResult> | ProductFulfillmentRoundResult);
    deliverySender: ProductDeliverySender;
    requestRating?: boolean;
}
export interface FulfillProductOrderForSellerSuccess {
    ok: true;
    duplicate: boolean;
    delivered: boolean;
    pending: boolean;
    data: {
        productOrderPinId: string;
        listingPinId: string;
        skuId: string;
        paymentTxid: string;
        orderTxid: string;
        result: string;
        deliveryPinId: string | null;
        ratingMessagePinId: string | null;
        fulfillmentState: 'fulfilling' | 'delivered';
    };
}
export type FulfillProductOrderForSellerResult = FulfillProductOrderForSellerSuccess | ProductFulfillmentFailure;
export interface ProductFulfillmentPinMetadata {
    pinId: string;
    path: string;
    creatorGlobalMetaId: string | null;
    creatorAddress: string | null;
    timestamp: number | null;
}
export declare function createProductServicePaymentVerifier(input: {
    adapters: ChainAdapterRegistry;
}): ProductPaymentVerifier;
export declare function resolveProductOrderForSeller(input: ResolveSellerProductOrderInput): Promise<ResolveSellerProductOrderResult>;
export declare function fulfillProductOrderForSeller(input: FulfillProductOrderForSellerInput): Promise<FulfillProductOrderForSellerResult>;
export {};
