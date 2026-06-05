"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVICE_REFUND_FINALIZE_PATH = exports.SERVICE_REFUND_REQUEST_PATH = void 0;
exports.parseRefundProtocolContent = parseRefundProtocolContent;
exports.buildServiceRefundRequestPayload = buildServiceRefundRequestPayload;
exports.parseServiceRefundRequestPin = parseServiceRefundRequestPin;
exports.parseServiceRefundFinalizePin = parseServiceRefundFinalizePin;
exports.SERVICE_REFUND_REQUEST_PATH = '/protocols/service-refund-request';
exports.SERVICE_REFUND_FINALIZE_PATH = '/protocols/service-refund-finalize';
function normalizeText(value) {
    if (typeof value === 'string')
        return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    return '';
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
    const summaryObject = readObject(summary);
    if (summaryObject) {
        return summaryObject;
    }
    return object;
}
function readPinId(pin) {
    return normalizeText(pin.pinId)
        || normalizeText(pin.id)
        || normalizeText(pin.pinid)
        || normalizeText(pin.PINID);
}
function readPath(pin) {
    return normalizeText(pin.path);
}
function readPayload(pin) {
    const object = readObject(pin);
    if (!object) {
        return null;
    }
    const payload = parseRefundProtocolContent(object.content ?? object.payload ?? object.data ?? object);
    if (!payload) {
        return null;
    }
    return {
        pinId: readPinId(object),
        path: readPath(object),
        payload,
    };
}
function canonicalAsset(value) {
    const asset = normalizeText(value).toUpperCase();
    return asset === 'MVC' ? 'SPACE' : asset;
}
function isZeroAmount(value) {
    const numeric = Number(normalizeText(value));
    return Number.isFinite(numeric) && numeric === 0;
}
function isFreeSettlement(payload, amount) {
    return normalizeText(payload.settlementKind).toLowerCase() === 'free' || isZeroAmount(amount);
}
function readRequestedAt(payload) {
    const requestedAt = normalizeText(payload.requestedAt)
        || normalizeText(payload.createdAt)
        || normalizeText(payload.failureDetectedAt);
    if (!requestedAt) {
        return '';
    }
    const numeric = Number(requestedAt);
    if (Number.isFinite(numeric)) {
        const milliseconds = numeric > 9_999_999_999 ? numeric : numeric * 1000;
        return new Date(milliseconds).toISOString();
    }
    const parsed = Date.parse(requestedAt);
    return Number.isNaN(parsed) ? requestedAt : new Date(parsed).toISOString();
}
function readRequestReason(payload) {
    return normalizeText(payload.reason)
        || normalizeText(payload.failureReason)
        || normalizeText(payload.reasonComment);
}
function buildServiceRefundRequestPayload(input) {
    return {
        version: 1,
        serviceOrderPinId: normalizeText(input.serviceOrderPinId),
        ...(normalizeText(input.servicePinId) ? { servicePinId: normalizeText(input.servicePinId) } : {}),
        ...(normalizeText(input.paymentTxid) ? { paymentTxid: normalizeText(input.paymentTxid) } : {}),
        ...(normalizeText(input.paymentAmount) ? { paymentAmount: normalizeText(input.paymentAmount) } : {}),
        ...(canonicalAsset(input.paymentAsset) ? { paymentAsset: canonicalAsset(input.paymentAsset) } : {}),
        ...(normalizeText(input.paymentChain) ? { paymentChain: normalizeText(input.paymentChain).toLowerCase() } : {}),
        ...(normalizeText(input.settlementKind) ? { settlementKind: normalizeText(input.settlementKind).toLowerCase() } : {}),
        ...(normalizeText(input.mrc20Ticker) ? { mrc20Ticker: normalizeText(input.mrc20Ticker) } : {}),
        ...(normalizeText(input.mrc20Id) ? { mrc20Id: normalizeText(input.mrc20Id) } : {}),
        ...(normalizeText(input.buyerGlobalMetaId) ? { buyerGlobalMetaId: normalizeText(input.buyerGlobalMetaId) } : {}),
        ...(normalizeText(input.sellerGlobalMetaId) ? { sellerGlobalMetaId: normalizeText(input.sellerGlobalMetaId) } : {}),
        ...(normalizeText(input.refundAddress) ? { refundAddress: normalizeText(input.refundAddress) } : {}),
        reason: normalizeText(input.reason),
        requestedAt: normalizeText(input.requestedAt),
    };
}
function parseServiceRefundRequestPin(pin) {
    const parsed = readPayload(pin);
    if (!parsed) {
        return null;
    }
    if (parsed.path && parsed.path !== exports.SERVICE_REFUND_REQUEST_PATH) {
        return null;
    }
    const source = parsed.payload;
    const serviceOrderPinId = normalizeText(source.serviceOrderPinId)
        || normalizeText(source.orderMessagePinId)
        || normalizeText(source.orderPinId)
        || normalizeText(source.orderReference);
    const paymentTxid = normalizeText(source.paymentTxid);
    const paymentAmount = normalizeText(source.paymentAmount)
        || normalizeText(source.refundAmount)
        || normalizeText(source.amount);
    if (!isFreeSettlement(source, paymentAmount) && (!serviceOrderPinId || !paymentTxid)) {
        return null;
    }
    const payload = buildServiceRefundRequestPayload({
        version: 1,
        serviceOrderPinId,
        servicePinId: normalizeText(source.servicePinId),
        paymentTxid,
        paymentAmount,
        paymentAsset: canonicalAsset(source.paymentAsset || source.refundCurrency || source.currency),
        paymentChain: normalizeText(source.paymentChain),
        settlementKind: normalizeText(source.settlementKind),
        mrc20Ticker: normalizeText(source.mrc20Ticker),
        mrc20Id: normalizeText(source.mrc20Id),
        buyerGlobalMetaId: normalizeText(source.buyerGlobalMetaId),
        sellerGlobalMetaId: normalizeText(source.sellerGlobalMetaId),
        refundAddress: normalizeText(source.refundAddress) || normalizeText(source.refundToAddress),
        reason: readRequestReason(source),
        requestedAt: readRequestedAt(source),
    });
    if (!payload.serviceOrderPinId || !payload.reason || !payload.requestedAt) {
        return null;
    }
    return {
        pinId: parsed.pinId,
        path: parsed.path || exports.SERVICE_REFUND_REQUEST_PATH,
        payload,
    };
}
function parseServiceRefundFinalizePin(pin) {
    const parsed = readPayload(pin);
    if (!parsed) {
        return null;
    }
    if (parsed.path && parsed.path !== exports.SERVICE_REFUND_FINALIZE_PATH) {
        return null;
    }
    const source = parsed.payload;
    const refundRequestPinId = normalizeText(source.refundRequestPinId)
        || normalizeText(source.serviceRefundRequestPinId);
    const paymentAmount = normalizeText(source.paymentAmount)
        || normalizeText(source.refundAmount)
        || normalizeText(source.amount);
    const refundTxid = normalizeText(source.refundTxid) || normalizeText(source.refundTransferTxid);
    if (!refundRequestPinId || (!isFreeSettlement(source, paymentAmount) && !refundTxid)) {
        return null;
    }
    return {
        pinId: parsed.pinId,
        path: parsed.path || exports.SERVICE_REFUND_FINALIZE_PATH,
        payload: {
            version: 1,
            refundRequestPinId,
            ...(normalizeText(source.paymentTxid) ? { paymentTxid: normalizeText(source.paymentTxid) } : {}),
            ...(normalizeText(source.servicePinId) ? { servicePinId: normalizeText(source.servicePinId) } : {}),
            ...(refundTxid ? { refundTxid } : {}),
            ...(paymentAmount ? { paymentAmount } : {}),
            ...(canonicalAsset(source.paymentAsset || source.refundCurrency || source.currency)
                ? { paymentAsset: canonicalAsset(source.paymentAsset || source.refundCurrency || source.currency) }
                : {}),
            ...(normalizeText(source.buyerGlobalMetaId) ? { buyerGlobalMetaId: normalizeText(source.buyerGlobalMetaId) } : {}),
            ...(normalizeText(source.sellerGlobalMetaId) ? { sellerGlobalMetaId: normalizeText(source.sellerGlobalMetaId) } : {}),
        },
    };
}
