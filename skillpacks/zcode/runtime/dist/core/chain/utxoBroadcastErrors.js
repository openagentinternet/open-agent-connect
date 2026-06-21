"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRetryableUtxoFundingError = isRetryableUtxoFundingError;
function normalizeText(value) {
    return value instanceof Error ? value.message.trim() : typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}
function isRetryableUtxoFundingError(value) {
    const normalized = normalizeText(value).toLowerCase();
    return (normalized.includes('txn-mempool-conflict')
        || /mempool[-\s]?conflict/.test(normalized)
        || normalized.includes('missingorspent')
        || normalized.includes('inputs missing/spent')
        || normalized.includes('inputs missing or spent')
        || normalized.includes('missing inputs'));
}
