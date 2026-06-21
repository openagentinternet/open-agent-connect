export declare const SERVICE_REFUND_REQUEST_PATH = "/protocols/service-refund-request";
export declare const SERVICE_REFUND_FINALIZE_PATH = "/protocols/service-refund-finalize";
export interface ServiceRefundRequestPayload {
    version: 1;
    serviceOrderPinId: string;
    servicePinId?: string;
    paymentTxid?: string;
    paymentAmount?: string;
    paymentAsset?: string;
    paymentChain?: string;
    settlementKind?: string;
    mrc20Ticker?: string;
    mrc20Id?: string;
    buyerGlobalMetaId?: string;
    sellerGlobalMetaId?: string;
    refundAddress?: string;
    reason: string;
    requestedAt: string;
}
export interface ServiceRefundFinalizePayload {
    version: 1;
    refundRequestPinId: string;
    servicePinId?: string;
    paymentTxid?: string;
    refundTxid?: string;
    paymentAmount?: string;
    paymentAsset?: string;
    buyerGlobalMetaId?: string;
    sellerGlobalMetaId?: string;
}
export interface ParsedServiceRefundRequest {
    pinId: string;
    path: string;
    payload: ServiceRefundRequestPayload;
}
export interface ParsedServiceRefundFinalize {
    pinId: string;
    path: string;
    payload: ServiceRefundFinalizePayload;
}
export declare function parseRefundProtocolContent(content: unknown): Record<string, unknown> | null;
export declare function buildServiceRefundRequestPayload(input: ServiceRefundRequestPayload): ServiceRefundRequestPayload;
export declare function parseServiceRefundRequestPin(pin: unknown): ParsedServiceRefundRequest | null;
export declare function parseServiceRefundFinalizePin(pin: unknown): ParsedServiceRefundFinalize | null;
