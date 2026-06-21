"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveManualRefundDecision = resolveManualRefundDecision;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function resolveManualRefundDecision(order) {
    if (order
        && order.role === 'seller'
        && normalizeText(order.status) === 'refund_pending'
        && normalizeText(order.refundRequestPinId)) {
        return {
            required: true,
            state: 'manual_action_required',
            code: 'manual_refund_required',
            message: 'Seller refund requires manual confirmation.',
            ui: {
                kind: 'refund',
                orderId: normalizeText(order.id),
                sessionId: normalizeText(order.coworkSessionId) || null,
                refundRequestPinId: normalizeText(order.refundRequestPinId),
            },
        };
    }
    return {
        required: false,
        state: 'not_required',
        code: 'refund_not_required',
        message: 'Manual refund is not required.',
    };
}
