import type { RuntimeState } from '../state/runtimeStateStore';
import type { SellerOrderRecord } from '../orders/sellerOrderState';
export interface SellerOrderSelector {
    orderId?: string | null;
    paymentTxid?: string | null;
}
export interface ProviderSellerOrderInspection {
    orderId: string;
    service: {
        name: string | null;
        servicePinId: string | null;
        currentServicePinId: string | null;
        providerSkill: string | null;
    };
    buyer: {
        globalMetaId: string | null;
        name: string | null;
    };
    status: {
        state: string | null;
        publicStatus: string | null;
        latestEvent: string | null;
        failureReason: string | null;
    };
    trace: {
        id: string | null;
        href: string | null;
    };
    payment: {
        txid: string | null;
        commitTxid: string | null;
        amount: string | null;
        currency: string | null;
        chain: string | null;
        settlementKind: string | null;
    };
    runtime: {
        runtimeId: string | null;
        provider: string | null;
        sessionId: string | null;
        fallbackSelected: boolean | null;
        a2aSessionId: string | null;
        a2aTaskRunId: string | null;
    };
    refund: {
        refundRequestPinId: string | null;
        refundRequestTxid: string | null;
        refundTxid: string | null;
        refundFinalizePinId: string | null;
        blockingReason: string | null;
        refundedAt: number | null;
        completedAt: number | null;
        manualActionRequired: boolean;
    };
    timestamps: {
        createdAt: number | null;
        updatedAt: number | null;
        receivedAt: number | null;
        acknowledgedAt: number | null;
        startedAt: number | null;
        deliveredAt: number | null;
        ratingRequestedAt: number | null;
    };
}
export interface SellerReceivedRefundItem {
    orderId: string;
    role: 'seller';
    serviceName: string;
    paymentTxid: string | null;
    paymentAmount: string | null;
    paymentCurrency: string | null;
    status: 'failed' | 'refund_pending' | 'refunded';
    failureReason: string | null;
    refundRequestPinId: string | null;
    refundRequestTxid: string | null;
    refundTxid: string | null;
    refundFinalizePinId: string | null;
    blockingReason: string | null;
    refundRequestedAt: number | null;
    refundCompletedAt: number | null;
    counterpartyGlobalMetaId: string | null;
    counterpartyName: string | null;
    traceId: string | null;
    traceHref: string | null;
    runtimeSessionId: string | null;
    manualActionRequired: boolean;
    createdAt: number;
    updatedAt: number;
}
export declare function sellerOrderRequiresManualAction(order: SellerOrderRecord): boolean;
export declare function findSellerOrdersBySelector(state: RuntimeState, selector: SellerOrderSelector): SellerOrderRecord[];
export declare function findSellerOrderBySelector(state: RuntimeState, selector: SellerOrderSelector): {
    status: 'missing_selector' | 'ambiguous_selector' | 'not_found' | 'ambiguous' | 'found';
    order: SellerOrderRecord | null;
    matches: SellerOrderRecord[];
};
export declare function buildProviderSellerOrderInspection(order: SellerOrderRecord): ProviderSellerOrderInspection;
export declare function buildSellerReceivedRefundItems(state: RuntimeState): SellerReceivedRefundItem[];
