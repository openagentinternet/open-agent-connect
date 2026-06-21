"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifySimplemsgContent = classifySimplemsgContent;
const ORDER_TXID_RE = /^[0-9a-f]{64}$/i;
const TAG_RE = /^\[([A-Za-z_]+)(?::([0-9a-fA-F]{64})(?:\s+([A-Za-z0-9_-]+))?)?\]/;
const LEGACY_ORDER_END_RE = /^\[(ORDER_END)(?:\s+([A-Za-z0-9_-]+))?\]/i;
const ORDER_PIN_LINE_RE = /^\s*order\s+pin\s+id\s*[:：=]\s*([A-Za-z0-9][A-Za-z0-9._:-]{5,127})\s*$/im;
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
function extractOrderPinId(value) {
    const match = normalizeText(value).match(ORDER_PIN_LINE_RE);
    return normalizeText(match?.[1]) || null;
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
        return {
            kind: 'order_protocol',
            tag,
            orderTxid: normalizeOrderTxid(match[2]),
            orderPinId: extractOrderPinId(text),
            reason: tag === 'ORDER_END' ? normalizeText(match[3]) || null : null,
        };
    }
    const legacyOrderEndMatch = text.match(LEGACY_ORDER_END_RE);
    if (legacyOrderEndMatch) {
        return {
            kind: 'order_protocol',
            tag: 'ORDER_END',
            orderTxid: null,
            orderPinId: extractOrderPinId(text),
            reason: normalizeText(legacyOrderEndMatch[2]) || null,
        };
    }
    return { kind: 'private_chat' };
}
