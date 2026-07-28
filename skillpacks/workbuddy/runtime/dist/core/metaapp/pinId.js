"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeMetaAppPinId = normalizeMetaAppPinId;
exports.assertMetaAppPinId = assertMetaAppPinId;
exports.normalizeMetaAppPinIdOrUri = normalizeMetaAppPinIdOrUri;
const METAAPP_PIN_ID_PATTERN = /^[0-9a-f]{64}i0$/i;
function normalizeMetaAppPinId(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim();
    if (!normalized) {
        return null;
    }
    if (normalized.includes('/') || normalized.includes('\\') || normalized.includes('..')) {
        return null;
    }
    return METAAPP_PIN_ID_PATTERN.test(normalized) ? normalized : null;
}
function assertMetaAppPinId(value, label = 'pinId') {
    const normalized = normalizeMetaAppPinId(value);
    if (!normalized) {
        throw new Error(`Invalid ${label}. Expected a 64-hex MetaWeb pinId ending in i0.`);
    }
    return normalized;
}
/** Accepts a bare pinId or a metaapp://<pinId> URI and returns the bare pinId. */
function normalizeMetaAppPinIdOrUri(value) {
    if (typeof value !== 'string') {
        return null;
    }
    let normalized = value.trim();
    if (normalized.toLowerCase().startsWith('metaapp://')) {
        normalized = normalized.slice('metaapp://'.length).trim();
    }
    return normalizeMetaAppPinId(normalized);
}
