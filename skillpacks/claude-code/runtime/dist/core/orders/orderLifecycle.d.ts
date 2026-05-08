export declare const SERVICE_ORDER_OPEN_ORDER_EXISTS_ERROR_CODE = "open_order_exists";
export declare const SERVICE_ORDER_SELF_ORDER_NOT_ALLOWED_ERROR_CODE = "self_order_not_allowed";
export declare const DEFAULT_REFUND_REQUEST_RETRY_DELAY_MS = 60000;
export declare const SERVICE_ORDER_FREE_REFUND_SKIPPED_REASON = "free_order_no_refund_required";
export declare const SERVICE_ORDER_SELF_REFUND_SKIPPED_REASON = "self_directed_order_no_external_refund_required";
export declare function buildBuyerPaymentKey(localMetabotId: number, counterpartyGlobalMetaId: string, paymentTxid?: string | null): string | null;
export declare function isSelfDirectedPair(input: {
    localGlobalMetaId?: string | null;
    counterpartyGlobalMetaId?: string | null;
}): boolean;
