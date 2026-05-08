"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProviderConsoleSnapshot = buildProviderConsoleSnapshot;
const manualRefund_1 = require("../orders/manualRefund");
const ratingDetailSync_1 = require("../ratings/ratingDetailSync");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function isZeroAmount(value) {
    const text = normalizeText(value);
    if (!text) {
        return false;
    }
    const numeric = Number(text);
    return Number.isFinite(numeric) && numeric === 0;
}
function sortByUpdatedAtDesc(left, right) {
    const leftValue = Number.isFinite(left.updatedAt) ? Number(left.updatedAt) : Number(left.createdAt) || 0;
    const rightValue = Number.isFinite(right.updatedAt) ? Number(right.updatedAt) : Number(right.createdAt) || 0;
    return rightValue - leftValue;
}
function buildServiceRow(record) {
    return {
        servicePinId: normalizeText(record.currentPinId),
        sourceServicePinId: normalizeText(record.sourceServicePinId),
        serviceName: normalizeText(record.serviceName),
        displayName: normalizeText(record.displayName) || normalizeText(record.serviceName),
        price: normalizeText(record.price),
        currency: normalizeText(record.currency),
        available: record.available === 1,
        updatedAt: Number.isFinite(record.updatedAt) ? Number(record.updatedAt) : 0,
    };
}
function resolveOrderRating(trace, ratingDetail, ratingSyncState) {
    if (!ratingDetail) {
        return {
            ratingStatus: ratingSyncState === 'sync_error' ? 'sync_error' : 'requested_unrated',
            ratingValue: null,
            ratingComment: null,
            ratingPinId: null,
            ratingCreatedAt: null,
        };
    }
    const ratingMessageError = normalizeText(trace.ratingMessageError);
    return {
        ratingStatus: trace.ratingMessageSent === false || Boolean(ratingMessageError)
            ? 'rated_on_chain_followup_unconfirmed'
            : 'rated_on_chain',
        ratingValue: Number.isFinite(ratingDetail.rate) ? Number(ratingDetail.rate) : null,
        ratingComment: normalizeText(ratingDetail.comment) || null,
        ratingPinId: normalizeText(ratingDetail.pinId) || null,
        ratingCreatedAt: Number.isFinite(ratingDetail.createdAt) ? Number(ratingDetail.createdAt) : null,
    };
}
function buildOrderRowWithRating(trace, ratingDetails, ratingSyncState) {
    const order = trace.order;
    if (!order || normalizeText(order.role) !== 'seller') {
        return null;
    }
    const orderId = normalizeText(order.id);
    const servicePinId = normalizeText(order.serviceId);
    if (!orderId || !servicePinId) {
        return null;
    }
    const paymentTxid = normalizeText(order.paymentTxid) || null;
    const ratingDetail = servicePinId && paymentTxid
        ? (0, ratingDetailSync_1.findRatingDetailByServicePayment)(ratingDetails, {
            serviceId: servicePinId,
            servicePaidTx: paymentTxid,
        })
        : null;
    const rating = resolveOrderRating(trace, ratingDetail, ratingSyncState);
    return {
        traceId: normalizeText(trace.traceId),
        orderId,
        servicePinId,
        serviceName: normalizeText(order.serviceName),
        paymentTxid,
        paymentAmount: normalizeText(order.paymentAmount) || null,
        paymentCurrency: normalizeText(order.paymentCurrency) || null,
        buyerGlobalMetaId: normalizeText(trace.session?.peerGlobalMetaId) || null,
        buyerName: normalizeText(trace.session?.peerName) || null,
        publicStatus: normalizeText(trace.a2a?.publicStatus) || null,
        ...(normalizeText(order.failureReason) ? { failureReason: normalizeText(order.failureReason) } : {}),
        ...(normalizeText(order.refundRequestPinId) ? { refundRequestPinId: normalizeText(order.refundRequestPinId) } : {}),
        ...(normalizeText(order.refundTxid) ? { refundTxid: normalizeText(order.refundTxid) } : {}),
        ...(normalizeText(order.refundFinalizePinId) ? { refundFinalizePinId: normalizeText(order.refundFinalizePinId) } : {}),
        ...(normalizeText(order.refundBlockingReason) ? { refundBlockingReason: normalizeText(order.refundBlockingReason) } : {}),
        createdAt: Number.isFinite(trace.createdAt) ? Number(trace.createdAt) : 0,
        ...rating,
    };
}
function buildSellerOrderRowWithRating(order, ratingDetails, ratingSyncState) {
    const orderId = normalizeText(order.id);
    const servicePinId = normalizeText(order.currentServicePinId) || normalizeText(order.servicePinId);
    if (!orderId || !servicePinId) {
        return null;
    }
    const paymentTxid = normalizeText(order.paymentTxid) || null;
    const ratingDetail = servicePinId && paymentTxid
        ? (0, ratingDetailSync_1.findRatingDetailByServicePayment)(ratingDetails, {
            serviceId: servicePinId,
            servicePaidTx: paymentTxid,
        })
        : null;
    const ratingTrace = {
        traceId: normalizeText(order.traceId),
        channel: 'a2a',
        createdAt: Number.isFinite(order.createdAt) ? Number(order.createdAt) : 0,
        session: {
            id: normalizeText(order.a2aSessionId),
            title: normalizeText(order.serviceName) || null,
            type: 'a2a',
            metabotId: Number.isFinite(order.localMetabotId) ? Number(order.localMetabotId) : null,
            peerGlobalMetaId: normalizeText(order.buyerGlobalMetaId) || null,
            peerName: null,
            externalConversationId: null,
        },
        order: {
            id: orderId,
            role: 'seller',
            serviceId: servicePinId,
            serviceName: normalizeText(order.serviceName),
            orderPinId: normalizeText(order.orderPinId) || null,
            orderTxid: normalizeText(order.orderTxid) || null,
            orderTxids: order.orderTxid ? [order.orderTxid] : [],
            paymentTxid,
            paymentCommitTxid: null,
            orderReference: normalizeText(order.orderReference) || null,
            paymentCurrency: normalizeText(order.paymentCurrency) || null,
            paymentAmount: normalizeText(order.paymentAmount) || null,
            paymentChain: normalizeText(order.paymentChain) || null,
            settlementKind: null,
            mrc20Ticker: null,
            mrc20Id: null,
            providerSkill: normalizeText(order.providerSkill) || null,
            outputType: null,
            requestText: null,
            status: normalizeText(order.state) || null,
            failedAt: null,
            failureReason: normalizeText(order.failureReason) || null,
            refundRequestPinId: normalizeText(order.refundRequestPinId) || null,
            refundRequestTxid: null,
            refundRequestedAt: null,
            refundCompletedAt: null,
            refundFinalizePinId: normalizeText(order.refundFinalizePinId) || null,
            refundBlockingReason: normalizeText(order.refundBlockingReason) || null,
            refundApplyRetryCount: null,
            nextRetryAt: null,
            refundTxid: normalizeText(order.refundTxid) || null,
            refundedAt: Number.isFinite(order.refundedAt) ? Number(order.refundedAt) : null,
            updatedAt: Number.isFinite(order.updatedAt) ? Number(order.updatedAt) : null,
        },
        a2a: {
            sessionId: normalizeText(order.a2aSessionId) || null,
            taskRunId: normalizeText(order.a2aTaskRunId) || null,
            role: 'provider',
            publicStatus: normalizeText(order.publicStatus) || null,
            latestEvent: normalizeText(order.latestEvent) || null,
            taskRunState: null,
            callerGlobalMetaId: normalizeText(order.buyerGlobalMetaId) || null,
            callerName: null,
            providerGlobalMetaId: normalizeText(order.providerGlobalMetaId) || null,
            providerName: null,
            servicePinId,
        },
        providerRuntime: {
            runtimeId: normalizeText(order.runtimeId) || null,
            runtimeProvider: normalizeText(order.runtimeProvider) || null,
            sessionId: normalizeText(order.llmSessionId) || null,
            providerSkill: normalizeText(order.providerSkill) || null,
            fallbackSelected: typeof order.fallbackSelected === 'boolean' ? order.fallbackSelected : null,
        },
        askMaster: null,
        artifacts: {
            transcriptMarkdownPath: '',
            traceMarkdownPath: '',
            traceJsonPath: '',
        },
    };
    const rating = resolveOrderRating(ratingTrace, ratingDetail, ratingSyncState);
    return {
        traceId: normalizeText(order.traceId),
        orderId,
        servicePinId,
        serviceName: normalizeText(order.serviceName),
        paymentTxid,
        paymentAmount: normalizeText(order.paymentAmount) || null,
        paymentCurrency: normalizeText(order.paymentCurrency) || null,
        buyerGlobalMetaId: normalizeText(order.buyerGlobalMetaId) || null,
        buyerName: null,
        publicStatus: normalizeText(order.publicStatus) || null,
        state: normalizeText(order.state) || null,
        providerSkill: normalizeText(order.providerSkill) || null,
        a2aSessionId: normalizeText(order.a2aSessionId) || null,
        a2aTaskRunId: normalizeText(order.a2aTaskRunId) || null,
        llmSessionId: normalizeText(order.llmSessionId) || null,
        runtimeId: normalizeText(order.runtimeId) || null,
        runtimeProvider: normalizeText(order.runtimeProvider) || null,
        fallbackSelected: typeof order.fallbackSelected === 'boolean' ? order.fallbackSelected : null,
        failureReason: normalizeText(order.failureReason) || null,
        refundRequestPinId: normalizeText(order.refundRequestPinId) || null,
        refundTxid: normalizeText(order.refundTxid) || null,
        refundFinalizePinId: normalizeText(order.refundFinalizePinId) || null,
        refundBlockingReason: normalizeText(order.refundBlockingReason) || null,
        createdAt: Number.isFinite(order.createdAt) ? Number(order.createdAt) : 0,
        updatedAt: Number.isFinite(order.updatedAt) ? Number(order.updatedAt) : undefined,
        ...rating,
    };
}
function buildManualAction(trace) {
    const order = trace.order;
    if (!order) {
        return null;
    }
    const decision = (0, manualRefund_1.resolveManualRefundDecision)({
        id: normalizeText(order.id),
        role: normalizeText(order.role) === 'seller' ? 'seller' : 'buyer',
        status: normalizeText(order.status),
        refundRequestPinId: normalizeText(order.refundRequestPinId) || null,
        coworkSessionId: normalizeText(order.coworkSessionId) || null,
        paymentTxid: normalizeText(order.paymentTxid) || null,
    });
    if (!decision.required) {
        return null;
    }
    return {
        kind: 'refund',
        traceId: normalizeText(trace.traceId),
        orderId: decision.ui.orderId,
        refundRequestPinId: decision.ui.refundRequestPinId,
        sessionId: decision.ui.sessionId,
    };
}
function buildSellerOrderManualAction(order) {
    if (normalizeText(order.state) !== 'refund_pending') {
        if (normalizeText(order.state) !== 'failed'
            || !normalizeText(order.paymentTxid)
            || isZeroAmount(order.paymentAmount)) {
            return null;
        }
        return {
            kind: 'refund',
            traceId: normalizeText(order.traceId),
            orderId: normalizeText(order.id),
            refundRequestPinId: null,
            sessionId: normalizeText(order.a2aSessionId) || null,
        };
    }
    const refundRequestPinId = normalizeText(order.refundRequestPinId);
    if (!refundRequestPinId) {
        return null;
    }
    return {
        kind: 'refund',
        traceId: normalizeText(order.traceId),
        orderId: normalizeText(order.id),
        refundRequestPinId,
        sessionId: normalizeText(order.a2aSessionId) || null,
    };
}
function findPublishedMaster(masters, servicePinId) {
    return masters.find((entry) => (normalizeText(entry.currentPinId) === servicePinId
        || normalizeText(entry.sourceMasterPinId) === servicePinId)) ?? null;
}
function buildMasterRequestRow(trace, masters) {
    const externalConversationId = normalizeText(trace.session?.externalConversationId);
    const servicePinId = normalizeText(trace.a2a?.servicePinId);
    if (!externalConversationId.startsWith('master:') || normalizeText(trace.a2a?.role) !== 'provider' || !servicePinId) {
        return null;
    }
    const publishedMaster = findPublishedMaster(masters, servicePinId);
    return {
        traceId: normalizeText(trace.traceId),
        servicePinId,
        serviceName: normalizeText(publishedMaster?.serviceName) || servicePinId,
        displayName: normalizeText(publishedMaster?.displayName) || normalizeText(trace.session?.title) || servicePinId,
        masterKind: normalizeText(publishedMaster?.masterKind) || 'unknown',
        callerGlobalMetaId: normalizeText(trace.a2a?.callerGlobalMetaId) || null,
        callerName: normalizeText(trace.a2a?.callerName) || null,
        publicStatus: normalizeText(trace.a2a?.publicStatus) || null,
        latestEvent: normalizeText(trace.a2a?.latestEvent) || null,
        createdAt: Number.isFinite(trace.createdAt) ? Number(trace.createdAt) : 0,
    };
}
function buildProviderConsoleSnapshot(input) {
    const masters = Array.isArray(input.masters) ? input.masters : [];
    const ratingDetails = Array.isArray(input.ratingDetails) ? input.ratingDetails : [];
    const ratingSyncState = input.ratingSyncState === 'sync_error' ? 'sync_error' : 'ready';
    const services = [...input.services]
        .sort(sortByUpdatedAtDesc)
        .map(buildServiceRow);
    const sellerOrderRows = (Array.isArray(input.sellerOrders) ? input.sellerOrders : [])
        .map((order) => buildSellerOrderRowWithRating(order, ratingDetails, ratingSyncState))
        .filter((entry) => Boolean(entry));
    const sellerOrderRowKeys = new Set(sellerOrderRows.flatMap((entry) => [
        entry.traceId ? `trace:${entry.traceId}` : '',
        entry.orderId ? `order:${entry.orderId}` : '',
        entry.paymentTxid ? `payment:${entry.paymentTxid}` : '',
    ].filter(Boolean)));
    const traceOrderRows = input.traces
        .map((trace) => buildOrderRowWithRating(trace, ratingDetails, ratingSyncState))
        .filter((entry) => Boolean(entry))
        .filter((entry) => ![
        entry.traceId ? `trace:${entry.traceId}` : '',
        entry.orderId ? `order:${entry.orderId}` : '',
        entry.paymentTxid ? `payment:${entry.paymentTxid}` : '',
    ].some((key) => key && sellerOrderRowKeys.has(key)));
    const recentOrders = [
        ...sellerOrderRows,
        ...traceOrderRows,
    ]
        .sort(sortByUpdatedAtDesc);
    const manualActions = [
        ...input.traces.map(buildManualAction),
        ...(Array.isArray(input.sellerOrders) ? input.sellerOrders : []).map(buildSellerOrderManualAction),
    ]
        .filter((entry) => Boolean(entry));
    const recentMasterRequests = input.traces
        .map((trace) => buildMasterRequestRow(trace, masters))
        .filter((entry) => Boolean(entry))
        .sort(sortByUpdatedAtDesc);
    return {
        services,
        recentOrders,
        manualActions,
        recentMasterRequests,
        totals: {
            serviceCount: services.length,
            activeServiceCount: services.filter((entry) => entry.available).length,
            sellerOrderCount: recentOrders.length,
            manualActionCount: manualActions.length,
            masterRequestCount: recentMasterRequests.length,
        },
    };
}
