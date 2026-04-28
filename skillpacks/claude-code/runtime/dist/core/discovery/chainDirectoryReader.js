"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readChainDirectoryWithFallback = readChainDirectoryWithFallback;
const chainServiceDirectory_1 = require("./chainServiceDirectory");
const socketPresenceDirectory_1 = require("./socketPresenceDirectory");
const serviceDirectory_1 = require("./serviceDirectory");
const DEFAULT_CHAIN_API_BASE_URL = 'https://manapi.metaid.io';
const DEFAULT_SOCKET_PRESENCE_LIMIT = 100;
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
function normalizeSocketPresenceLimit(value) {
    if (!Number.isFinite(value)) {
        return DEFAULT_SOCKET_PRESENCE_LIMIT;
    }
    return Math.min(DEFAULT_SOCKET_PRESENCE_LIMIT, Math.max(1, Math.floor(value)));
}
function normalizeLastSeenSec(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return null;
    }
    if (value > 1e12) {
        return Math.floor(value / 1000);
    }
    return Math.floor(value);
}
function buildOnlineMetaBotIndex(bots) {
    const index = new Map();
    for (const bot of bots) {
        const globalMetaId = (0, serviceDirectory_1.normalizeComparableGlobalMetaId)(bot.globalMetaId);
        if (!globalMetaId || index.has(globalMetaId)) {
            continue;
        }
        index.set(globalMetaId, bot);
    }
    return index;
}
function buildSyntheticOnlineBotsFromServices(services) {
    const nowMs = Date.now();
    const seen = new Set();
    const bots = [];
    for (const service of services) {
        const globalMetaId = (0, serviceDirectory_1.normalizeComparableGlobalMetaId)(service.providerGlobalMetaId ?? service.globalMetaId);
        if (!globalMetaId || seen.has(globalMetaId)) {
            continue;
        }
        seen.add(globalMetaId);
        bots.push({
            globalMetaId,
            lastSeenAt: nowMs,
            lastSeenAgoSeconds: 0,
            deviceCount: 1,
            online: true,
            name: '',
            goal: '',
        });
    }
    return bots;
}
function decorateServicesWithSocketPresence(input) {
    const onlineIndex = buildOnlineMetaBotIndex(input.onlineBots);
    const decorated = input.services.map((service) => {
        const serviceRecord = service;
        const globalMetaId = (0, serviceDirectory_1.normalizeComparableGlobalMetaId)(serviceRecord.providerGlobalMetaId ?? serviceRecord.globalMetaId);
        const onlineBot = globalMetaId ? onlineIndex.get(globalMetaId) : undefined;
        const lastSeenAt = typeof onlineBot?.lastSeenAt === 'number' && Number.isFinite(onlineBot.lastSeenAt)
            ? Math.max(0, Math.floor(onlineBot.lastSeenAt))
            : null;
        return {
            ...service,
            online: Boolean(onlineBot),
            lastSeenSec: normalizeLastSeenSec(lastSeenAt),
            lastSeenAt,
        };
    });
    if (input.onlineOnly) {
        return decorated.filter((service) => service.online);
    }
    return decorated;
}
async function applySocketPresenceToServices(input) {
    let onlineBots = [];
    try {
        const onlineDirectory = await (0, socketPresenceDirectory_1.readOnlineMetaBotsFromSocketPresence)({
            fetchImpl: input.fetchImpl,
            apiBaseUrl: input.socketPresenceApiBaseUrl,
            limit: input.socketPresenceLimit,
        });
        onlineBots = onlineDirectory.bots;
    }
    catch (error) {
        if (input.socketPresenceFailureMode === 'assume_service_providers_online') {
            onlineBots = buildSyntheticOnlineBotsFromServices(input.services.map((service) => ({ ...service })));
        }
        else if (input.onlineOnly) {
            throw error;
        }
    }
    return decorateServicesWithSocketPresence({
        services: input.services,
        onlineBots,
        onlineOnly: input.onlineOnly,
    });
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
    const socketPresenceLimit = normalizeSocketPresenceLimit(options.socketPresenceLimit);
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
    const decoratedServices = await applySocketPresenceToServices({
        services: services.map((service) => ({ ...service })),
        fetchImpl,
        socketPresenceApiBaseUrl: options.socketPresenceApiBaseUrl,
        socketPresenceLimit,
        socketPresenceFailureMode: options.socketPresenceFailureMode,
        onlineOnly: options.onlineOnly === true,
    });
    return {
        services: decoratedServices,
        source,
        fallbackUsed,
    };
}
