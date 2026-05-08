"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SELLER_ORDER_STATES = void 0;
exports.isSellerOrderState = isSellerOrderState;
exports.createSellerOrderRecord = createSellerOrderRecord;
exports.transitionSellerOrderRecord = transitionSellerOrderRecord;
exports.upsertSellerOrderRecord = upsertSellerOrderRecord;
exports.SELLER_ORDER_STATES = [
    'received',
    'acknowledged',
    'in_progress',
    'completed',
    'rating_pending',
    'failed',
    'refund_pending',
    'refunded',
    'ended',
];
const ALLOWED_TRANSITIONS = {
    received: ['received', 'acknowledged', 'in_progress', 'failed', 'refund_pending', 'ended'],
    acknowledged: ['acknowledged', 'in_progress', 'failed', 'refund_pending', 'ended'],
    in_progress: ['in_progress', 'completed', 'rating_pending', 'failed', 'refund_pending', 'ended'],
    completed: ['completed', 'rating_pending', 'refund_pending', 'ended'],
    rating_pending: ['rating_pending', 'completed', 'refund_pending', 'ended'],
    failed: ['failed', 'refund_pending', 'ended'],
    refund_pending: ['refund_pending', 'refunded', 'ended'],
    refunded: ['refunded', 'ended'],
    ended: ['ended', 'refunded'],
};
function normalizeText(value) {
    if (typeof value === 'string')
        return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    return '';
}
function normalizeNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}
function normalizeBoolean(value) {
    return typeof value === 'boolean' ? value : null;
}
function isSellerOrderState(value) {
    return exports.SELLER_ORDER_STATES.includes(normalizeText(value));
}
function createSellerOrderRecord(input) {
    const state = isSellerOrderState(input.state) ? input.state : 'received';
    const createdAt = normalizeNumber(input.createdAt) ?? Date.now();
    const updatedAt = normalizeNumber(input.updatedAt) ?? createdAt;
    return {
        id: normalizeText(input.id),
        state,
        localMetabotId: normalizeNumber(input.localMetabotId) ?? 0,
        localMetabotSlug: normalizeText(input.localMetabotSlug),
        providerGlobalMetaId: normalizeText(input.providerGlobalMetaId),
        buyerGlobalMetaId: normalizeText(input.buyerGlobalMetaId),
        servicePinId: normalizeText(input.servicePinId),
        currentServicePinId: normalizeText(input.currentServicePinId) || normalizeText(input.servicePinId),
        serviceName: normalizeText(input.serviceName),
        providerSkill: normalizeText(input.providerSkill),
        orderMessageId: normalizeText(input.orderMessageId),
        orderPinId: normalizeText(input.orderPinId) || null,
        orderTxid: normalizeText(input.orderTxid) || null,
        orderReference: normalizeText(input.orderReference) || null,
        paymentTxid: normalizeText(input.paymentTxid) || null,
        paymentCommitTxid: normalizeText(input.paymentCommitTxid) || null,
        paymentAmount: normalizeText(input.paymentAmount) || null,
        paymentCurrency: normalizeText(input.paymentCurrency) || null,
        paymentChain: normalizeText(input.paymentChain) || null,
        settlementKind: normalizeText(input.settlementKind) || null,
        mrc20Ticker: normalizeText(input.mrc20Ticker) || null,
        mrc20Id: normalizeText(input.mrc20Id) || null,
        traceId: normalizeText(input.traceId),
        a2aSessionId: normalizeText(input.a2aSessionId),
        a2aTaskRunId: normalizeText(input.a2aTaskRunId) || null,
        llmSessionId: normalizeText(input.llmSessionId) || null,
        runtimeId: normalizeText(input.runtimeId) || null,
        runtimeProvider: normalizeText(input.runtimeProvider) || null,
        fallbackSelected: normalizeBoolean(input.fallbackSelected),
        publicStatus: normalizeText(input.publicStatus) || null,
        latestEvent: normalizeText(input.latestEvent) || null,
        failureReason: normalizeText(input.failureReason) || null,
        endReason: normalizeText(input.endReason) || null,
        refundRequestPinId: normalizeText(input.refundRequestPinId) || null,
        refundRequestTxid: normalizeText(input.refundRequestTxid) || null,
        refundTxid: normalizeText(input.refundTxid) || null,
        refundFinalizePinId: normalizeText(input.refundFinalizePinId) || null,
        refundBlockingReason: normalizeText(input.refundBlockingReason) || null,
        receivedAt: normalizeNumber(input.receivedAt) ?? (state === 'received' ? createdAt : null),
        acknowledgedAt: normalizeNumber(input.acknowledgedAt),
        startedAt: normalizeNumber(input.startedAt),
        deliveredAt: normalizeNumber(input.deliveredAt),
        ratingRequestedAt: normalizeNumber(input.ratingRequestedAt),
        endedAt: normalizeNumber(input.endedAt),
        refundedAt: normalizeNumber(input.refundedAt),
        refundCompletedAt: normalizeNumber(input.refundCompletedAt) ?? normalizeNumber(input.refundedAt),
        createdAt,
        updatedAt,
    };
}
function transitionSellerOrderRecord(current, patch) {
    const nextState = patch.state;
    if (!ALLOWED_TRANSITIONS[current.state]?.includes(nextState)) {
        throw new Error(`Invalid seller order state transition: ${current.state} -> ${nextState}`);
    }
    return createSellerOrderRecord({
        ...current,
        ...patch,
        state: nextState,
        createdAt: current.createdAt,
        updatedAt: patch.updatedAt,
        receivedAt: patch.receivedAt ?? current.receivedAt,
        acknowledgedAt: patch.acknowledgedAt ?? current.acknowledgedAt,
        startedAt: patch.startedAt ?? current.startedAt,
        deliveredAt: patch.deliveredAt ?? current.deliveredAt,
        ratingRequestedAt: patch.ratingRequestedAt ?? current.ratingRequestedAt,
        endedAt: patch.endedAt ?? current.endedAt,
        refundedAt: patch.refundedAt ?? current.refundedAt,
        refundCompletedAt: patch.refundCompletedAt ?? current.refundCompletedAt,
    });
}
function upsertSellerOrderRecord(records, next) {
    const index = records.findIndex((entry) => entry.id === next.id);
    if (index < 0) {
        return [next, ...records];
    }
    const updated = transitionSellerOrderRecord(records[index], next);
    return [
        updated,
        ...records.slice(0, index),
        ...records.slice(index + 1),
    ];
}
