"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProductOrderNotification = buildProductOrderNotification;
exports.parseProductOrderNotification = parseProductOrderNotification;
exports.parseProductDeliveryMessage = parseProductDeliveryMessage;
const orderMessage_1 = require("../orders/orderMessage");
const orderProtocol_1 = require("../a2a/protocol/orderProtocol");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeRequiredText(value, fieldName) {
    const normalized = normalizeText(value);
    if (!normalized) {
        throw new Error(`${fieldName} is required.`);
    }
    return normalized;
}
function normalizeFiniteTimestamp(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return null;
    }
    return Math.trunc(numeric);
}
function parseJsonObject(value) {
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function extractOrderLineValue(content, label) {
    const match = content.match(new RegExp(`^\\s*${escapeRegex(label)}\\s*:\\s*(.+?)\\s*$`, 'imu'));
    return normalizeText(match?.[1]);
}
function stripRawRequestBlocks(content) {
    return content.replace(/<raw_request>[\s\S]*?<\/raw_request>/giu, '').trim();
}
function hasGeneratedProductOrderHeader(content) {
    return /^\s*\[ORDER\]\s+\[PRODUCT_ORDER\](?:\s|$)/iu.test(content);
}
function buildProductOrderNotification(input) {
    const rawRequest = {
        protocol: 'product-order',
        productOrderPinId: normalizeRequiredText(input.productOrderPinId, 'productOrderPinId'),
        listingPinId: normalizeRequiredText(input.listingPinId, 'listingPinId'),
        skuId: normalizeRequiredText(input.skuId, 'skuId'),
        paymentTxid: normalizeRequiredText(input.paymentTxid, 'paymentTxid'),
    };
    const comment = normalizeText(input.comment);
    if (comment) {
        rawRequest.comment = comment;
    }
    return [
        `${orderMessage_1.ORDER_PREFIX} [PRODUCT_ORDER] ${rawRequest.skuId} for listing ${rawRequest.listingPinId}`,
        (0, orderMessage_1.buildOrderRawRequestBlock)(JSON.stringify(rawRequest)),
        `product-order pin id: ${rawRequest.productOrderPinId}`,
        `listing pin id: ${rawRequest.listingPinId}`,
        `sku id: ${rawRequest.skuId}`,
        `payment txid: ${rawRequest.paymentTxid}`,
    ].join('\n');
}
function parseProductOrderNotification(value) {
    const source = normalizeText(value);
    if (!source) {
        return null;
    }
    const rawRequest = (0, orderMessage_1.extractOrderRawRequest)(source);
    const parsed = rawRequest ? parseJsonObject(rawRequest) : null;
    const fallbackSource = stripRawRequestBlocks(source);
    if (parsed && normalizeText(parsed.protocol) !== 'product-order') {
        return null;
    }
    if (!parsed && !hasGeneratedProductOrderHeader(source)) {
        return null;
    }
    const productOrderPinId = normalizeText(parsed?.productOrderPinId)
        || extractOrderLineValue(fallbackSource, 'product-order pin id')
        || extractOrderLineValue(fallbackSource, 'productOrderPinId');
    const listingPinId = normalizeText(parsed?.listingPinId)
        || extractOrderLineValue(fallbackSource, 'listing pin id')
        || extractOrderLineValue(fallbackSource, 'listingPinId');
    const skuId = normalizeText(parsed?.skuId)
        || extractOrderLineValue(fallbackSource, 'sku id')
        || extractOrderLineValue(fallbackSource, 'skuId');
    const paymentTxid = normalizeText(parsed?.paymentTxid)
        || extractOrderLineValue(fallbackSource, 'payment txid')
        || extractOrderLineValue(fallbackSource, 'paymentTxid');
    if (!productOrderPinId || !listingPinId || !skuId || !paymentTxid) {
        return null;
    }
    return {
        productOrderPinId,
        listingPinId,
        skuId,
        paymentTxid,
    };
}
function parseProductDeliveryMessage(value) {
    const source = normalizeText(value);
    if (!source) {
        return null;
    }
    const parsed = (0, orderProtocol_1.parseDeliveryMessage)(source) ?? parseJsonObject(source);
    if (!parsed) {
        return null;
    }
    const record = parsed;
    const productOrderPinId = normalizeText(record.productOrderPinId);
    const listingPinId = normalizeText(record.listingPinId);
    const skuId = normalizeText(record.skuId);
    const paymentTxid = normalizeText(record.paymentTxid);
    const result = normalizeText(record.result);
    const deliveredAt = normalizeFiniteTimestamp(record.deliveredAt);
    if (!productOrderPinId || !listingPinId || !skuId || !paymentTxid || !result || deliveredAt === null) {
        return null;
    }
    return {
        productOrderPinId,
        listingPinId,
        skuId,
        paymentTxid,
        result,
        deliveredAt,
    };
}
