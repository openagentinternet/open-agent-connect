"use strict";
/**
 * Thin client for the metaso-p2p MetaWeb unified search API:
 * GET /api/metaweb/search. Same conventions as the other aggregation APIs:
 * {code, data, message} envelope, HTTP always 200, business error codes
 * 40000/40400/50000. OAC port of the IDBots metawebSearchService.
 *
 * One keyword query fans out over every knowledge-bearing protocol the node
 * indexes (simplenote, simplebuzz, metaapp, metabot-skill, skill-service,
 * metaprotocol) and returns a relevance-ranked candidate list with
 * title/summary/pinId. This list is the search-engine results page, not the
 * content — the bot opens chosen pins via the pin-read API (./pinRead).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.METAWEB_API_BASE_URL_ENV = exports.DEFAULT_METAWEB_SEARCH_BASE_URL = void 0;
exports.searchMetaweb = searchMetaweb;
exports.DEFAULT_METAWEB_SEARCH_BASE_URL = 'https://so.metaid.io';
/** Production wiring override: METABOT_METAWEB_API_BASE_URL. */
exports.METAWEB_API_BASE_URL_ENV = 'METABOT_METAWEB_API_BASE_URL';
const DEFAULT_TIMEOUT_MS = 10_000;
function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function textList(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}
function normalizePublisher(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    return {
        globalMetaId: text(record.globalMetaId),
        metaid: text(record.metaid ?? record.metaId),
        name: text(record.name),
        avatar: text(record.avatar),
    };
}
function normalizeItem(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    return {
        protocol: text(record.protocol),
        pinId: text(record.pinId),
        currentPinId: text(record.currentPinId) || text(record.pinId),
        chainName: text(record.chainName),
        title: text(record.title),
        summary: text(record.summary),
        tags: textList(record.tags),
        publisher: normalizePublisher(record.publisher),
        createdAt: Number(record.createdAt) || 0,
        score: Number(record.score) || 0,
        extra: (record.extra && typeof record.extra === 'object' ? record.extra : {}),
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
                throw new Error(`MetaWeb search API timed out after ${Math.round(timeoutMs / 1000)}s — try again, or narrow the query.`);
            }
            throw error;
        }
        const body = await response.json().catch(() => null);
        if (!body || typeof body !== 'object') {
            throw new Error(`MetaWeb search API returned an invalid response (HTTP ${response.status}).`);
        }
        const code = Number(body.code);
        if (code === 0) {
            return (body.data && typeof body.data === 'object' ? body.data : {});
        }
        const message = text(body.message) || 'unknown error';
        throw new Error(`MetaWeb search API error ${code}: ${message}`);
    }
    finally {
        clearTimeout(timer);
    }
}
function resolveOptions(options) {
    const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        throw new Error('A fetch implementation is required for MetaWeb search.');
    }
    return {
        baseUrl: (options?.baseUrl ?? exports.DEFAULT_METAWEB_SEARCH_BASE_URL).replace(/\/+$/, ''),
        fetchImpl,
        timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
}
/** GET /api/metaweb/search — unified cross-protocol knowledge search. */
async function searchMetaweb(params, options) {
    const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
    const q = params.q.trim();
    if (!q)
        throw new Error('q is required for MetaWeb search.');
    const query = new URLSearchParams();
    query.set('q', q);
    if (params.protocols?.length) {
        query.set('protocols', params.protocols.map((key) => key.trim()).filter(Boolean).join(','));
    }
    if (params.publisher?.trim())
        query.set('publisher', params.publisher.trim());
    if (typeof params.since === 'number' && params.since > 0)
        query.set('since', String(Math.floor(params.since)));
    if (typeof params.until === 'number' && params.until > 0)
        query.set('until', String(Math.floor(params.until)));
    if (params.sort === 'newest')
        query.set('sort', 'newest');
    if (typeof params.size === 'number' && params.size > 0)
        query.set('size', String(Math.min(50, Math.floor(params.size))));
    if (params.cursor?.trim())
        query.set('cursor', params.cursor.trim());
    const data = await fetchApiData(`${baseUrl}/api/metaweb/search?${query.toString()}`, fetchImpl, timeoutMs);
    return normalizePage(data);
}
