import type { ChainWriteResult } from '../chain/writePin';
import type { Signer } from '../signing/signer';
import type { A2AOrderPaymentResult } from '../payments/servicePayment';
import type { ProductDirectoryProduct } from './productDirectory';
import { type ProductPurchasePlannerInput, type ProductPurchasePlannerRequest, type ProductPurchasePlannerResult } from './productPurchasePlanner';
import type { ProductStateStore } from './productStateStore';
import type { ProductListingPayload, ProductOrderPayload } from './productTypes';
export declare const PRODUCT_LISTING_PROTOCOL_PATH = "/protocols/product-listing";
export declare const PRODUCT_ORDER_PROTOCOL_PATH = "/protocols/product-order";
export interface ProductListingChainWriteInput {
    signer: Pick<Signer, 'writePin'>;
    payload: ProductListingPayload;
    network?: string;
}
export interface ProductOrderChainWriteInput {
    signer: Pick<Signer, 'writePin'>;
    payload: ProductOrderPayload;
    network?: string;
}
export interface ProductChainWriteResult {
    payload: ProductListingPayload | ProductOrderPayload;
    chainWrite: ChainWriteResult;
}
export interface ProductPaymentExecutionInput {
    listingPinId: string;
    skuId: string;
    sellerGlobalMetaId: string;
    toAddress: string;
    amount: string;
    currency: 'SPACE' | 'MVC' | 'BTC';
    paymentChain: 'mvc' | 'btc';
    settlementKind: 'native';
    traceId?: string | null;
}
export interface ProductPaymentExecutor {
    execute(input: ProductPaymentExecutionInput): Promise<A2AOrderPaymentResult>;
}
export interface ProductOrderPublishInput {
    payload: ProductOrderPayload;
    network?: string;
}
export interface ProductOrderPublisher {
    publish(input: ProductOrderPublishInput): Promise<ProductChainWriteResult>;
}
export interface ProductSimplemsgSendInput {
    toGlobalMetaId: string;
    productOrderPinId: string;
    listingPinId: string;
    skuId: string;
    paymentTxid: string;
    content: string;
}
export interface ProductSimplemsgSendResult {
    orderTxid?: string | null;
    txids?: string[] | null;
    pinId?: string | null;
}
export interface ProductSimplemsgSender {
    send(input: ProductSimplemsgSendInput): Promise<ProductSimplemsgSendResult>;
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
export interface ExecuteProductPurchaseInput {
    request: ProductPurchasePlannerRequest;
    products: ProductDirectoryProduct[];
    buyerIdentity: {
        globalMetaId?: string | null;
        name?: string | null;
    };
    resolveSellerIdentity: (input: {
        product: ProductDirectoryProduct;
        plan: Extract<ProductPurchasePlannerResult, {
            ok: true;
        }>;
    }) => Promise<ProductSellerIdentity | null> | ProductSellerIdentity | null;
    paymentExecutor: ProductPaymentExecutor;
    productOrderPublisher: ProductOrderPublisher;
    simplemsgSender: ProductSimplemsgSender;
    productStateStore: Pick<ProductStateStore, 'upsertBuyerOrder'>;
    planner?: (input: ProductPurchasePlannerInput) => ProductPurchasePlannerResult;
    traceId?: string | null;
    sessionId?: string | null;
    localUiUrl?: string | null;
    network?: string | null;
}
export type ExecuteProductPurchaseResult = {
    ok: true;
    data: {
        traceId: string;
        sessionId: string | null;
        productOrderPinId: string;
        paymentTxid: string;
        orderTxid: string;
        localUiUrl?: string;
        product: Extract<ProductPurchasePlannerResult, {
            ok: true;
        }>['product'];
        sku: Extract<ProductPurchasePlannerResult, {
            ok: true;
        }>['sku'];
        seller: Extract<ProductPurchasePlannerResult, {
            ok: true;
        }>['seller'];
        payment: Extract<ProductPurchasePlannerResult, {
            ok: true;
        }>['payment'];
    };
} | {
    ok: false;
    code: string;
    message: string;
    state?: ProductPurchasePlannerResult extends infer T ? T extends {
        ok: false;
        state: infer S;
    } ? S : never : never;
    data?: Record<string, unknown>;
};
export declare function buildProductListingChainWrite(input: {
    payload: ProductListingPayload;
    network?: string;
}): {
    operation: string;
    path: string;
    payload: string;
    contentType: string;
    network: string;
};
export declare function buildProductOrderChainWrite(input: {
    payload: ProductOrderPayload;
    network?: string;
}): {
    operation: string;
    path: string;
    payload: string;
    contentType: string;
    network: string;
};
export declare function publishProductListingToChain(input: ProductListingChainWriteInput): Promise<ProductChainWriteResult>;
export declare function publishProductOrderToChain(input: ProductOrderChainWriteInput): Promise<ProductChainWriteResult>;
export declare function executeProductPurchase(input: ExecuteProductPurchaseInput): Promise<ExecuteProductPurchaseResult>;
