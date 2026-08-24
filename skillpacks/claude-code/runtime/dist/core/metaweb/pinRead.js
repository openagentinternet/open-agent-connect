"use strict";
/**
 * Thin client for the metaso-p2p MetaWeb generic pin-read API:
 * GET /api/metaweb/pin/:pinId. Same conventions as the other aggregation
 * APIs: {code, data, message} envelope, HTTP always 200, business error codes
 * 40000/40400/50000. OAC port of the IDBots metawebPinService.
 *
 * The caller does not know the pin's protocol in advance: the server
 * dispatches across its local index namespaces and falls back to MANAPI
 * passthrough (`source: "remote"`) when the pin is not locally indexed. Any
 * version of a pin id is accepted; the response resolves `currentPinId` to
 * the latest known version.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetawebPinNotFoundError = exports.DEFAULT_METAWEB_PIN_BASE_URL = void 0;
exports.readMetawebPin = readMetawebPin;
exports.DEFAULT_METAWEB_PIN_BASE_URL = 'https://so.metaid.io';
const DEFAULT_TIMEOUT_MS = 10_000;
class MetawebPinNotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MetawebPinNotFoundError';
    }
}
exports.MetawebPinNotFoundError = MetawebPinNotFoundError;
function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function textList(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}
function normalizeCreator(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    return {
        globalMetaId: text(record.globalMetaId),
        metaid: text(record.metaid ?? record.metaId),
        name: text(record.name).slice(0, 80),
        address: text(record.address),
    };
}
function normalizeAttachment(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    const size = Number(record.size);
    return {
        uri: text(record.uri),
        url: text(record.url),
        contentType: text(record.contentType),
        size: Number.isFinite(size) && size > 0 ? size : null,
    };
}
function normalizeMeta(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    return {
        title: text(record.title).slice(0, 200),
        summary: text(record.summary).slice(0, 500),
        tags: textList(record.tags).slice(0, 10).map((tag) => tag.slice(0, 40)),
    };
}
function normalizePin(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    const textValue = typeof record.text === 'string' ? record.text : null;
    return {
        pinId: text(record.pinId),
        currentPinId: text(record.currentPinId) || text(record.pinId),
        protocol: text(record.protocol),
        path: text(record.path),
        chainName: text(record.chainName),
        operation: text(record.operation) || 'create',
        creator: normalizeCreator(record.creator),
        createdAt: Number(record.createdAt) || 0,
        contentType: text(record.contentType),
        payload: record.payload ?? null,
        text: textValue,
        truncated: textValue != null ? record.truncated === true : null,
        totalLength: textValue != null && Number.isFinite(Number(record.totalLength)) ? Number(record.totalLength) : null,
        meta: normalizeMeta(record.meta),
        attachments: Array.isArray(record.attachments) ? record.attachments.map(normalizeAttachment) : [],
        source: text(record.source) || 'local',
    };
}
async function fetchApiData(url, fetchImpl, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let response;
        try {
            response = await fetchImpl(url, {
                signal: controller.signal,
                headers: { accept: 'application/json' },
            });
        }
        catch (error) {
            // Map the raw AbortError to an actionable timeout message — the model
            // sees this text verbatim in the tool result.
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error(`MetaWeb pin-read API timed out after ${Math.round(timeoutMs / 1000)}s — try again later.`);
            }
            throw error;
        }
        const body = await response.json().catch(() => null);
        if (!body || typeof body !== 'object') {
            throw new Error(`MetaWeb pin-read API returned an invalid response (HTTP ${response.status}).`);
        }
        const code = Number(body.code);
        if (code === 0) {
            return (body.data && typeof body.data === 'object' ? body.data : {});
        }
        const message = text(body.message) || 'unknown error';
        if (code === 40400) {
            throw new MetawebPinNotFoundError(message);
        }
        throw new Error(`MetaWeb pin-read API error ${code}: ${message}`);
    }
    finally {
        clearTimeout(timer);
    }
}
function resolveOptions(options) {
    const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        throw new Error('A fetch implementation is required for MetaWeb pin read.');
    }
    return {
        baseUrl: (options?.baseUrl ?? exports.DEFAULT_METAWEB_PIN_BASE_URL).replace(/\/+$/, ''),
        fetchImpl,
        timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
}
/** GET /api/metaweb/pin/:pinId — generic pin read; any version id resolves to the latest known version. */
async function readMetawebPin(pinId, options) {
    const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
    const trimmed = pinId.trim();
    if (!trimmed)
        throw new Error('pinId is required to read a MetaWeb pin.');
    const data = await fetchApiData(`${baseUrl}/api/metaweb/pin/${encodeURIComponent(trimmed)}`, fetchImpl, timeoutMs);
    return normalizePin(data);
}
