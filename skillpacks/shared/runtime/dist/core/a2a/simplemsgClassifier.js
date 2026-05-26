"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifySimplemsgContent = classifySimplemsgContent;
const productOrderMessages_1 = require("../products/productOrderMessages");
const ORDER_TXID_RE = /^[0-9a-f]{64}$/i;
const TAG_RE = /^\[([A-Za-z_]+)(?::([0-9a-fA-F]{64})(?:\s+([A-Za-z0-9_-]+))?)?\]/;
const LEGACY_ORDER_END_RE = /^\[(ORDER_END)(?:\s+([A-Za-z0-9_-]+))?\]/i;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeOrderTxid(value) {
    const normalized = normalizeText(value).toLowerCase();
    return ORDER_TXID_RE.test(normalized) ? normalized : null;
}
function normalizeProtocolTag(value) {
    const normalized = normalizeText(value);
    const upper = normalized.toUpperCase();
    if (upper === 'ORDER')
        return 'ORDER';
    if (upper === 'ORDER_STATUS')
        return 'ORDER_STATUS';
    if (upper === 'DELIVERY')
        return 'DELIVERY';
    if (upper === 'NEEDSRATING')
        return 'NeedsRating';
    if (upper === 'ORDER_END')
        return 'ORDER_END';
    return null;
}
function readProductMetadata(tag, content) {
    if (tag === 'ORDER') {
        return (0, productOrderMessages_1.parseProductOrderNotification)(content);
    }
    if (tag === 'DELIVERY') {
        const delivery = (0, productOrderMessages_1.parseProductDeliveryMessage)(content);
        return delivery
            ? {
                productOrderPinId: delivery.productOrderPinId,
                listingPinId: delivery.listingPinId,
                skuId: delivery.skuId,
                paymentTxid: delivery.paymentTxid,
                deliveredAt: delivery.deliveredAt,
            }
            : null;
    }
    return null;
}
function classifyOrderProtocol(input) {
    const product = readProductMetadata(input.tag, input.content);
    const base = {
        kind: 'order_protocol',
        tag: input.tag,
        orderTxid: input.orderTxid,
        reason: input.reason,
    };
    return product
        ? {
            ...base,
            orderKind: 'product_order',
            product,
        }
        : base;
}
function classifySimplemsgContent(content) {
    const text = normalizeText(content);
    if (!text) {
        return { kind: 'private_chat' };
    }
    const match = text.match(TAG_RE);
    if (match) {
        const tag = normalizeProtocolTag(match[1]);
        if (!tag) {
            return { kind: 'private_chat' };
        }
        return classifyOrderProtocol({
            tag,
            orderTxid: normalizeOrderTxid(match[2]),
            reason: tag === 'ORDER_END' ? normalizeText(match[3]) || null : null,
            content: text,
        });
    }
    const legacyOrderEndMatch = text.match(LEGACY_ORDER_END_RE);
    if (legacyOrderEndMatch) {
        return classifyOrderProtocol({
            tag: 'ORDER_END',
            orderTxid: null,
            reason: normalizeText(legacyOrderEndMatch[2]) || null,
            content: text,
        });
    }
    return { kind: 'private_chat' };
}
