"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectDueBuyerRefundRequests = selectDueBuyerRefundRequests;
exports.runBuyerRefundRequestLifecycle = runBuyerRefundRequestLifecycle;
const orderLifecycle_1 = require("./orderLifecycle");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeTimestamp(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'string' && normalizeText(value) === '') {
        return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}
function normalizeRetryCount(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : 0;
}
function isZeroPaymentAmount(value) {
    const text = normalizeText(value);
    if (!text) {
        return false;
    }
    const numeric = Number(text);
    return Number.isFinite(numeric) && numeric === 0;
}
function isNonFreeBuyerRefundTrace(trace) {
    const order = trace.order;
    if (!order) {
        return false;
    }
    return !isZeroPaymentAmount(order.paymentAmount);
}
function isSelfDirectedBuyerTrace(input) {
    const trace = input.trace;
    if ((0, orderLifecycle_1.isSelfDirectedPair)({
        localGlobalMetaId: input.localGlobalMetaId,
        counterpartyGlobalMetaId: normalizeText(trace.a2a?.providerGlobalMetaId)
            || normalizeText(trace.session.peerGlobalMetaId),
    })) {
        return true;
    }
    return (0, orderLifecycle_1.isSelfDirectedPair)({
        localGlobalMetaId: trace.a2a?.callerGlobalMetaId,
        counterpartyGlobalMetaId: trace.a2a?.providerGlobalMetaId,
    });
}
function isDueRetry(order, nowMs) {
    const nextRetryAt = normalizeTimestamp(order.nextRetryAt);
    return nextRetryAt === null || nextRetryAt <= nowMs;
}
function readFailureReason(trace) {
    return normalizeText(trace.order?.failureReason) || 'delivery_timeout';
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error ?? 'Unknown refund request writer error.');
}
function resultTraceFromWriteResult(result) {
    return result && result.trace ? result.trace : null;
}
function writeResultIsPending(result) {
    const trace = resultTraceFromWriteResult(result);
    const status = normalizeText(result?.status) || normalizeText(trace?.order?.status);
    const refundRequestPinId = normalizeText(result?.refundRequestPinId)
        || normalizeText(trace?.order?.refundRequestPinId);
    return status === 'refund_pending' || Boolean(refundRequestPinId);
}
function retryFailureForTrace(input) {
    return {
        traceId: input.trace.traceId,
        error: input.error,
        retryCount: normalizeRetryCount(input.trace.order?.refundApplyRetryCount) + 1,
        nextRetryAt: input.nowMs + orderLifecycle_1.DEFAULT_REFUND_REQUEST_RETRY_DELAY_MS,
    };
}
function persistedFailureForTrace(input) {
    const persistedRetryCount = normalizeRetryCount(input.trace.order?.refundApplyRetryCount);
    const persistedNextRetryAt = normalizeTimestamp(input.trace.order?.nextRetryAt);
    const synthesized = retryFailureForTrace({
        trace: input.fallbackTrace,
        nowMs: input.nowMs,
        error: input.error,
    });
    return {
        traceId: input.trace.traceId,
        error: input.error,
        retryCount: persistedRetryCount || synthesized.retryCount,
        nextRetryAt: persistedNextRetryAt ?? synthesized.nextRetryAt,
    };
}
function selectDueBuyerRefundRequests(input) {
    return input.traces.filter((trace) => {
        const order = trace.order;
        if (!order || normalizeText(order.role) !== 'buyer') {
            return false;
        }
        const status = normalizeText(order.status);
        if (status !== 'failed') {
            return false;
        }
        if (normalizeText(order.refundRequestPinId)) {
            return false;
        }
        if (!isNonFreeBuyerRefundTrace(trace)) {
            return false;
        }
        if (isSelfDirectedBuyerTrace({
            trace,
            localGlobalMetaId: input.localGlobalMetaId,
        })) {
            return false;
        }
        return isDueRetry(order, input.nowMs);
    });
}
async function runBuyerRefundRequestLifecycle(input) {
    const selected = selectDueBuyerRefundRequests(input);
    const failures = [];
    let succeeded = 0;
    for (const trace of selected) {
        try {
            const result = await input.writer.writeRefundRequest(trace.traceId, {
                trace,
                failureReason: readFailureReason(trace),
                nowMs: input.nowMs,
            });
            if (writeResultIsPending(result)) {
                succeeded += 1;
            }
            else {
                const resultTrace = resultTraceFromWriteResult(result);
                failures.push(persistedFailureForTrace({
                    trace: resultTrace ?? trace,
                    fallbackTrace: trace,
                    nowMs: input.nowMs,
                    error: readFailureReason(resultTrace ?? trace),
                }));
            }
        }
        catch (error) {
            failures.push(retryFailureForTrace({
                trace,
                nowMs: input.nowMs,
                error: errorMessage(error),
            }));
        }
    }
    return {
        attempted: selected.length,
        succeeded,
        failed: failures.length,
        selectedTraceIds: selected.map((trace) => trace.traceId),
        failures,
    };
}
