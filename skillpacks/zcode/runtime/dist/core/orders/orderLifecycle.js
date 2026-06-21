"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVICE_ORDER_SELF_REFUND_SKIPPED_REASON = exports.SERVICE_ORDER_FREE_REFUND_SKIPPED_REASON = exports.DEFAULT_REFUND_REQUEST_RETRY_DELAY_MS = exports.SERVICE_ORDER_SELF_ORDER_NOT_ALLOWED_ERROR_CODE = exports.SERVICE_ORDER_OPEN_ORDER_EXISTS_ERROR_CODE = void 0;
exports.buildBuyerPaymentKey = buildBuyerPaymentKey;
exports.isSelfDirectedPair = isSelfDirectedPair;
exports.SERVICE_ORDER_OPEN_ORDER_EXISTS_ERROR_CODE = 'open_order_exists';
exports.SERVICE_ORDER_SELF_ORDER_NOT_ALLOWED_ERROR_CODE = 'self_order_not_allowed';
exports.DEFAULT_REFUND_REQUEST_RETRY_DELAY_MS = 60_000;
exports.SERVICE_ORDER_FREE_REFUND_SKIPPED_REASON = 'free_order_no_refund_required';
exports.SERVICE_ORDER_SELF_REFUND_SKIPPED_REASON = 'self_directed_order_no_external_refund_required';
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function buildBuyerPaymentKey(localMetabotId, counterpartyGlobalMetaId, paymentTxid) {
    const normalizedTxid = normalizeText(paymentTxid);
    if (!normalizedTxid)
        return null;
    return `${localMetabotId}:${normalizeText(counterpartyGlobalMetaId)}:${normalizedTxid}`;
}
function isSelfDirectedPair(input) {
    const local = normalizeText(input.localGlobalMetaId);
    const counterparty = normalizeText(input.counterpartyGlobalMetaId);
    return Boolean(local && counterparty && local === counterparty);
}
