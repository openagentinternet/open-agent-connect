"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectProductDirectory = projectProductDirectory;
exports.listProductDirectory = listProductDirectory;
const serviceDirectory_1 = require("../discovery/serviceDirectory");
const socketPresenceProjection_1 = require("../discovery/socketPresenceProjection");
const productPublishChain_1 = require("./productPublishChain");
const productValidation_1 = require("./productValidation");
const DEFAULT_CHAIN_API_BASE_URL = 'https://manapi.metaid.io';
const DEFAULT_PRODUCT_PAGE_SIZE = 200;
const DEFAULT_PRODUCT_MAX_PAGES = 20;
const DEFAULT_PRODUCT_LIMIT = 20;
const MAX_PRODUCT_LIMIT = 100;
const UNIX_SECONDS_MAX = 10_000_000_000;
function normalizeText(value) {
    if (typeof value === 'string')
        return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    return '';
}
function normalizeNullableText(value) {
    const normalized = normalizeText(value);
    return normalized || null;
}
function normalizeBaseUrl(value) {
    const normalized = normalizeText(value);
    return (normalized || DEFAULT_CHAIN_API_BASE_URL).replace(/\/$/, '');
}
function normalizePositiveInteger(value, fallback, max) {
    if (!Number.isFinite(value))
        return fallback;
    return Math.min(max, Math.max(1, Math.floor(value)));
}
function normalizeTimestampMs(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return 0;
    return parsed < UNIX_SECONDS_MAX ? Math.trunc(parsed * 1000) : Math.trunc(parsed);
}
function parseContentSummary(value) {
    if (typeof value !== 'string')
        return value;
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
function getProductListPage(payload) {
    const root = payload && typeof payload === 'object' ? payload : {};
    const data = root.data && typeof root.data === 'object' ? root.data : {};
    const list = Array.isArray(data.list)
        ? data.list.filter((item) => Boolean(item && typeof item === 'object'))
        : [];
    return {
        list,
        nextCursor: typeof data.nextCursor === 'string' && data.nextCursor.trim() ? data.nextCursor : null,
    };
}
function parseChainProductRow(row) {
    const listingPinId = normalizeText(row.id ?? row.pinId ?? row.pinID);
    const payloadResult = (0, productValidation_1.validateProductListingPayload)(parseContentSummary(row.contentSummary ?? row.content));
    if (!listingPinId || !payloadResult.ok)
        return null;
    return {
        listingPinId,
        payload: payloadResult.value,
        sellerGlobalMetaId: (0, serviceDirectory_1.normalizeComparableGlobalMetaId)(row.globalMetaId
            ?? row.createGlobalMetaId
            ?? row.creatorGlobalMetaId
            ?? row.createMetaId
            ?? row.metaid
            ?? row.createAddress) || null,
        sellerName: normalizeNullableText(row.sellerName
            ?? row.name
            ?? row.userName
            ?? row.displayName
            ?? (row.userInfo && typeof row.userInfo === 'object'
                ? row.userInfo.name
                : undefined)),
        sellerMvcAddress: normalizeNullableText(row.createAddress
            ?? row.creatorAddress
            ?? row.ownerAddress
            ?? row.address
            ?? row.mvcAddress),
        sellerChatPublicKey: normalizeNullableText(row.chatPublicKey
            ?? row.chatpubkey
            ?? row.chat_public_key
            ?? (row.userInfo && typeof row.userInfo === 'object'
                ? row.userInfo.chatPublicKey
                : undefined)),
        updatedAt: normalizeTimestampMs(row.timestamp ?? row.updatedAt ?? row.createdAt) || Date.now(),
    };
}
async function fetchChainProductRows(options) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const chainApiBaseUrl = normalizeBaseUrl(options.chainApiBaseUrl);
    const pageSize = normalizePositiveInteger(options.productPageSize, DEFAULT_PRODUCT_PAGE_SIZE, DEFAULT_PRODUCT_PAGE_SIZE);
    const maxPages = normalizePositiveInteger(options.productMaxPages, DEFAULT_PRODUCT_MAX_PAGES, DEFAULT_PRODUCT_MAX_PAGES);
    const rows = [];
    const seenCursors = new Set();
    let cursor = null;
    for (let page = 0; page < maxPages; page += 1) {
        const url = new URL(`${chainApiBaseUrl}/pin/path/list`);
        url.searchParams.set('path', productPublishChain_1.PRODUCT_LISTING_PROTOCOL_PATH);
        url.searchParams.set('size', String(pageSize));
        if (cursor) {
            url.searchParams.set('cursor', cursor);
        }
        const response = await fetchImpl(url.toString());
        if (!response.ok) {
            throw new Error(`product_directory_http_${response.status}`);
        }
        const payload = await response.json();
        const productPage = getProductListPage(payload);
        rows.push(...productPage.list.map((item) => parseChainProductRow(item)));
        if (!productPage.nextCursor || seenCursors.has(productPage.nextCursor)) {
            break;
        }
        seenCursors.add(productPage.nextCursor);
        cursor = productPage.nextCursor;
    }
    const currentByListingPinId = new Map();
    for (const row of rows) {
        if (!row)
            continue;
        const existing = currentByListingPinId.get(row.listingPinId);
        if (!existing || row.updatedAt >= existing.updatedAt) {
            currentByListingPinId.set(row.listingPinId, row);
        }
    }
    return [...currentByListingPinId.values()]
        .sort((left, right) => right.updatedAt - left.updatedAt || right.listingPinId.localeCompare(left.listingPinId));
}
function fromCacheRecord(record) {
    return {
        listingPinId: record.listingPinId,
        name: record.name,
        title: record.title,
        productType: record.productType,
        skuCount: record.skuCount,
        skus: record.payload.skus,
        fulfillment: record.payload.fulfillment,
        payload: record.payload,
        sellerGlobalMetaId: record.sellerGlobalMetaId,
        sellerName: record.sellerName,
        sellerMvcAddress: record.sellerMvcAddress,
        sellerChatPublicKey: record.sellerChatPublicKey,
        online: record.online,
        cachedAt: record.cachedAt,
    };
}
function fromChainRow(row) {
    return {
        listingPinId: row.listingPinId,
        name: row.payload.name,
        title: row.payload.title,
        productType: row.payload.productType,
        skuCount: row.payload.skus.length,
        skus: row.payload.skus,
        fulfillment: row.payload.fulfillment,
        payload: row.payload,
        sellerGlobalMetaId: row.sellerGlobalMetaId,
        sellerName: row.sellerName,
        sellerMvcAddress: row.sellerMvcAddress,
        sellerChatPublicKey: row.sellerChatPublicKey,
        online: false,
        updatedAt: row.updatedAt,
    };
}
function searchableText(product) {
    return [
        product.name,
        product.title,
        product.payload.description,
        product.sellerName,
        ...product.payload.skus.flatMap((sku) => [
            sku.name,
            sku.description,
            sku.price.currency,
        ]),
    ].filter(Boolean).join(' ').toLowerCase();
}
function projectProductDirectory(input) {
    const query = normalizeText(input.query).toLowerCase();
    const limit = normalizePositiveInteger(input.limit, DEFAULT_PRODUCT_LIMIT, MAX_PRODUCT_LIMIT);
    return input.products
        .filter((product) => input.onlineOnly === true ? product.online : true)
        .filter((product) => query ? searchableText(product).includes(query) : true)
        .slice(0, limit);
}
async function decorateProducts(products, options) {
    if (options.onlineBots) {
        return (0, socketPresenceProjection_1.decorateRecordsWithOnlineBots)({
            records: products.map((product) => ({
                ...product,
                providerGlobalMetaId: product.sellerGlobalMetaId,
            })),
            onlineBots: options.onlineBots,
            onlineOnly: false,
        }).map((product) => {
            const { providerGlobalMetaId: _providerGlobalMetaId, providerName, lastSeenSec: _lastSeenSec, ...rest } = product;
            return {
                ...rest,
                sellerName: rest.sellerName || providerName || null,
            };
        });
    }
    if (options.cached === true && options.onlineOnly !== true) {
        return products;
    }
    return (0, socketPresenceProjection_1.decorateRecordsWithSocketPresence)(products.map((product) => ({
        ...product,
        providerGlobalMetaId: product.sellerGlobalMetaId,
    })), {
        fetchImpl: options.fetchImpl,
        socketPresenceApiBaseUrl: options.socketPresenceApiBaseUrl,
        socketPresenceLimit: options.socketPresenceLimit,
        socketPresenceFailureMode: options.socketPresenceFailureMode,
        onlineOnly: options.onlineOnly === true,
    }).then((decorated) => decorated.map((product) => {
        const { providerGlobalMetaId: _providerGlobalMetaId, providerName, lastSeenSec: _lastSeenSec, ...rest } = product;
        return {
            ...rest,
            sellerName: rest.sellerName || providerName || null,
        };
    }));
}
function cacheUpdatedAt(products) {
    const values = products
        .map((product) => product.cachedAt)
        .filter((value) => typeof value === 'number' && Number.isFinite(value));
    return values.length ? Math.max(...values) : null;
}
async function readCachedProducts(productStateStore) {
    const state = await productStateStore.readState();
    return state.directoryCache.map(fromCacheRecord);
}
async function listProductDirectory(options) {
    const onlineOnly = options.onlineOnly === true;
    let source = options.cached === true ? 'cache' : 'chain';
    let products = [];
    if (options.cached === true) {
        products = await readCachedProducts(options.productStateStore);
    }
    else {
        let decorated = null;
        try {
            const chainRows = await fetchChainProductRows(options);
            decorated = await decorateProducts(chainRows.map(fromChainRow), options);
        }
        catch (error) {
            const cachedProducts = await readCachedProducts(options.productStateStore);
            if (cachedProducts.length === 0) {
                throw error;
            }
            products = cachedProducts;
            source = 'cache';
        }
        if (decorated) {
            const cached = [];
            for (const product of decorated) {
                cached.push(await options.productStateStore.upsertDirectoryItem({
                    listingPinId: product.listingPinId,
                    payload: product.payload,
                    sellerGlobalMetaId: product.sellerGlobalMetaId,
                    sellerName: product.sellerName,
                    sellerMvcAddress: product.sellerMvcAddress,
                    sellerChatPublicKey: product.sellerChatPublicKey,
                    online: product.online,
                    cachedAt: Date.now(),
                }));
            }
            products = cached.map(fromCacheRecord).map((product) => {
                const decoratedProduct = decorated.find((item) => item.listingPinId === product.listingPinId);
                return decoratedProduct ? { ...product, ...decoratedProduct, cachedAt: product.cachedAt } : product;
            });
        }
    }
    const decoratedProducts = source === 'cache'
        ? await decorateProducts(products, { ...options, cached: true })
        : products;
    const filteredProducts = projectProductDirectory({
        products: decoratedProducts,
        onlineOnly,
        query: options.query,
        limit: options.limit,
    });
    return {
        products: filteredProducts,
        total: decoratedProducts
            .filter((product) => onlineOnly ? product.online : true)
            .filter((product) => normalizeText(options.query) ? searchableText(product).includes(normalizeText(options.query).toLowerCase()) : true)
            .length,
        source,
        onlineOnly,
        cacheUpdatedAt: cacheUpdatedAt(products),
    };
}
