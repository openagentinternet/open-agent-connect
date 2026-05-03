"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_ONLINE_SERVICE_CACHE_SYNC_INTERVAL_MS = exports.ONLINE_SERVICE_CACHE_LIMIT = void 0;
exports.buildOnlineServiceCacheState = buildOnlineServiceCacheState;
exports.createOnlineServiceCacheStore = createOnlineServiceCacheStore;
exports.searchOnlineServiceCacheServices = searchOnlineServiceCacheServices;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../state/paths");
exports.ONLINE_SERVICE_CACHE_LIMIT = 1000;
exports.DEFAULT_ONLINE_SERVICE_CACHE_SYNC_INTERVAL_MS = 10 * 60 * 1000;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}
function normalizeComparable(value) {
    return normalizeText(value).toLowerCase();
}
function normalizeNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function normalizeInteger(value) {
    const parsed = normalizeNumber(value);
    return parsed === null ? null : Math.trunc(parsed);
}
function normalizeLimit(value) {
    const parsed = normalizeInteger(value);
    if (parsed === null) {
        return exports.ONLINE_SERVICE_CACHE_LIMIT;
    }
    return Math.max(1, Math.min(exports.ONLINE_SERVICE_CACHE_LIMIT, parsed));
}
function uniqueTexts(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
        const normalized = normalizeText(value);
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}
function normalizeNullableText(value) {
    return normalizeText(value) || null;
}
function normalizeBoolean(value, fallback = false) {
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
    return fallback;
}
function compareCacheEntries(left, right) {
    if (left.online !== right.online) {
        return left.online ? -1 : 1;
    }
    if ((right.ratingAvg ?? -1) !== (left.ratingAvg ?? -1)) {
        return (right.ratingAvg ?? -1) - (left.ratingAvg ?? -1);
    }
    if (right.ratingCount !== left.ratingCount) {
        return right.ratingCount - left.ratingCount;
    }
    if (right.updatedAt !== left.updatedAt) {
        return right.updatedAt - left.updatedAt;
    }
    return left.servicePinId.localeCompare(right.servicePinId);
}
function buildRatingAggregate(service, ratingDetails) {
    const serviceIds = new Set(uniqueTexts([
        service.servicePinId,
        service.pinId,
        service.sourceServicePinId,
        ...(Array.isArray(service.chainPinIds) ? service.chainPinIds : []),
    ]));
    let sum = 0;
    let count = 0;
    for (const rating of ratingDetails ?? []) {
        if (!serviceIds.has(normalizeText(rating.serviceId))) {
            continue;
        }
        const rate = normalizeNumber(rating.rate);
        if (rate === null || rate < 1 || rate > 5) {
            continue;
        }
        sum += rate;
        count += 1;
    }
    if (count > 0) {
        return {
            ratingAvg: sum / count,
            ratingCount: count,
        };
    }
    const existingAvg = normalizeNumber(service.ratingAvg ?? service.rating_avg);
    const existingCount = normalizeInteger(service.ratingCount ?? service.rating_count) ?? 0;
    return {
        ratingAvg: existingCount > 0 && existingAvg !== null ? existingAvg : null,
        ratingCount: Math.max(0, existingCount),
    };
}
function normalizeCacheEntry(service, ratingDetails, cachedAt) {
    const servicePinId = normalizeText(service.servicePinId ?? service.pinId);
    const providerGlobalMetaId = normalizeText(service.providerGlobalMetaId ?? service.globalMetaId);
    const serviceName = normalizeText(service.serviceName) || servicePinId;
    if (!servicePinId || !providerGlobalMetaId || !serviceName) {
        return null;
    }
    const sourceServicePinId = normalizeText(service.sourceServicePinId) || servicePinId;
    const chainPinIds = uniqueTexts([
        ...(Array.isArray(service.chainPinIds) ? service.chainPinIds : []),
        sourceServicePinId,
        servicePinId,
    ]);
    const rating = buildRatingAggregate(service, ratingDetails);
    const updatedAt = normalizeInteger(service.updatedAt ?? service.updated_at) ?? cachedAt;
    return {
        servicePinId,
        sourceServicePinId,
        chainPinIds,
        providerGlobalMetaId,
        providerMetaId: normalizeNullableText(service.providerMetaId ?? service.metaid),
        providerAddress: normalizeNullableText(service.providerAddress ?? service.createAddress ?? service.address),
        providerName: normalizeNullableText(service.providerName ?? service.providerMetaBot),
        providerSkill: normalizeNullableText(service.providerSkill),
        providerDaemonBaseUrl: normalizeNullableText(service.providerDaemonBaseUrl),
        providerChatPublicKey: normalizeNullableText(service.providerChatPublicKey ?? service.chatPublicKey),
        serviceName,
        displayName: normalizeText(service.displayName) || serviceName,
        description: normalizeText(service.description),
        price: normalizeText(service.price),
        currency: normalizeText(service.currency),
        serviceIcon: normalizeNullableText(service.serviceIcon),
        skillDocument: normalizeNullableText(service.skillDocument),
        inputType: normalizeNullableText(service.inputType),
        outputType: normalizeNullableText(service.outputType),
        endpoint: normalizeNullableText(service.endpoint),
        paymentAddress: normalizeNullableText(service.paymentAddress),
        available: normalizeBoolean(service.available, true),
        online: normalizeBoolean(service.online, false),
        lastSeenSec: normalizeInteger(service.lastSeenSec),
        lastSeenAt: normalizeInteger(service.lastSeenAt),
        lastSeenAgoSeconds: normalizeInteger(service.lastSeenAgoSeconds),
        updatedAt,
        ratingAvg: rating.ratingAvg,
        ratingCount: rating.ratingCount,
        cachedAt,
    };
}
function createEmptyState() {
    return {
        version: 1,
        services: [],
        totalServices: 0,
        limit: exports.ONLINE_SERVICE_CACHE_LIMIT,
        discoverySource: 'cache',
        fallbackUsed: false,
        lastSyncedAt: null,
        lastError: null,
    };
}
function normalizeCacheState(value) {
    if (!value || typeof value !== 'object') {
        return createEmptyState();
    }
    const cachedAt = normalizeInteger(value.lastSyncedAt) ?? Date.now();
    const services = Array.isArray(value.services)
        ? value.services
            .map((service) => normalizeCacheEntry(service, undefined, cachedAt))
            .filter((service) => service !== null)
            .sort(compareCacheEntries)
            .slice(0, normalizeLimit(value.limit))
        : [];
    const source = value.discoverySource === 'chain' || value.discoverySource === 'seeded' || value.discoverySource === 'cache'
        ? value.discoverySource
        : 'cache';
    return {
        version: 1,
        services,
        totalServices: services.length,
        limit: normalizeLimit(value.limit),
        discoverySource: source,
        fallbackUsed: normalizeBoolean(value.fallbackUsed, false),
        lastSyncedAt: normalizeInteger(value.lastSyncedAt),
        lastError: normalizeNullableText(value.lastError),
    };
}
async function readJsonFile(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    }
    catch (error) {
        if (error instanceof SyntaxError) {
            return null;
        }
        const code = error.code;
        if (code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
function resolvePaths(homeDirOrPaths) {
    const metabotPaths = typeof homeDirOrPaths === 'string'
        ? (0, paths_1.resolveMetabotPaths)(homeDirOrPaths)
        : homeDirOrPaths;
    const servicesRoot = node_path_1.default.join(metabotPaths.metabotRoot, 'services');
    return {
        servicesRoot,
        servicesPath: node_path_1.default.join(servicesRoot, 'services.json'),
    };
}
function buildOnlineServiceCacheState(input) {
    const cachedAt = Math.trunc((input.now ?? Date.now)());
    const limit = normalizeLimit(input.limit);
    const services = input.services
        .map((service) => normalizeCacheEntry(service, input.ratingDetails, cachedAt))
        .filter((service) => service !== null)
        .sort(compareCacheEntries)
        .slice(0, limit);
    return {
        version: 1,
        services,
        totalServices: services.length,
        limit,
        discoverySource: input.discoverySource,
        fallbackUsed: input.fallbackUsed,
        lastSyncedAt: cachedAt,
        lastError: normalizeNullableText(input.lastError),
    };
}
function createOnlineServiceCacheStore(homeDirOrPaths) {
    const paths = resolvePaths(homeDirOrPaths);
    return {
        paths,
        async ensureLayout() {
            await node_fs_1.promises.mkdir(paths.servicesRoot, { recursive: true });
            return paths;
        },
        async read() {
            await this.ensureLayout();
            return normalizeCacheState(await readJsonFile(paths.servicesPath));
        },
        async write(nextState) {
            await this.ensureLayout();
            const normalized = normalizeCacheState(nextState);
            await node_fs_1.promises.writeFile(paths.servicesPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
            return normalized;
        },
        async update(updater) {
            const currentState = await this.read();
            const nextState = await updater(currentState);
            return this.write(nextState);
        },
    };
}
function tokenizeQuery(value) {
    return uniqueTexts(value
        .toLowerCase()
        .split(/[\s,.;:!?()[\]{}"'`|/\\，。！？；：（）【】《》、]+/u)
        .filter((token) => token.length > 0));
}
function scoreTextField(input) {
    const field = normalizeComparable(input.field);
    if (!field) {
        return 0;
    }
    let score = 0;
    if (field === input.query) {
        score += input.exactWeight * 2;
    }
    else if (field.includes(input.query) || input.query.includes(field)) {
        score += input.exactWeight;
    }
    for (const token of input.tokens) {
        if (field.includes(token)) {
            score += input.tokenWeight;
        }
    }
    return score;
}
function parsePrice(value) {
    const text = normalizeText(value);
    if (!text) {
        return 0;
    }
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
}
function scoreServiceForQuery(service, query) {
    if (!query) {
        return 0;
    }
    const tokens = tokenizeQuery(query);
    let score = 0;
    score += scoreTextField({ query, tokens, field: service.displayName, exactWeight: 80, tokenWeight: 16 });
    score += scoreTextField({ query, tokens, field: service.serviceName, exactWeight: 50, tokenWeight: 10 });
    score += scoreTextField({ query, tokens, field: service.description, exactWeight: 40, tokenWeight: 8 });
    score += scoreTextField({ query, tokens, field: service.providerSkill, exactWeight: 30, tokenWeight: 6 });
    score += scoreTextField({ query, tokens, field: service.providerName, exactWeight: 20, tokenWeight: 4 });
    return score;
}
function searchOnlineServiceCacheServices(services, options = {}) {
    const query = normalizeComparable(options.query);
    const limit = options.limit == null ? null : Math.max(1, Math.trunc(Number(options.limit)));
    const currency = normalizeComparable(options.currency);
    const maxPrice = options.maxPrice == null ? null : parsePrice(options.maxPrice);
    const minRating = options.minRating == null ? null : normalizeNumber(options.minRating);
    const ranked = services
        .filter((service) => {
        if (options.onlineOnly === true && !service.online) {
            return false;
        }
        if (!service.available) {
            return false;
        }
        if (currency && normalizeComparable(service.currency) !== currency) {
            return false;
        }
        if (maxPrice !== null) {
            const servicePrice = parsePrice(service.price);
            if (servicePrice === null || servicePrice > maxPrice) {
                return false;
            }
        }
        if (minRating !== null && (service.ratingAvg ?? 0) < minRating) {
            return false;
        }
        return true;
    })
        .map((service) => {
        const queryScore = scoreServiceForQuery(service, query);
        return {
            service,
            score: queryScore
                + (service.online ? 20 : 0)
                + (service.ratingAvg ?? 0)
                + Math.log1p(service.ratingCount),
        };
    })
        .filter((entry) => !query || entry.score > (entry.service.online ? 20 : 0))
        .sort((left, right) => {
        if (right.score !== left.score) {
            return right.score - left.score;
        }
        return compareCacheEntries(left.service, right.service);
    })
        .map((entry) => entry.service);
    return limit === null ? ranked : ranked.slice(0, limit);
}
