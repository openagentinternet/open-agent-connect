import type { RuntimeState } from '../state/runtimeStateStore';
import { type SellerOrderRecord } from './sellerOrderState';
export declare const SERVICE_REFUND_REQUEST_PATH = "/protocols/service-refund-request";
export declare const SERVICE_REFUND_FINALIZE_PATH = "/protocols/service-refund-finalize";
export interface RefundRequestPinDetail {
    pinId: string;
    path?: string | null;
    content: unknown;
}
export interface RefundTransferInput {
    order: SellerOrderRecord;
    refundRequestPinId: string;
    refundRequestPayload: Record<string, unknown>;
    refundToAddress: string;
    refundAmount: string;
    refundCurrency: string;
    paymentChain: string;
    settlementKind: string;
}
export interface RefundTransferResult {
    success?: boolean;
    txid?: string | null;
    txId?: string | null;
    error?: string | null;
    totalCost?: number | null;
    network?: string | null;
}
export interface RefundFinalizeWriteResult {
    pinId?: string | null;
    txid?: string | null;
    txids?: string[] | null;
}
export interface ProcessSellerRefundSettlementInput {
    state: RuntimeState;
    orderId: string;
    fetchRefundRequestPin: (pinId: string) => Promise<RefundRequestPinDetail>;
    executeRefundTransfer: (input: RefundTransferInput) => Promise<RefundTransferResult>;
    persistSettlementState?: (state: RuntimeState) => Promise<void>;
    writeRefundFinalizePin: (input: {
        order: SellerOrderRecord;
        payload: Record<string, unknown>;
        refundRequestPayload: Record<string, unknown>;
    }) => Promise<RefundFinalizeWriteResult>;
    resolveLocalSellerGlobalMetaId?: (order: SellerOrderRecord) => string | null | undefined;
    now?: () => number;
}
export interface SellerRefundSettlementSuccess {
    ok: true;
    state: 'refunded';
    orderId: string;
    paymentTxid: string | null;
    refundTxid: string | null;
    refundFinalizePinId: string | null;
    noTransferReason: string | null;
    finalizePayload: Record<string, unknown> | null;
    order: SellerOrderRecord;
    nextState: RuntimeState;
}
export interface SellerRefundSettlementBlocked {
    ok: false;
    state: 'manual_action_required';
    code: string;
    message: string;
    blockingReason: string;
    orderId: string | null;
    paymentTxid: string | null;
    order: SellerOrderRecord | null;
    nextState: RuntimeState;
}
export type SellerRefundSettlementResult = SellerRefundSettlementSuccess | SellerRefundSettlementBlocked;
export declare function parseRefundProtocolContent(content: unknown): Record<string, unknown> | null;
export declare function processSellerRefundSettlement(input: ProcessSellerRefundSettlementInput): Promise<SellerRefundSettlementResult>;
