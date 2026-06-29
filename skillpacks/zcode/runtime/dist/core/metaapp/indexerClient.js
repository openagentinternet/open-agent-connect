"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeMetaAppIndexerRecord = normalizeMetaAppIndexerRecord;
exports.createMetaAppIndexerClient = createMetaAppIndexerClient;
const DEFAULT_METAAPP_INDEXER_BASE_URL = 'https://metaweb.world';
const INDEXER_BASE_URL_ENV = 'METABOT_METAAPP_INDEXER_BASE_URL';
const MAX_METAAPP_INDEXER_PAGE_SIZE = 100;
function normalizeBaseUrl(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return (text || DEFAULT_METAAPP_INDEXER_BASE_URL).replace(/\/+$/, '') || DEFAULT_METAAPP_INDEXER_BASE_URL;
}
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}
function normalizeOptionalText(value) {
    const text = normalizeText(value);
    return text || undefined;
}
function normalizeOperation(value) {
    return value === 'modify' || value === 'revoke' ? value : 'create';
}
function normalizeTags(value) {
    const source = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(',')
            : [];
    const seen = new Set();
    const result = [];
    for (const item of source) {
        const normalized = normalizeText(item);
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}
function normalizeBoolean(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value !== 0;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1')
            return true;
        if (normalized === 'false' || normalized === '0')
            return false;
    }
    return undefined;
}
function normalizeStatus(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    const text = normalizeOptionalText(value);
    return text;
}
function normalizeTimestamp(value, fallback) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 0 && value < 10_000_000_000 ? Math.trunc(value * 1000) : Math.trunc(value);
    }
    if (typeof value === 'string') {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return numeric > 0 && numeric < 10_000_000_000 ? Math.trunc(numeric * 1000) : Math.trunc(numeric);
        }
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
}
function normalizeLimit(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return null;
    }
    return Math.min(MAX_METAAPP_INDEXER_PAGE_SIZE, Math.max(1, Math.trunc(value)));
}
function appendSizeQuery(route, limit) {
    const normalizedLimit = normalizeLimit(limit);
    if (normalizedLimit === null) {
        return route;
    }
    const params = new URLSearchParams({ size: String(normalizedLimit) });
    return `${route}?${params.toString()}`;
}
function readObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function unwrapIndexerResponse(body) {
    const object = readObject(body);
    if (!object || !('code' in object)) {
        return { ok: true, data: body };
    }
    const code = Number(object.code);
    if (Number.isFinite(code) && code === 0) {
        return { ok: true, data: object.data };
    }
    return {
        ok: false,
        error: {
            code: 'indexer_api_error',
            message: normalizeText(object.message) || `Indexer API returned code ${normalizeText(object.code) || 'unknown'}.`,
        },
    };
}
function extractList(data, key) {
    if (Array.isArray(data)) {
        return data;
    }
    const object = readObject(data);
    if (!object) {
        return null;
    }
    const value = object[key];
    return Array.isArray(value) ? value : null;
}
function buildMetawebUrl(baseUrl, pinId) {
    return `${baseUrl}/api/v1/metaapps/${encodeURIComponent(pinId)}`;
}
function normalizeMetaAppIndexerRecord(value, input) {
    const record = readObject(value);
    if (!record) {
        return null;
    }
    const pinId = normalizeText(record.pinId ?? record.pin_id);
    if (!pinId) {
        return null;
    }
    const firstPinId = normalizeText(record.firstPinId ?? record.first_pin_id) || pinId;
    const appName = normalizeText(record.appName ?? record.app_name);
    const title = normalizeText(record.title) || appName || pinId;
    const ownerGlobalMetaId = normalizeText(record.ownerGlobalMetaId
        ?? record.owner_meta_id
        ?? record.creatorGlobalMetaId
        ?? record.creator_meta_id
        ?? record.globalMetaId
        ?? record.global_meta_id);
    const ownerAddress = normalizeText(record.ownerAddress ?? record.owner_address ?? record.creatorAddress ?? record.creator_address);
    const network = normalizeText(record.network ?? record.chainName ?? record.chain_name ?? record.chain) || 'mvc';
    const updatedAt = normalizeTimestamp(record.updatedAt ?? record.updated_at ?? record.timestamp, input.now());
    const normalized = {
        pinId,
        firstPinId,
        operation: normalizeOperation(record.operation),
        title,
        appName: appName || title,
        version: normalizeText(record.version) || '1.0.0',
        runtime: normalizeText(record.runtime) || 'browser',
        indexFile: normalizeText(record.indexFile ?? record.index_file) || 'index.html',
        code: normalizeText(record.code),
        content: normalizeText(record.content),
        contentType: normalizeText(record.contentType ?? record.content_type) || 'application/zip',
        codeType: normalizeText(record.codeType ?? record.code_type) || 'application/zip',
        tags: normalizeTags(record.tags),
        ownerGlobalMetaId,
        ownerAddress,
        network,
        metawebUrl: normalizeText(record.metawebUrl ?? record.metaweb_url) || buildMetawebUrl(input.baseUrl, pinId),
        updatedAt,
        source: 'indexer',
        raw: record,
    };
    const localUiUrl = normalizeOptionalText(record.localUiUrl ?? record.local_ui_url);
    if (localUiUrl)
        normalized.localUiUrl = localUiUrl;
    const disabled = normalizeBoolean(record.disabled);
    if (disabled !== undefined)
        normalized.disabled = disabled;
    const status = normalizeStatus(record.status ?? record.state);
    if (status !== undefined)
        normalized.status = status;
    const runUrl = normalizeOptionalText(record.runUrl ?? record.run_url);
    if (runUrl)
        normalized.runUrl = runUrl;
    const downloadUrl = normalizeOptionalText(record.downloadUrl ?? record.download_url);
    if (downloadUrl)
        normalized.downloadUrl = downloadUrl;
    return normalized;
}
function success(data, fetchedAt) {
    return { ok: true, data, fetchedAt };
}
function failure(data, error, fetchedAt) {
    return { ok: false, data, error, fetchedAt };
}
function malformed(message) {
    return {
        code: 'indexer_malformed_response',
        message,
    };
}
async function fetchJson(fetchFn, url) {
    try {
        const response = await fetchFn(url);
        if (!response.ok) {
            return {
                ok: false,
                error: {
                    code: 'indexer_http_error',
                    message: `Indexer request failed with HTTP ${response.status}.`,
                    status: response.status,
                },
            };
        }
        return { ok: true, body: await response.json() };
    }
    catch (error) {
        return {
            ok: false,
            error: {
                code: 'indexer_fetch_error',
                message: error instanceof Error ? error.message : 'Indexer request failed.',
            },
        };
    }
}
function normalizeRecordList(rawItems, input) {
    const records = rawItems
        .map((item) => normalizeMetaAppIndexerRecord(item, input))
        .filter((item) => item !== null);
    if (rawItems.length > 0 && records.length === 0) {
        return {
            ok: false,
            error: malformed('Indexer response did not contain any usable MetaApp records.'),
        };
    }
    return { ok: true, records };
}
function createMetaAppIndexerClient(input = {}) {
    const env = input.env ?? process.env;
    const baseUrl = normalizeBaseUrl(input.baseUrl ?? env[INDEXER_BASE_URL_ENV]);
    const now = input.now ?? Date.now;
    const fetchFn = input.fetch ?? globalThis.fetch;
    async function requestList(url, key) {
        const fetchedAt = now();
        if (!fetchFn) {
            return failure([], {
                code: 'indexer_fetch_error',
                message: 'No fetch implementation is available for the MetaApp indexer client.',
            }, fetchedAt);
        }
        const fetched = await fetchJson(fetchFn, url);
        if (!fetched.ok) {
            return failure([], fetched.error, fetchedAt);
        }
        const unwrapped = unwrapIndexerResponse(fetched.body);
        if (!unwrapped.ok) {
            return failure([], unwrapped.error, fetchedAt);
        }
        const rawItems = extractList(unwrapped.data, key);
        if (!rawItems) {
            return failure([], malformed(`Indexer response is missing a ${key} array.`), fetchedAt);
        }
        const normalized = normalizeRecordList(rawItems, { baseUrl, now });
        if (!normalized.ok) {
            return failure([], normalized.error, fetchedAt);
        }
        return success(normalized.records, fetchedAt);
    }
    return {
        baseUrl,
        async list(listInput) {
            const creatorGlobalMetaId = normalizeText(listInput?.creatorGlobalMetaId);
            const routePath = creatorGlobalMetaId
                ? `/api/v1/metaapps/creator/${encodeURIComponent(creatorGlobalMetaId)}`
                : '/api/v1/metaapps';
            const route = appendSizeQuery(routePath, listInput?.limit);
            return requestList(`${baseUrl}${route}`, 'apps');
        },
        async getByPinId(pinId) {
            const fetchedAt = now();
            const normalizedPinId = normalizeText(pinId);
            if (!fetchFn) {
                return failure(null, {
                    code: 'indexer_fetch_error',
                    message: 'No fetch implementation is available for the MetaApp indexer client.',
                }, fetchedAt);
            }
            const fetched = await fetchJson(fetchFn, `${baseUrl}/api/v1/metaapps/${encodeURIComponent(normalizedPinId)}`);
            if (!fetched.ok) {
                return failure(null, fetched.error, fetchedAt);
            }
            const unwrapped = unwrapIndexerResponse(fetched.body);
            if (!unwrapped.ok) {
                return failure(null, unwrapped.error, fetchedAt);
            }
            const record = normalizeMetaAppIndexerRecord(unwrapped.data, { baseUrl, now });
            if (!record) {
                return failure(null, malformed('Indexer pin detail response did not contain a usable MetaApp record.'), fetchedAt);
            }
            return success(record, fetchedAt);
        },
        async getHistory(firstPinId) {
            const normalizedFirstPinId = normalizeText(firstPinId);
            return requestList(`${baseUrl}/api/v1/metaapps/first/${encodeURIComponent(normalizedFirstPinId)}/history`, 'history');
        },
    };
}
