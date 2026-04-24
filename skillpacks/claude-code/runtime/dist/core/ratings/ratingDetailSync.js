"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CHAIN_SERVICE_RATING_MAX_PAGES = exports.DEFAULT_CHAIN_SERVICE_RATING_PAGE_SIZE = exports.CHAIN_SERVICE_RATING_PROTOCOL_PATH = void 0;
exports.getRatingDetailListPage = getRatingDetailListPage;
exports.parseRatingDetailItem = parseRatingDetailItem;
exports.fetchRatingDetailPageFromChain = fetchRatingDetailPageFromChain;
exports.findRatingDetailByServicePayment = findRatingDetailByServicePayment;
exports.refreshRatingDetailCache = refreshRatingDetailCache;
exports.refreshRatingDetailCacheFromChain = refreshRatingDetailCacheFromChain;
const DEFAULT_CHAIN_API_BASE_URL = 'https://manapi.metaid.io';
const UNIX_SECONDS_MAX = 10_000_000_000;
exports.CHAIN_SERVICE_RATING_PROTOCOL_PATH = '/protocols/skill-service-rate';
exports.DEFAULT_CHAIN_SERVICE_RATING_PAGE_SIZE = 200;
exports.DEFAULT_CHAIN_SERVICE_RATING_MAX_PAGES = 20;
function toSafeString(value) {
    if (typeof value === 'string')
        return value.trim();
    if (value == null)
        return '';
    return String(value).trim();
}
function normalizeNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function normalizeTimestampMs(value, fallbackNow) {
    const parsed = normalizeNumber(value);
    if (parsed === null || parsed <= 0) {
        return fallbackNow();
    }
    return parsed < UNIX_SECONDS_MAX ? Math.trunc(parsed * 1000) : Math.trunc(parsed);
}
function parseContentSummary(value) {
    if (!value)
        return null;
    if (typeof value === 'object' && !Array.isArray(value)) {
        return value;
    }
    if (typeof value !== 'string') {
        return null;
    }
    try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    }
    catch {
        return null;
    }
    return null;
}
function normalizeBaseUrl(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return (normalized || DEFAULT_CHAIN_API_BASE_URL).replace(/\/$/, '');
}
function getFetchImpl(fetchImpl) {
    return fetchImpl ?? fetch;
}
function sortRatingItemsDesc(left, right) {
    const leftCreatedAt = Number.isFinite(left.createdAt) ? Number(left.createdAt) : 0;
    const rightCreatedAt = Number.isFinite(right.createdAt) ? Number(right.createdAt) : 0;
    if (leftCreatedAt !== rightCreatedAt) {
        return rightCreatedAt - leftCreatedAt;
    }
    return right.pinId.localeCompare(left.pinId);
}
function normalizeMaxPages(value) {
    return Number.isFinite(value)
        ? Math.max(1, Math.floor(value))
        : exports.DEFAULT_CHAIN_SERVICE_RATING_MAX_PAGES;
}
function normalizePageSize(value) {
    return Number.isFinite(value)
        ? Math.max(1, Math.floor(value))
        : exports.DEFAULT_CHAIN_SERVICE_RATING_PAGE_SIZE;
}
function getRatingDetailListPage(payload) {
    const data = payload && typeof payload === 'object'
        ? payload.data
        : undefined;
    return {
        list: Array.isArray(data?.list)
            ? data.list.filter((entry) => Boolean(entry && typeof entry === 'object'))
            : [],
        nextCursor: typeof data?.nextCursor === 'string' ? data.nextCursor : null,
    };
}
function parseRatingDetailItem(item, options = {}) {
    const pinId = toSafeString(item.id);
    if (!pinId) {
        return null;
    }
    const summary = parseContentSummary(item.contentSummary);
    if (!summary) {
        return null;
    }
    const serviceId = toSafeString(summary.serviceID);
    const rateValue = summary.rate;
    const rate = typeof rateValue === 'number'
        ? rateValue
        : typeof rateValue === 'string'
            ? Number.parseFloat(rateValue)
            : Number.NaN;
    if (!serviceId || !Number.isFinite(rate) || rate < 1 || rate > 5) {
        return null;
    }
    const now = options.now ?? Date.now;
    const comment = toSafeString(summary.comment) || null;
    return {
        pinId,
        serviceId,
        servicePaidTx: toSafeString(summary.servicePaidTx) || null,
        rate,
        comment,
        raterGlobalMetaId: toSafeString(item.globalMetaId) || null,
        raterMetaId: toSafeString(item.metaid) || toSafeString(item.createMetaId) || null,
        createdAt: normalizeTimestampMs(item.timestamp, now),
    };
}
async function fetchRatingDetailPageFromChain(input, cursor) {
    const url = new URL(`${normalizeBaseUrl(input.chainApiBaseUrl)}/pin/path/list`);
    url.searchParams.set('path', exports.CHAIN_SERVICE_RATING_PROTOCOL_PATH);
    url.searchParams.set('size', String(normalizePageSize(input.pageSize)));
    if (typeof cursor === 'string' && cursor.trim()) {
        url.searchParams.set('cursor', cursor.trim());
    }
    const response = await getFetchImpl(input.fetchImpl)(url.toString());
    if (!response.ok) {
        throw new Error(`rating_detail_http_${response.status}`);
    }
    return getRatingDetailListPage(await response.json());
}
function findRatingDetailByServicePayment(source, lookup) {
    const serviceId = toSafeString(lookup.serviceId);
    const servicePaidTx = toSafeString(lookup.servicePaidTx);
    if (!serviceId || !servicePaidTx) {
        return null;
    }
    const items = Array.isArray(source) ? source : source.items;
    return items.find((item) => (toSafeString(item.serviceId) === serviceId
        && toSafeString(item.servicePaidTx) === servicePaidTx)) ?? null;
}
async function refreshRatingDetailCache(input) {
    const now = input.now ?? Date.now;
    const maxPages = normalizeMaxPages(input.maxPages);
    const currentState = await input.store.read();
    const items = [...currentState.items];
    const seenPinIds = new Set(items.map((item) => item.pinId));
    const currentLatestPinId = toSafeString(currentState.latestPinId) || null;
    let insertedCount = 0;
    let newestPinId = null;
    let hitLatestPinId = currentLatestPinId === null;
    let headNextCursor = null;
    let pagesRemaining = maxPages;
    let cursor;
    while (pagesRemaining > 0) {
        const page = await input.fetchPage(cursor);
        pagesRemaining -= 1;
        headNextCursor = page.nextCursor ?? null;
        let stopAtLatest = false;
        for (const rawItem of page.list) {
            const rawPinId = toSafeString(rawItem.id);
            if (currentLatestPinId && rawPinId === currentLatestPinId) {
                hitLatestPinId = true;
                stopAtLatest = true;
                break;
            }
            const parsed = parseRatingDetailItem(rawItem, { now });
            if (!parsed) {
                continue;
            }
            if (!newestPinId) {
                newestPinId = parsed.pinId;
            }
            if (seenPinIds.has(parsed.pinId)) {
                continue;
            }
            seenPinIds.add(parsed.pinId);
            items.push(parsed);
            insertedCount += 1;
        }
        if (stopAtLatest || !page.nextCursor || currentLatestPinId === null && pagesRemaining <= 0) {
            break;
        }
        cursor = page.nextCursor ?? undefined;
    }
    let backfillCursor = currentState.backfillCursor;
    if (currentLatestPinId === null) {
        backfillCursor = headNextCursor;
    }
    else if (hitLatestPinId) {
        let nextBackfillCursor = currentState.backfillCursor;
        while (pagesRemaining > 0 && nextBackfillCursor) {
            const page = await input.fetchPage(nextBackfillCursor);
            pagesRemaining -= 1;
            nextBackfillCursor = page.nextCursor ?? null;
            for (const rawItem of page.list) {
                const parsed = parseRatingDetailItem(rawItem, { now });
                if (!parsed || seenPinIds.has(parsed.pinId)) {
                    continue;
                }
                seenPinIds.add(parsed.pinId);
                items.push(parsed);
                insertedCount += 1;
            }
        }
        backfillCursor = nextBackfillCursor;
    }
    const nextState = {
        items: items.sort(sortRatingItemsDesc),
        latestPinId: hitLatestPinId && newestPinId
            ? newestPinId
            : currentLatestPinId,
        backfillCursor: backfillCursor ? toSafeString(backfillCursor) || null : null,
        lastSyncedAt: now(),
    };
    const persistedState = await input.store.write(nextState);
    return {
        state: persistedState,
        insertedCount,
        newestPinId,
        hitLatestPinId,
    };
}
async function refreshRatingDetailCacheFromChain(input) {
    return refreshRatingDetailCache({
        store: input.store,
        maxPages: input.maxPages,
        now: input.now,
        fetchPage: (cursor) => fetchRatingDetailPageFromChain({
            chainApiBaseUrl: input.chainApiBaseUrl,
            fetchImpl: input.fetchImpl,
            pageSize: input.pageSize,
        }, cursor),
    });
}
