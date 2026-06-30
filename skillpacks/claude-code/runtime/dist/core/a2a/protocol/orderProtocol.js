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
const ORDER_PIN_LINE_RE = /^\s*order\s+pin\s+id\s*[:：=]\s*([/A-Za-z0-9][A-Za-z0-9._:/-]{5,127})\s*$/im;
function normalizeOrderProtocolTxid(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return ORDER_TXID_RE.test(normalized) ? normalized : '';
}
function buildOrderProtocolPrefix(tag, orderTxid) {
    const normalizedTxid = normalizeOrderProtocolTxid(orderTxid);
    return normalizedTxid ? `[${tag}:${normalizedTxid}]` : `[${tag}]`;
}
function normalizeOrderProtocolPinId(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function resolveOrderPinIdArg(value) {
    if (typeof value === 'string')
        return normalizeOrderProtocolPinId(value);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const record = value;
        return normalizeOrderProtocolPinId(record.orderPinId)
            || normalizeOrderProtocolPinId(record.serviceOrderPinId);
    }
    return '';
}
function extractOrderProtocolPinId(content) {
    const match = String(content || '').match(ORDER_PIN_LINE_RE);
    return typeof match?.[1] === 'string' ? match[1].trim() : '';
}
function stripOrderProtocolPinLine(content) {
    return String(content || '')
        .split(/\r?\n/u)
        .filter((line) => !ORDER_PIN_LINE_RE.test(line))
        .join('\n')
        .trim();
}
function appendOrderProtocolPinLine(content, orderPinId) {
    const text = stripOrderProtocolPinLine(content);
    const normalizedOrderPinId = resolveOrderPinIdArg(orderPinId);
    if (!normalizedOrderPinId)
        return text;
    return [text, `order pin id: ${normalizedOrderPinId}`].filter(Boolean).join('\n');
}
function parseOrderProtocolTag(content) {
    const trimmed = String(content || '').trim();
    const match = trimmed.match(ORDER_TAG_RE);
    if (!match) {
        const legacyOrderEndMatch = trimmed.match(/^\[(ORDER_END)(?:\s+([A-Za-z0-9_-]+))?\]/i);
        if (!legacyOrderEndMatch)
            return null;
        const rest = trimmed.slice(legacyOrderEndMatch[0].length).trim();
        return {
            tag: legacyOrderEndMatch[1] || '',
            orderTxid: '',
            orderPinId: extractOrderProtocolPinId(rest),
            reason: String(legacyOrderEndMatch[2] || '').trim(),
            rest: stripOrderProtocolPinLine(rest),
        };
    }
    const rest = trimmed.slice(match[0].length).trim();
    return {
        tag: String(match[1] || ''),
        orderTxid: normalizeOrderProtocolTxid(match[2]),
        orderPinId: extractOrderProtocolPinId(rest),
        reason: String(match[3] || '').trim(),
        rest: stripOrderProtocolPinLine(rest),
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
        ...(parsed.orderPinId ? { orderPinId: parsed.orderPinId } : {}),
        content: parsed.rest,
    };
}
function buildNeedsRatingMessage(orderTxid, content, orderPinId) {
    const text = appendOrderProtocolPinLine(String(content || ''), orderPinId);
    return `${buildOrderProtocolPrefix(NEEDS_RATING_TAG, orderTxid)}${text ? ` ${text}` : ''}`;
}
function parseNeedsRatingMessage(content) {
    const parsed = parseOrderProtocolTag(content);
    if (!parsed || parsed.tag.toUpperCase() !== NEEDS_RATING_TAG.toUpperCase())
        return null;
    return {
        ...(parsed.orderTxid ? { orderTxid: parsed.orderTxid } : {}),
        ...(parsed.orderPinId ? { orderPinId: parsed.orderPinId } : {}),
        content: parsed.rest,
    };
}
function buildOrderEndMessage(orderTxid, reason = '', content = '', orderPinId) {
    const normalizedTxid = normalizeOrderProtocolTxid(orderTxid);
    const normalizedReason = String(reason || '').trim().replace(/\s+/g, '_');
    const tagSuffix = [
        normalizedTxid ? `:${normalizedTxid}` : '',
        normalizedReason ? ` ${normalizedReason}` : '',
    ].join('');
    const text = appendOrderProtocolPinLine(String(content || ''), orderPinId);
    return `[${ORDER_END_TAG}${tagSuffix}]${text ? ` ${text}` : ''}`;
}
function parseOrderEndMessage(content) {
    const parsed = parseOrderProtocolTag(content);
    if (!parsed || parsed.tag.toUpperCase() !== ORDER_END_TAG)
        return null;
    return {
        ...(parsed.orderTxid ? { orderTxid: parsed.orderTxid } : {}),
        ...(parsed.orderPinId ? { orderPinId: parsed.orderPinId } : {}),
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
