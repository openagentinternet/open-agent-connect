"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServiceRefundChainReader = createServiceRefundChainReader;
const serviceRefundProtocol_1 = require("./serviceRefundProtocol");
const DEFAULT_CHAIN_API_BASE_URL = 'https://manapi.metaid.io';
const DEFAULT_REFUND_CHAIN_PAGE_SIZE = 100;
const DEFAULT_REFUND_CHAIN_MAX_PAGES = 10;
const UNIX_SECONDS_MAX = 10_000_000_000;
function normalizeText(value) {
    if (typeof value === 'string')
        return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    return '';
}
function normalizeBaseUrl(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return (normalized || DEFAULT_CHAIN_API_BASE_URL).replace(/\/$/, '');
}
function getFetchImpl(fetchImpl) {
    return fetchImpl ?? fetch;
}
function normalizePositiveInteger(value, fallback) {
    return Number.isFinite(value)
        ? Math.max(1, Math.floor(value))
        : fallback;
}
function readObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function readRecordList(value) {
    return Array.isArray(value)
        ? value.filter((entry) => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)))
        : [];
}
function readNextCursor(value) {
    const nextCursor = normalizeText(value?.nextCursor);
    if (nextCursor) {
        return nextCursor;
    }
    const cursor = normalizeText(value?.cursor);
    return cursor || null;
}
function getRefundChainListPage(payload) {
    const root = readObject(payload);
    const data = readObject(root?.data);
    const source = data ?? root;
    return {
        list: readRecordList(source?.list)
            .concat(readRecordList(source?.rows))
            .concat(readRecordList(source?.items)),
        nextCursor: readNextCursor(source),
    };
}
function normalizeTimestampMs(value) {
    const parsed = Number(normalizeText(value));
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }
    return parsed < UNIX_SECONDS_MAX ? Math.trunc(parsed * 1000) : Math.trunc(parsed);
}
function readRowTimestampMs(row) {
    return normalizeTimestampMs(row.timestamp
        ?? row.timestampMs
        ?? row.createdAt
        ?? row.createTime
        ?? row.created_at
        ?? row.createdTime);
}
function parseJsonObject(value) {
    try {
        return readObject(JSON.parse(value));
    }
    catch {
        return null;
    }
}
function readProtocolContentObject(value) {
    if (typeof value === 'string') {
        return parseJsonObject(value);
    }
    const object = readObject(value);
    if (!object) {
        return null;
    }
    const data = readObject(object.data);
    const summary = object.contentSummary ?? data?.contentSummary ?? object.content;
    if (typeof summary === 'string') {
        return parseJsonObject(summary);
    }
    const summaryObject = readObject(summary);
    return summaryObject ?? object;
}
function writeProtocolContentObject(original, content) {
    if (typeof original === 'string') {
        return JSON.stringify(content);
    }
    const object = readObject(original);
    if (!object) {
        return content;
    }
    const data = readObject(object.data);
    if (typeof object.contentSummary === 'string' || readObject(object.contentSummary)) {
        return {
            ...object,
            contentSummary: typeof object.contentSummary === 'string'
                ? JSON.stringify(content)
                : content,
        };
    }
    if (data && (typeof data.contentSummary === 'string' || readObject(data.contentSummary))) {
        return {
            ...object,
            data: {
                ...data,
                contentSummary: typeof data.contentSummary === 'string'
                    ? JSON.stringify(content)
                    : content,
            },
        };
    }
    return {
        ...object,
        ...content,
    };
}
function normalizePinRecord(row, path) {
    const normalized = {
        ...row,
        pinId: normalizeText(row.pinId)
            || normalizeText(row.id)
            || normalizeText(row.pinid)
            || normalizeText(row.PINID),
        path: normalizeText(row.path) || path,
    };
    const timestampMs = readRowTimestampMs(row);
    if (!timestampMs || path !== serviceRefundProtocol_1.SERVICE_REFUND_REQUEST_PATH) {
        return normalized;
    }
    const contentSource = row.content ?? row.payload ?? row.data ?? row;
    const content = readProtocolContentObject(contentSource);
    if (!content) {
        return normalized;
    }
    if (normalizeText(content.requestedAt)
        || normalizeText(content.createdAt)
        || normalizeText(content.failureDetectedAt)) {
        return normalized;
    }
    const contentWithTimestamp = {
        ...content,
        requestedAt: new Date(timestampMs).toISOString(),
    };
    if (row.content !== undefined) {
        normalized.content = writeProtocolContentObject(row.content, contentWithTimestamp);
    }
    else if (row.payload !== undefined) {
        normalized.payload = writeProtocolContentObject(row.payload, contentWithTimestamp);
    }
    else if (row.data !== undefined) {
        normalized.data = writeProtocolContentObject(row.data, contentWithTimestamp);
    }
    else {
        normalized.content = contentWithTimestamp;
    }
    return normalized;
}
function requestedAtMs(entry) {
    const parsed = Date.parse(entry.payload.requestedAt);
    return Number.isNaN(parsed) ? null : parsed;
}
function isParsedRefundRequest(entry) {
    return 'serviceOrderPinId' in entry.payload;
}
function shouldKeepByFilters(entry, options) {
    const buyerGlobalMetaId = normalizeText(options.buyerGlobalMetaId);
    if (buyerGlobalMetaId && normalizeText(entry.payload.buyerGlobalMetaId) !== buyerGlobalMetaId) {
        return false;
    }
    const sellerGlobalMetaId = normalizeText(options.sellerGlobalMetaId);
    if (sellerGlobalMetaId && normalizeText(entry.payload.sellerGlobalMetaId) !== sellerGlobalMetaId) {
        return false;
    }
    if (isParsedRefundRequest(entry) && Number.isFinite(options.sinceMs)) {
        const timestamp = requestedAtMs(entry);
        if (timestamp !== null && timestamp < options.sinceMs) {
            return false;
        }
    }
    return true;
}
async function listProtocolPins(deps, options, path, parsePin) {
    const fetchImpl = getFetchImpl(deps.fetchImpl);
    const chainApiBaseUrl = normalizeBaseUrl(deps.chainApiBaseUrl);
    const pageSize = normalizePositiveInteger(options.pageSize ?? deps.pageSize, DEFAULT_REFUND_CHAIN_PAGE_SIZE);
    const maxPages = normalizePositiveInteger(options.maxPages ?? deps.maxPages, DEFAULT_REFUND_CHAIN_MAX_PAGES);
    const seenCursors = new Set();
    const rows = [];
    let cursor = null;
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
        const url = new URL(`${chainApiBaseUrl}/pin/path/list`);
        url.searchParams.set('path', path);
        url.searchParams.set('size', String(pageSize));
        if (cursor) {
            url.searchParams.set('cursor', cursor);
        }
        const response = await fetchImpl(url.toString());
        if (!response.ok) {
            throw new Error(`service_refund_chain_http_${response.status}`);
        }
        const page = getRefundChainListPage(await response.json());
        for (const row of page.list) {
            const parsed = parsePin(normalizePinRecord(row, path));
            if (parsed && normalizeText(parsed.pinId) && shouldKeepByFilters(parsed, options)) {
                rows.push(parsed);
            }
        }
        if (page.list.length === 0 || !page.nextCursor) {
            break;
        }
        if (seenCursors.has(page.nextCursor)) {
            break;
        }
        seenCursors.add(page.nextCursor);
        cursor = page.nextCursor;
    }
    return rows;
}
function createServiceRefundChainReader(deps) {
    return {
        async listRefundRequests(options = {}) {
            return listProtocolPins(deps, options, serviceRefundProtocol_1.SERVICE_REFUND_REQUEST_PATH, serviceRefundProtocol_1.parseServiceRefundRequestPin);
        },
        async listRefundFinalizations(options = {}) {
            return listProtocolPins(deps, options, serviceRefundProtocol_1.SERVICE_REFUND_FINALIZE_PATH, serviceRefundProtocol_1.parseServiceRefundFinalizePin);
        },
    };
}
