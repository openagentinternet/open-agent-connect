"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeOrderProtocolTxid = normalizeOrderProtocolTxid;
exports.buildOrderStatusMessage = buildOrderStatusMessage;
exports.parseOrderStatusMessage = parseOrderStatusMessage;
exports.buildNeedsRatingMessage = buildNeedsRatingMessage;
exports.parseNeedsRatingMessage = parseNeedsRatingMessage;
exports.buildOrderEndMessage = buildOrderEndMessage;
exports.parseOrderEndMessage = parseOrderEndMessage;
exports.buildDeliveryMessage = buildDeliveryMessage;
exports.parseDeliveryMessage = parseDeliveryMessage;
exports.parseOrderScopedProtocolMessage = parseOrderScopedProtocolMessage;
const ORDER_STATUS_TAG = 'ORDER_STATUS';
const DELIVERY_TAG = 'DELIVERY';
const NEEDS_RATING_TAG = 'NeedsRating';
const ORDER_END_TAG = 'ORDER_END';
const ORDER_TXID_RE = /^[0-9a-f]{64}$/i;
const ORDER_TAG_RE = /^\[([A-Za-z_]+)(?::([0-9a-fA-F]{64})(?:\s+([A-Za-z0-9_-]+))?)?\]/;
function normalizeOrderProtocolTxid(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return ORDER_TXID_RE.test(normalized) ? normalized : '';
}
function buildOrderProtocolPrefix(tag, orderTxid) {
    const normalizedTxid = normalizeOrderProtocolTxid(orderTxid);
    return normalizedTxid ? `[${tag}:${normalizedTxid}]` : `[${tag}]`;
}
function parseOrderProtocolTag(content) {
    const trimmed = String(content || '').trim();
    const match = trimmed.match(ORDER_TAG_RE);
    if (!match) {
        const legacyOrderEndMatch = trimmed.match(/^\[(ORDER_END)(?:\s+([A-Za-z0-9_-]+))?\]/i);
        if (!legacyOrderEndMatch)
            return null;
        return {
            tag: legacyOrderEndMatch[1] || '',
            orderTxid: '',
            reason: String(legacyOrderEndMatch[2] || '').trim(),
            rest: trimmed.slice(legacyOrderEndMatch[0].length).trim(),
        };
    }
    return {
        tag: String(match[1] || ''),
        orderTxid: normalizeOrderProtocolTxid(match[2]),
        reason: String(match[3] || '').trim(),
        rest: trimmed.slice(match[0].length).trim(),
    };
}
function buildOrderStatusMessage(orderTxid, content) {
    const text = String(content || '').trim();
    return `${buildOrderProtocolPrefix(ORDER_STATUS_TAG, orderTxid)}${text ? ` ${text}` : ''}`;
}
function parseOrderStatusMessage(content) {
    const parsed = parseOrderProtocolTag(content);
    if (!parsed || parsed.tag.toUpperCase() !== ORDER_STATUS_TAG)
        return null;
    return {
        ...(parsed.orderTxid ? { orderTxid: parsed.orderTxid } : {}),
        content: parsed.rest,
    };
}
function buildNeedsRatingMessage(orderTxid, content) {
    const text = String(content || '').trim();
    return `${buildOrderProtocolPrefix(NEEDS_RATING_TAG, orderTxid)}${text ? ` ${text}` : ''}`;
}
function parseNeedsRatingMessage(content) {
    const parsed = parseOrderProtocolTag(content);
    if (!parsed || parsed.tag.toUpperCase() !== NEEDS_RATING_TAG.toUpperCase())
        return null;
    return {
        ...(parsed.orderTxid ? { orderTxid: parsed.orderTxid } : {}),
        content: parsed.rest,
    };
}
function buildOrderEndMessage(orderTxid, reason = '', content = '') {
    const normalizedTxid = normalizeOrderProtocolTxid(orderTxid);
    const normalizedReason = String(reason || '').trim().replace(/\s+/g, '_');
    const tagSuffix = [
        normalizedTxid ? `:${normalizedTxid}` : '',
        normalizedReason ? ` ${normalizedReason}` : '',
    ].join('');
    const text = String(content || '').trim();
    return `[${ORDER_END_TAG}${tagSuffix}]${text ? ` ${text}` : ''}`;
}
function parseOrderEndMessage(content) {
    const parsed = parseOrderProtocolTag(content);
    if (!parsed || parsed.tag.toUpperCase() !== ORDER_END_TAG)
        return null;
    return {
        ...(parsed.orderTxid ? { orderTxid: parsed.orderTxid } : {}),
        reason: parsed.reason || '',
        content: parsed.rest,
    };
}
function buildDeliveryMessage(payload, orderTxid) {
    return `${buildOrderProtocolPrefix(DELIVERY_TAG, orderTxid)} ${JSON.stringify(payload ?? {})}`;
}
function parseDeliveryMessage(content) {
    const parsedTag = parseOrderProtocolTag(content);
    if (!parsedTag || parsedTag.tag.toUpperCase() !== DELIVERY_TAG) {
        return null;
    }
    const jsonText = parsedTag.rest;
    if (!jsonText) {
        return null;
    }
    try {
        const parsed = JSON.parse(jsonText);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return null;
        }
        const payload = parsed;
        if (parsedTag.orderTxid) {
            payload.orderTxid = parsedTag.orderTxid;
        }
        return payload;
    }
    catch {
        return null;
    }
}
function parseOrderScopedProtocolMessage(content) {
    return parseOrderStatusMessage(content)
        || parseDeliveryMessage(content)
        || parseNeedsRatingMessage(content)
        || parseOrderEndMessage(content);
}
