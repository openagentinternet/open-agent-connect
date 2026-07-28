"use strict";
/**
 * Thin client for the metaso-p2p MetaApp aggregation API
 * (metaso-p2p docs/metaapp-api-downstream-guide.md and
 * docs/specs/2026-07-26-metaapp-query-api.md): GET /api/metaapp/list and
 * GET /api/metaapp/forks/:pinId. Keeps callers decoupled from the envelope
 * shape ({code, data, message}, HTTP always 200) and item normalization.
 *
 * Ported from the IDBots reference client
 * (IDBots/src/main/services/metaAppSearchService.ts).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetaAppSearchNotFoundError = exports.MetaAppSearchApiError = exports.DEFAULT_METAAPP_SEARCH_BASE_URL = void 0;
exports.searchMetaApps = searchMetaApps;
exports.listMetaAppForks = listMetaAppForks;
exports.trimMetaAppSearchItems = trimMetaAppSearchItems;
exports.DEFAULT_METAAPP_SEARCH_BASE_URL = 'https://so.metaid.io';
const METASO_P2P_BASE_URL_ENV = 'METASO_P2P_BASE_URL';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_PAGE_SIZE = 100;
class MetaAppSearchApiError extends Error {
    apiCode;
    constructor(apiCode, message) {
        super(`MetaApp search API error ${apiCode}: ${message}`);
        this.name = 'MetaAppSearchApiError';
        this.apiCode = apiCode;
    }
}
exports.MetaAppSearchApiError = MetaAppSearchApiError;
class MetaAppSearchNotFoundError extends MetaAppSearchApiError {
    constructor(message) {
        super(40400, message);
        this.name = 'MetaAppSearchNotFoundError';
    }
}
exports.MetaAppSearchNotFoundError = MetaAppSearchNotFoundError;
function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function textList(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}
function normalizeItem(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    return {
        pinId: text(record.pinId),
        sourcePinId: text(record.sourcePinId),
        chainName: text(record.chainName),
        title: text(record.title),
        appName: text(record.appName),
        intro: text(record.intro),
        tags: textList(record.tags),
        runtime: text(record.runtime),
        version: text(record.version),
        content: text(record.content),
        indexFile: text(record.indexFile) || 'index.html',
        forkedFrom: text(record.forkedFrom),
        disabled: record.disabled === true || record.disabled === 'true',
        publisherGlobalMetaId: text(record.publisherGlobalMetaId),
        publisherMetaId: text(record.publisherMetaId),
        publisherAddress: text(record.publisherAddress),
        publisherName: text(record.publisherName),
        publisherAvatarId: text(record.publisherAvatarId),
        createdAt: Number(record.createdAt) || 0,
        updatedAt: Number(record.updatedAt) || 0,
    };
}
function normalizePage(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    const items = Array.isArray(record.items) ? record.items.map(normalizeItem) : [];
    return {
        items,
        nextCursor: text(record.nextCursor) || null,
        hasMore: record.hasMore === true,
    };
}
async function fetchApiData(url, fetchFn, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchFn(url, {
            signal: controller.signal,
            headers: { accept: 'application/json' },
        });
        const body = await response.json().catch(() => null);
        if (!body || typeof body !== 'object') {
            throw new Error(`MetaApp search API returned an invalid response (HTTP ${response.status}).`);
        }
        const code = Number(body.code);
        if (code === 0) {
            return (body.data && typeof body.data === 'object' ? body.data : {});
        }
        const message = text(body.message) || 'unknown error';
        if (code === 40400) {
            throw new MetaAppSearchNotFoundError(message);
        }
        throw new MetaAppSearchApiError(Number.isFinite(code) ? code : -1, message);
    }
    finally {
        clearTimeout(timer);
    }
}
function normalizeBaseUrl(value) {
    const candidate = text(value);
    return (candidate || exports.DEFAULT_METAAPP_SEARCH_BASE_URL).replace(/\/+$/u, '') || exports.DEFAULT_METAAPP_SEARCH_BASE_URL;
}
function resolveOptions(options) {
    const fetchFn = options?.fetchFn ?? globalThis.fetch;
    if (typeof fetchFn !== 'function') {
        throw new Error('A fetch implementation is required for MetaApp search.');
    }
    return {
        baseUrl: normalizeBaseUrl(options?.baseUrl ?? process.env[METASO_P2P_BASE_URL_ENV]),
        fetchFn,
        timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
}
/** GET /api/metaapp/list — global feed & intent search. */
async function searchMetaApps(params, options) {
    const { baseUrl, fetchFn, timeoutMs } = resolveOptions(options);
    const query = new URLSearchParams();
    if (params.keyword?.trim())
        query.set('keyword', params.keyword.trim());
    if (params.tag?.trim())
        query.set('tag', params.tag.trim());
    if (params.chainName?.trim())
        query.set('chainName', params.chainName.trim());
    if (params.runtime?.trim())
        query.set('runtime', params.runtime.trim());
    if (params.publisher?.trim())
        query.set('publisher', params.publisher.trim());
    if (typeof params.since === 'number' && params.since > 0)
        query.set('since', String(Math.floor(params.since)));
    if (typeof params.until === 'number' && params.until > 0)
        query.set('until', String(Math.floor(params.until)));
    if (params.includeDisabled)
        query.set('includeDisabled', '1');
    if (typeof params.size === 'number' && params.size > 0)
        query.set('size', String(Math.min(MAX_PAGE_SIZE, Math.floor(params.size))));
    if (params.cursor?.trim())
        query.set('cursor', params.cursor.trim());
    const qs = query.toString();
    const data = await fetchApiData(`${baseUrl}/api/metaapp/list${qs ? `?${qs}` : ''}`, fetchFn, timeoutMs);
    return normalizePage(data);
}
/** GET /api/metaapp/forks/:pinId — direct remix children of an app. */
async function listMetaAppForks(input, options) {
    const { baseUrl, fetchFn, timeoutMs } = resolveOptions(options);
    const pinId = input.pinId.trim().toLowerCase();
    if (!pinId)
        throw new Error('pinId is required to list MetaApp forks.');
    const query = new URLSearchParams();
    if (typeof input.size === 'number' && input.size > 0)
        query.set('size', String(Math.min(MAX_PAGE_SIZE, Math.floor(input.size))));
    if (input.cursor?.trim())
        query.set('cursor', input.cursor.trim());
    const qs = query.toString();
    const data = await fetchApiData(`${baseUrl}/api/metaapp/forks/${encodeURIComponent(pinId)}${qs ? `?${qs}` : ''}`, fetchFn, timeoutMs);
    return normalizePage(data);
}
function trimMetaAppSearchItems(items, ownGlobalMetaIds) {
    const ownIds = new Set([...ownGlobalMetaIds].map((id) => id.trim().toLowerCase()).filter(Boolean));
    return items.map((item) => {
        const publisherGlobalMetaId = item.publisherGlobalMetaId;
        return {
            pinId: item.pinId,
            title: item.title,
            appName: item.appName,
            intro: item.intro,
            tags: item.tags,
            runtime: item.runtime,
            version: item.version,
            updatedAt: item.updatedAt,
            publisherGlobalMetaId,
            publisherName: item.publisherName,
            publisherAvatarId: item.publisherAvatarId,
            forkedFrom: item.forkedFrom,
            isOwn: Boolean(publisherGlobalMetaId) && ownIds.has(publisherGlobalMetaId.trim().toLowerCase()),
        };
    });
}
