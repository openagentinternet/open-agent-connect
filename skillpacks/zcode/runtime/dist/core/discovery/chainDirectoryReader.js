"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readChainDirectoryWithFallback = readChainDirectoryWithFallback;
const chainServiceDirectory_1 = require("./chainServiceDirectory");
const socketPresenceProjection_1 = require("./socketPresenceProjection");
const DEFAULT_CHAIN_API_BASE_URL = 'https://manapi.metaid.io';
function normalizeBaseUrl(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return (normalized || DEFAULT_CHAIN_API_BASE_URL).replace(/\/$/, '');
}
function getFetchImpl(fetchImpl) {
    return fetchImpl ?? fetch;
}
async function fetchServicePages(input) {
    let cursor = null;
    const seenCursors = new Set();
    const rows = [];
    for (let page = 0; page < input.serviceMaxPages; page += 1) {
        const url = new URL(`${input.chainApiBaseUrl}/pin/path/list`);
        url.searchParams.set('path', chainServiceDirectory_1.CHAIN_SERVICE_PROTOCOL_PATH);
        url.searchParams.set('size', String(input.servicePageSize));
        if (cursor) {
            url.searchParams.set('cursor', cursor);
        }
        const response = await input.fetchImpl(url.toString());
        if (!response.ok) {
            throw new Error(`chain_directory_http_${response.status}`);
        }
        const payload = await response.json();
        if (page === 0 && (0, chainServiceDirectory_1.isChainServiceListSemanticMiss)(payload)) {
            throw new Error('chain_directory_semantic_miss');
        }
        const servicePage = (0, chainServiceDirectory_1.getChainServiceListPage)(payload);
        rows.push(...servicePage.list.map((item) => (0, chainServiceDirectory_1.parseChainServiceItem)(item)));
        if (!servicePage.nextCursor || seenCursors.has(servicePage.nextCursor)) {
            break;
        }
        seenCursors.add(servicePage.nextCursor);
        cursor = servicePage.nextCursor;
    }
    return (0, chainServiceDirectory_1.resolveCurrentChainServices)(rows);
}
async function readChainDirectoryWithFallback(options) {
    const fetchImpl = getFetchImpl(options.fetchImpl);
    const chainApiBaseUrl = normalizeBaseUrl(options.chainApiBaseUrl);
    const servicePageSize = Number.isFinite(options.servicePageSize)
        ? Math.max(1, Math.floor(options.servicePageSize))
        : chainServiceDirectory_1.DEFAULT_CHAIN_SERVICE_PAGE_SIZE;
    const serviceMaxPages = Number.isFinite(options.serviceMaxPages)
        ? Math.max(1, Math.floor(options.serviceMaxPages))
        : chainServiceDirectory_1.DEFAULT_CHAIN_SERVICE_MAX_PAGES;
    let source = 'chain';
    let fallbackUsed = false;
    let services;
    try {
        services = await fetchServicePages({
            fetchImpl,
            chainApiBaseUrl,
            servicePageSize,
            serviceMaxPages,
        });
    }
    catch {
        source = 'seeded';
        fallbackUsed = true;
        services = await options.fetchSeededDirectoryServices();
    }
    const decoratedServices = await (0, socketPresenceProjection_1.decorateRecordsWithSocketPresence)(services.map((service) => ({ ...service })), {
        fetchImpl,
        socketPresenceApiBaseUrl: options.socketPresenceApiBaseUrl,
        socketPresenceLimit: options.socketPresenceLimit,
        socketPresenceFailureMode: options.socketPresenceFailureMode,
        onlineOnly: options.onlineOnly === true,
    });
    return {
        services: decoratedServices,
        source,
        fallbackUsed,
    };
}
