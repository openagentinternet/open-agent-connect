import type { DelegationPolicyDecision } from '../a2a/sessionTypes';
import type { ProductDirectoryProduct } from './productDirectory';
import type { ProductPrice } from './productTypes';
export interface ProductPurchasePlannerRequest {
    query?: string;
    listingPinId?: string;
    skuId?: string;
    comment?: string;
    spendCap?: {
        amount?: unknown;
        currency?: unknown;
    } | null;
    policyMode?: unknown;
    confirmed?: boolean;
}
export interface ProductPurchasePlannerInput {
    request: ProductPurchasePlannerRequest;
    products: ProductDirectoryProduct[];
}
export type ProductPurchasePlannerResult = {
    ok: true;
    state: 'ready' | 'awaiting_confirmation';
    code: 'product_purchase_ready' | 'product_purchase_awaiting_confirmation';
    product: {
        listingPinId: string;
        title: string;
    };
    sku: {
        skuId: string;
        name: string;
    };
    seller: {
        globalMetaId: string | null;
        name: string | null;
    };
    payment: ProductPrice;
    confirmation: DelegationPolicyDecision;
    confirmRequest?: {
        request: {
            query?: string;
            listingPinId: string;
            skuId: string;
            comment?: string;
            spendCap?: {
                amount?: unknown;
                currency?: unknown;
            } | null;
            policyMode: DelegationPolicyDecision['policyMode'];
            confirmed: true;
        };
    };
} | {
    ok: false;
    state: 'blocked' | 'offline' | 'not_found';
    code: string;
    message: string;
    confirmation?: DelegationPolicyDecision;
};
export declare function planProductPurchase(input: ProductPurchasePlannerInput): ProductPurchasePlannerResult;
