"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVICE_REFUND_FINALIZE_PATH = exports.SERVICE_REFUND_REQUEST_PATH = void 0;
exports.parseRefundProtocolContent = parseRefundProtocolContent;
exports.processSellerRefundSettlement = processSellerRefundSettlement;
const sellerOrderState_1 = require("./sellerOrderState");
const orderLifecycle_1 = require("./orderLifecycle");
exports.SERVICE_REFUND_REQUEST_PATH = '/protocols/service-refund-request';
exports.SERVICE_REFUND_FINALIZE_PATH = '/protocols/service-refund-finalize';
function normalizeText(value) {
    if (typeof value === 'string')
        return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    return '';
}
function normalizeLower(value) {
    return normalizeText(value).toLowerCase();
}
function readObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function parseJsonObject(value) {
    try {
        return readObject(JSON.parse(value));
    }
    catch {
        return null;
    }
}
function parseRefundProtocolContent(content) {
    if (typeof content === 'string') {
        return parseJsonObject(content);
    }
    const object = readObject(content);
    if (!object) {
        return null;
    }
    const data = readObject(object.data);
    const summary = object.contentSummary ?? data?.contentSummary ?? object.content;
    if (typeof summary === 'string') {
        return parseJsonObject(summary);
    }
    if (readObject(summary)) {
        return summary;
    }
    return object;
}
function canonicalCurrency(value) {
    const normalized = normalizeText(value).toUpperCase();
    return normalized === 'MVC' ? 'SPACE' : normalized;
}
function canonicalChain(value, currency) {
    const chain = normalizeLower(value);
    if (chain) {
        return chain;
    }
    const currencyText = canonicalCurrency(currency);
    if (currencyText === 'BTC')
        return 'btc';
    if (currencyText === 'DOGE')
        return 'doge';
    return 'mvc';
}
function canonicalSettlementKind(value, amount) {
    const settlementKind = normalizeLower(value);
    if (settlementKind) {
        return settlementKind;
    }
    return isZeroAmount(amount) ? 'free' : 'native';
}
function canonicalAmount(value) {
    const text = normalizeText(value);
    if (!text) {
        return '';
    }
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) {
        return text;
    }
    return numeric.toFixed(8).replace(/\.?0+$/, '');
}
function isZeroAmount(value) {
    const numeric = Number(normalizeText(value));
    return Number.isFinite(numeric) && numeric === 0;
}
function readRefundAmount(payload) {
    return normalizeText(payload.refundAmount) || normalizeText(payload.amount);
}
function readRefundCurrency(payload) {
    return normalizeText(payload.refundCurrency) || normalizeText(payload.currency);
}
function matchesPaymentKey(order, candidate) {
    const paymentTxid = normalizeText(order.paymentTxid);
    if (paymentTxid) {
        return normalizeText(candidate.paymentTxid) === paymentTxid;
    }
    const orderReference = normalizeText(order.orderReference);
    if (orderReference) {
        return normalizeText(candidate.orderReference) === orderReference;
    }
    return normalizeText(candidate.id) === normalizeText(order.id);
}
function findSellerOrder(state, orderId) {
    const normalizedOrderId = normalizeText(orderId);
    return state.sellerOrders.find((entry) => normalizeText(entry.id) === normalizedOrderId) ?? null;
}
function blockedSellerOrderState(entry) {
    if (entry.state === 'refunded' || entry.state === 'ended') {
        return entry.state;
    }
    if (entry.state === 'refund_pending' || normalizeText(entry.refundRequestPinId)) {
        return 'refund_pending';
    }
    return entry.state;
}
function blockSettlement(input) {
    const order = input.order;
    let nextState = input.state;
    if (order) {
        const patch = input.patch ?? {};
        nextState = {
            ...input.state,
            sellerOrders: input.state.sellerOrders.map((entry) => {
                if (!matchesPaymentKey(order, entry)) {
                    return entry;
                }
                return (0, sellerOrderState_1.transitionSellerOrderRecord)(entry, {
                    ...patch,
                    state: blockedSellerOrderState(entry),
                    failureReason: input.code,
                    refundBlockingReason: input.code,
                    latestEvent: 'refund_settlement_blocked',
                    updatedAt: input.now,
                });
            }),
            traces: input.state.traces.map((trace) => {
                const traceOrder = trace.order;
                if (!traceOrder || !matchesPaymentKey(order, traceOrder)) {
                    return trace;
                }
                return {
                    ...trace,
                    order: {
                        ...traceOrder,
                        status: traceOrder.status === 'refunded'
                            ? 'refunded'
                            : normalizeText(traceOrder.refundRequestPinId) || traceOrder.status === 'refund_pending'
                                ? 'refund_pending'
                                : traceOrder.status,
                        failureReason: input.code,
                        refundBlockingReason: input.code,
                        ...(normalizeText(patch.refundTxid) ? { refundTxid: normalizeText(patch.refundTxid) } : {}),
                        updatedAt: input.now,
                    },
                };
            }),
        };
    }
    return {
        ok: false,
        state: 'manual_action_required',
        code: input.code,
        message: input.message,
        blockingReason: input.code,
        orderId: order ? normalizeText(order.id) : null,
        paymentTxid: order ? normalizeText(order.paymentTxid) || null : null,
        order,
        nextState,
    };
}
function validatePayloadMatchesOrder(input) {
    const order = input.order;
    const payload = input.payload;
    const paymentTxid = normalizeText(order.paymentTxid);
    if (paymentTxid && normalizeText(payload.paymentTxid) !== paymentTxid) {
        return { ok: false, code: 'refund_request_payment_mismatch', message: 'Refund request payment txid does not match the seller order.' };
    }
    if (!paymentTxid && !isZeroAmount(order.paymentAmount)) {
        return { ok: false, code: 'refund_request_payment_missing', message: 'Paid seller refund order is missing a payment txid.' };
    }
    const payloadServicePinId = normalizeText(payload.servicePinId);
    const servicePins = new Set([
        normalizeText(order.servicePinId),
        normalizeText(order.currentServicePinId),
    ].filter(Boolean));
    if (!payloadServicePinId || !servicePins.has(payloadServicePinId)) {
        return { ok: false, code: 'refund_request_service_mismatch', message: 'Refund request service pin does not match the seller order.' };
    }
    if (normalizeText(payload.buyerGlobalMetaId) !== normalizeText(order.buyerGlobalMetaId)) {
        return { ok: false, code: 'refund_request_buyer_mismatch', message: 'Refund request buyer identity does not match the seller order.' };
    }
    const expectedSeller = normalizeText(input.localSellerGlobalMetaId) || normalizeText(order.providerGlobalMetaId);
    if (!expectedSeller || normalizeText(payload.sellerGlobalMetaId) !== expectedSeller) {
        return { ok: false, code: 'refund_request_seller_mismatch', message: 'Refund request seller identity does not match this local MetaBot.' };
    }
    if (canonicalAmount(readRefundAmount(payload)) !== canonicalAmount(order.paymentAmount)) {
        return { ok: false, code: 'refund_request_amount_mismatch', message: 'Refund request amount does not match the seller order.' };
    }
    if (canonicalCurrency(readRefundCurrency(payload)) !== canonicalCurrency(order.paymentCurrency)) {
        return { ok: false, code: 'refund_request_currency_mismatch', message: 'Refund request currency does not match the seller order.' };
    }
    if (canonicalChain(payload.paymentChain) !== canonicalChain(order.paymentChain, order.paymentCurrency)) {
        return { ok: false, code: 'refund_request_chain_mismatch', message: 'Refund request payment chain does not match the seller order.' };
    }
    if (canonicalSettlementKind(payload.settlementKind) !== canonicalSettlementKind(order.settlementKind, order.paymentAmount)) {
        return { ok: false, code: 'refund_request_settlement_mismatch', message: 'Refund request settlement kind does not match the seller order.' };
    }
    return { ok: true };
}
function buildRefundFinalizePayload(input) {
    return {
        version: '1.0.0',
        refundRequestPinId: input.refundRequestPinId,
        paymentTxid: normalizeText(input.order.paymentTxid),
        servicePinId: normalizeText(input.refundRequestPayload.servicePinId)
            || normalizeText(input.order.servicePinId)
            || normalizeText(input.order.currentServicePinId)
            || null,
        refundTxid: input.refundTxid,
        refundAmount: input.refundAmount,
        refundCurrency: input.refundCurrency,
        amount: input.refundAmount,
        currency: input.refundCurrency,
        paymentChain: input.paymentChain,
        settlementKind: input.settlementKind,
        mrc20Ticker: normalizeText(input.order.mrc20Ticker) || normalizeText(input.refundRequestPayload.mrc20Ticker) || null,
        mrc20Id: normalizeText(input.order.mrc20Id) || normalizeText(input.refundRequestPayload.mrc20Id) || null,
        paymentCommitTxid: normalizeText(input.order.paymentCommitTxid) || normalizeText(input.refundRequestPayload.paymentCommitTxid) || null,
        buyerGlobalMetaId: normalizeText(input.refundRequestPayload.buyerGlobalMetaId),
        sellerGlobalMetaId: normalizeText(input.refundRequestPayload.sellerGlobalMetaId),
        comment: '',
    };
}
function transitionToRefundPendingIfNeeded(order, updatedAt) {
    if (order.state === 'refund_pending' || order.state === 'refunded' || order.state === 'ended') {
        return order;
    }
    return (0, sellerOrderState_1.transitionSellerOrderRecord)(order, {
        state: 'refund_pending',
        updatedAt,
    });
}
function markStateRefunded(input) {
    return {
        ...input.state,
        sellerOrders: input.state.sellerOrders.map((entry) => {
            if (!matchesPaymentKey(input.order, entry)) {
                return entry;
            }
            const pending = transitionToRefundPendingIfNeeded(entry, input.completedAt);
            return (0, sellerOrderState_1.transitionSellerOrderRecord)(pending, {
                state: 'refunded',
                refundTxid: input.refundTxid,
                refundFinalizePinId: input.refundFinalizePinId,
                refundCompletedAt: input.completedAt,
                refundedAt: input.completedAt,
                failureReason: input.failureReason ?? pending.failureReason,
                refundBlockingReason: null,
                latestEvent: 'refund_finalized',
                updatedAt: input.completedAt,
            });
        }),
        traces: input.state.traces.map((trace) => {
            const traceOrder = trace.order;
            if (!traceOrder || !matchesPaymentKey(input.order, traceOrder)) {
                return trace;
            }
            return {
                ...trace,
                order: {
                    ...traceOrder,
                    status: 'refunded',
                    refundTxid: input.refundTxid,
                    refundFinalizePinId: input.refundFinalizePinId,
                    refundCompletedAt: input.completedAt,
                    refundedAt: input.completedAt,
                    failureReason: input.failureReason ?? traceOrder.failureReason,
                    refundBlockingReason: null,
                    updatedAt: input.completedAt,
                },
            };
        }),
    };
}
function recordRefundTransfer(input) {
    return {
        ...input.state,
        sellerOrders: input.state.sellerOrders.map((entry) => {
            if (!matchesPaymentKey(input.order, entry)) {
                return entry;
            }
            return (0, sellerOrderState_1.transitionSellerOrderRecord)(entry, {
                state: entry.state === 'refunded' || entry.state === 'ended' ? entry.state : 'refund_pending',
                refundTxid: input.refundTxid,
                updatedAt: input.recordedAt,
            });
        }),
        traces: input.state.traces.map((trace) => {
            const traceOrder = trace.order;
            if (!traceOrder || !matchesPaymentKey(input.order, traceOrder)) {
                return trace;
            }
            return {
                ...trace,
                order: {
                    ...traceOrder,
                    status: traceOrder.status === 'refunded' ? 'refunded' : 'refund_pending',
                    refundTxid: input.refundTxid,
                    updatedAt: input.recordedAt,
                },
            };
        }),
    };
}
function readFinalizePinId(result) {
    return normalizeText(result.pinId)
        || normalizeText(result.txid)
        || (Array.isArray(result.txids) ? normalizeText(result.txids[0]) : '');
}
function extractStructuredErrorCode(error, fallback) {
    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/^([a-z][a-z0-9_]*):/i);
    return match ? normalizeLower(match[1]) : fallback;
}
async function processSellerRefundSettlement(input) {
    const now = input.now ?? Date.now;
    const order = findSellerOrder(input.state, input.orderId);
    const attemptedAt = now();
    if (!order) {
        return blockSettlement({
            state: input.state,
            order: null,
            code: 'order_not_found',
            message: `Provider order was not found: ${normalizeText(input.orderId)}`,
            now: attemptedAt,
        });
    }
    if (order.state === 'refunded') {
        return {
            ok: true,
            state: 'refunded',
            orderId: order.id,
            paymentTxid: normalizeText(order.paymentTxid) || null,
            refundTxid: normalizeText(order.refundTxid) || null,
            refundFinalizePinId: normalizeText(order.refundFinalizePinId) || null,
            noTransferReason: null,
            finalizePayload: null,
            order,
            nextState: input.state,
        };
    }
    if (!normalizeText(order.refundRequestPinId)) {
        return blockSettlement({
            state: input.state,
            order,
            code: 'refund_request_missing',
            message: 'Seller refund settlement requires a refund request proof pin.',
            now: attemptedAt,
        });
    }
    if (order.state !== 'refund_pending' && order.state !== 'failed') {
        return blockSettlement({
            state: input.state,
            order,
            code: 'refund_not_required',
            message: 'Manual refund is not required.',
            now: attemptedAt,
        });
    }
    const refundRequestPinId = normalizeText(order.refundRequestPinId);
    let refundRequestDetail;
    try {
        refundRequestDetail = await input.fetchRefundRequestPin(refundRequestPinId);
    }
    catch (error) {
        return blockSettlement({
            state: input.state,
            order,
            code: 'refund_request_fetch_failed',
            message: error instanceof Error ? error.message : String(error),
            now: attemptedAt,
        });
    }
    if (normalizeText(refundRequestDetail.path) && normalizeText(refundRequestDetail.path) !== exports.SERVICE_REFUND_REQUEST_PATH) {
        return blockSettlement({
            state: input.state,
            order,
            code: 'refund_request_path_mismatch',
            message: 'Refund request pin is not a service-refund-request protocol record.',
            now: attemptedAt,
        });
    }
    const refundRequestPayload = parseRefundProtocolContent(refundRequestDetail.content);
    if (!refundRequestPayload) {
        return blockSettlement({
            state: input.state,
            order,
            code: 'refund_request_invalid',
            message: 'Refund request proof payload is invalid.',
            now: attemptedAt,
        });
    }
    const localSellerGlobalMetaId = normalizeText(input.resolveLocalSellerGlobalMetaId?.(order))
        || normalizeText(order.providerGlobalMetaId);
    const validation = validatePayloadMatchesOrder({
        order,
        payload: refundRequestPayload,
        localSellerGlobalMetaId,
    });
    if (!validation.ok) {
        return blockSettlement({
            state: input.state,
            order,
            code: validation.code,
            message: validation.message,
            now: attemptedAt,
        });
    }
    const refundAmount = readRefundAmount(refundRequestPayload) || normalizeText(order.paymentAmount);
    const refundCurrency = canonicalCurrency(readRefundCurrency(refundRequestPayload) || order.paymentCurrency);
    const paymentChain = canonicalChain(refundRequestPayload.paymentChain, order.paymentCurrency);
    const settlementKind = canonicalSettlementKind(refundRequestPayload.settlementKind, order.paymentAmount);
    if (isZeroAmount(refundAmount) || settlementKind === 'free') {
        const nextState = markStateRefunded({
            state: input.state,
            order,
            refundTxid: null,
            refundFinalizePinId: null,
            completedAt: attemptedAt,
            failureReason: orderLifecycle_1.SERVICE_ORDER_FREE_REFUND_SKIPPED_REASON,
        });
        const updatedOrder = findSellerOrder(nextState, order.id) ?? order;
        return {
            ok: true,
            state: 'refunded',
            orderId: order.id,
            paymentTxid: normalizeText(order.paymentTxid) || null,
            refundTxid: null,
            refundFinalizePinId: null,
            noTransferReason: orderLifecycle_1.SERVICE_ORDER_FREE_REFUND_SKIPPED_REASON,
            finalizePayload: null,
            order: updatedOrder,
            nextState,
        };
    }
    if (settlementKind !== 'native') {
        return blockSettlement({
            state: input.state,
            order,
            code: 'refund_settlement_unsupported',
            message: `Refund settlement kind is not supported: ${settlementKind}`,
            now: attemptedAt,
        });
    }
    const refundToAddress = normalizeText(refundRequestPayload.refundToAddress);
    if (!refundToAddress) {
        return blockSettlement({
            state: input.state,
            order,
            code: 'refund_address_missing',
            message: 'Refund request is missing the refund destination address.',
            now: attemptedAt,
        });
    }
    let nextState = input.state;
    let effectiveOrder = order;
    let refundTxid = normalizeText(order.refundTxid);
    if (!refundTxid) {
        let transferResult;
        try {
            transferResult = await input.executeRefundTransfer({
                order,
                refundRequestPinId,
                refundRequestPayload,
                refundToAddress,
                refundAmount,
                refundCurrency,
                paymentChain,
                settlementKind,
            });
        }
        catch (error) {
            const code = extractStructuredErrorCode(error, 'refund_transfer_failed');
            return blockSettlement({
                state: input.state,
                order,
                code,
                message: error instanceof Error ? error.message : String(error),
                now: attemptedAt,
            });
        }
        if (transferResult.success === false) {
            const transferError = normalizeText(transferResult.error) || 'Refund transfer failed.';
            return blockSettlement({
                state: input.state,
                order,
                code: extractStructuredErrorCode(transferError, 'refund_transfer_failed'),
                message: transferError,
                now: attemptedAt,
            });
        }
        refundTxid = normalizeText(transferResult.txid) || normalizeText(transferResult.txId);
        if (!refundTxid) {
            return blockSettlement({
                state: input.state,
                order,
                code: 'refund_transfer_txid_missing',
                message: 'Refund transfer did not return a transaction id.',
                now: attemptedAt,
            });
        }
        nextState = recordRefundTransfer({
            state: input.state,
            order,
            refundTxid,
            recordedAt: now(),
        });
        effectiveOrder = findSellerOrder(nextState, order.id) ?? {
            ...order,
            refundTxid,
        };
        if (input.persistSettlementState) {
            try {
                await input.persistSettlementState(nextState);
            }
            catch (error) {
                return blockSettlement({
                    state: nextState,
                    order: effectiveOrder,
                    code: 'refund_transfer_persist_failed',
                    message: error instanceof Error ? error.message : String(error),
                    now: now(),
                    patch: { refundTxid },
                });
            }
        }
    }
    const finalizePayload = buildRefundFinalizePayload({
        order: effectiveOrder,
        refundRequestPayload,
        refundRequestPinId,
        refundTxid,
        refundAmount,
        refundCurrency,
        paymentChain,
        settlementKind,
    });
    let finalizeResult;
    try {
        finalizeResult = await input.writeRefundFinalizePin({
            order: effectiveOrder,
            payload: finalizePayload,
            refundRequestPayload,
        });
    }
    catch (error) {
        return blockSettlement({
            state: nextState,
            order: effectiveOrder,
            code: 'refund_finalize_failed',
            message: error instanceof Error ? error.message : String(error),
            now: now(),
            patch: { refundTxid },
        });
    }
    const refundFinalizePinId = readFinalizePinId(finalizeResult);
    if (!refundFinalizePinId) {
        return blockSettlement({
            state: nextState,
            order: effectiveOrder,
            code: 'refund_finalize_pin_missing',
            message: 'Refund finalize proof broadcast did not return a pin id.',
            now: now(),
            patch: { refundTxid },
        });
    }
    const completedAt = now();
    nextState = markStateRefunded({
        state: nextState,
        order: effectiveOrder,
        refundTxid,
        refundFinalizePinId,
        completedAt,
    });
    const updatedOrder = findSellerOrder(nextState, order.id) ?? effectiveOrder;
    return {
        ok: true,
        state: 'refunded',
        orderId: order.id,
        paymentTxid: normalizeText(order.paymentTxid) || null,
        refundTxid,
        refundFinalizePinId,
        noTransferReason: null,
        finalizePayload,
        order: updatedOrder,
        nextState,
    };
}
