"use strict";
/**
 * Thin client for the metaso-p2p MetaID aggregated search API
 * (metaso-p2p docs/specs/2026-07-28-metaid-search-api.md): GET /api/metaid/list
 * and GET /api/metaid/detail/:identity. Keeps callers decoupled from the
 * envelope shape ({code, data, message}, HTTP always 200) and item
 * normalization.
 *
 * Mirrors the MetaApp aggregation client (core/metaapp/metaAppSearchApi.ts):
 * the downstream LLM learns one convention for both directories.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetaIdSearchNotFoundError = exports.MetaIdSearchApiError = exports.DEFAULT_METAID_SEARCH_BASE_URL = void 0;
exports.searchMetaIds = searchMetaIds;
exports.getMetaIdDetail = getMetaIdDetail;
exports.trimMetaIdSearchItems = trimMetaIdSearchItems;
exports.DEFAULT_METAID_SEARCH_BASE_URL = 'https://so.metaid.io';
const METASO_P2P_BASE_URL_ENV = 'METASO_P2P_BASE_URL';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_PAGE_SIZE = 100;
class MetaIdSearchApiError extends Error {
    apiCode;
    constructor(apiCode, message) {
        super(`MetaID search API error ${apiCode}: ${message}`);
        this.name = 'MetaIdSearchApiError';
        this.apiCode = apiCode;
    }
}
exports.MetaIdSearchApiError = MetaIdSearchApiError;
class MetaIdSearchNotFoundError extends MetaIdSearchApiError {
    constructor(message) {
        super(40400, message);
        this.name = 'MetaIdSearchNotFoundError';
    }
}
exports.MetaIdSearchNotFoundError = MetaIdSearchNotFoundError;
function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function textList(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}
function flag(value) {
    return value === true || value === 'true' || value === 1;
}
function normalizeItem(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    return {
        globalMetaId: text(record.globalMetaId),
        metaId: text(record.metaId),
        address: text(record.address),
        chainName: text(record.chainName),
        name: text(record.name),
        avatarId: text(record.avatarId),
        bio: text(record.bio),
        chatSkills: textList(record.chatSkills),
        hasChatPubkey: flag(record.hasChatPubkey),
        hasHomepage: flag(record.hasHomepage),
        createdAt: Number(record.createdAt) || 0,
        updatedAt: Number(record.updatedAt) || 0,
    };
}
function normalizeDetail(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    const fieldPins = (record.fieldPins && typeof record.fieldPins === 'object' && !Array.isArray(record.fieldPins)
        ? record.fieldPins
        : {});
    return {
        ...normalizeItem(record),
        avatarContentType: text(record.avatarContentType),
        role: text(record.role),
        soul: text(record.soul),
        goal: text(record.goal),
        persona: record.persona ?? null,
        llm: record.llm ?? null,
        homepage: record.homepage ?? null,
        background: text(record.background),
        chatPubkey: text(record.chatPubkey),
        fieldPins: Object.fromEntries(Object.entries(fieldPins).map(([key, value]) => [key, text(value)]).filter(([, value]) => Boolean(value))),
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
            throw new Error(`MetaID search API returned an invalid response (HTTP ${response.status}).`);
        }
        const code = Number(body.code);
        if (code === 0) {
            return (body.data && typeof body.data === 'object' ? body.data : {});
        }
        const message = text(body.message) || 'unknown error';
        if (code === 40400) {
            throw new MetaIdSearchNotFoundError(message);
        }
        throw new MetaIdSearchApiError(Number.isFinite(code) ? code : -1, message);
    }
    finally {
        clearTimeout(timer);
    }
}
function normalizeBaseUrl(value) {
    const candidate = text(value);
    return (candidate || exports.DEFAULT_METAID_SEARCH_BASE_URL).replace(/\/+$/u, '') || exports.DEFAULT_METAID_SEARCH_BASE_URL;
}
function resolveOptions(options) {
    const fetchFn = options?.fetchFn ?? globalThis.fetch;
    if (typeof fetchFn !== 'function') {
        throw new Error('A fetch implementation is required for MetaID search.');
    }
    return {
        baseUrl: normalizeBaseUrl(options?.baseUrl ?? process.env[METASO_P2P_BASE_URL_ENV]),
        fetchFn,
        timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
}
/** GET /api/metaid/list — global user feed & intent search. */
async function searchMetaIds(params, options) {
    const { baseUrl, fetchFn, timeoutMs } = resolveOptions(options);
    const query = new URLSearchParams();
    if (params.keyword?.trim())
        query.set('keyword', params.keyword.trim());
    if (params.skill?.trim())
        query.set('skill', params.skill.trim());
    if (params.chainName?.trim())
        query.set('chainName', params.chainName.trim());
    if (params.hasChatPubkey)
        query.set('hasChatPubkey', '1');
    if (params.hasHomepage)
        query.set('hasHomepage', '1');
    if (typeof params.since === 'number' && params.since > 0)
        query.set('since', String(Math.floor(params.since)));
    if (typeof params.until === 'number' && params.until > 0)
        query.set('until', String(Math.floor(params.until)));
    if (typeof params.size === 'number' && params.size > 0)
        query.set('size', String(Math.min(MAX_PAGE_SIZE, Math.floor(params.size))));
    if (params.cursor?.trim())
        query.set('cursor', params.cursor.trim());
    const qs = query.toString();
    const data = await fetchApiData(`${baseUrl}/api/metaid/list${qs ? `?${qs}` : ''}`, fetchFn, timeoutMs);
    return normalizePage(data);
}
/** GET /api/metaid/detail/:identity — full profile of one identity. */
async function getMetaIdDetail(identity, options) {
    const { baseUrl, fetchFn, timeoutMs } = resolveOptions(options);
    const trimmed = identity.trim();
    if (!trimmed)
        throw new Error('identity is required to read a MetaID detail.');
    const data = await fetchApiData(`${baseUrl}/api/metaid/detail/${encodeURIComponent(trimmed)}`, fetchFn, timeoutMs);
    return normalizeDetail(data);
}
function trimMetaIdSearchItems(items, ownGlobalMetaIds) {
    const ownIds = new Set([...ownGlobalMetaIds].map((id) => id.trim().toLowerCase()).filter(Boolean));
    return items.map((item) => {
        const globalMetaId = item.globalMetaId;
        return {
            globalMetaId,
            metaId: item.metaId,
            address: item.address,
            chainName: item.chainName,
            name: item.name,
            avatarId: item.avatarId,
            bio: item.bio,
            chatSkills: item.chatSkills,
            hasChatPubkey: item.hasChatPubkey,
            hasHomepage: item.hasHomepage,
            updatedAt: item.updatedAt,
            isOwn: Boolean(globalMetaId) && ownIds.has(globalMetaId.trim().toLowerCase()),
        };
    });
}
