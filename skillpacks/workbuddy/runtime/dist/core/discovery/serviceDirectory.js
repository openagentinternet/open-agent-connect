"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPresenceSnapshot = exports.buildProviderGroups = exports.serializeDiscoverySnapshot = exports.cloneDiscoverySnapshot = exports.cloneProviderState = exports.buildProviderKey = exports.resolveServiceProviderAddress = exports.resolveServiceGlobalMetaId = exports.normalizeComparableGlobalMetaId = void 0;
const deriveIdentity_1 = require("../identity/deriveIdentity");
const toSafeString = (value) => {
    if (typeof value === 'string')
        return value.trim();
    if (value == null)
        return '';
    return String(value).trim();
};
const normalizeComparableGlobalMetaId = (value) => {
    return (0, deriveIdentity_1.normalizeGlobalMetaId)(value) ?? toSafeString(value);
};
exports.normalizeComparableGlobalMetaId = normalizeComparableGlobalMetaId;
const resolveServiceGlobalMetaId = (service) => {
    return (0, exports.normalizeComparableGlobalMetaId)(service?.providerGlobalMetaId || service?.globalMetaId);
};
exports.resolveServiceGlobalMetaId = resolveServiceGlobalMetaId;
const resolveServiceProviderAddress = (service) => {
    return toSafeString(service?.providerAddress || service?.createAddress || service?.address);
};
exports.resolveServiceProviderAddress = resolveServiceProviderAddress;
const buildProviderKey = (globalMetaId, address) => {
    return `${globalMetaId}::${address}`;
};
exports.buildProviderKey = buildProviderKey;
const cloneProviderState = (state) => ({ ...state });
exports.cloneProviderState = cloneProviderState;
const cloneDiscoverySnapshot = (snapshot) => ({
    onlineBots: { ...snapshot.onlineBots },
    availableServices: snapshot.availableServices.map((service) => ({ ...service })),
    providers: Object.fromEntries(Object.entries(snapshot.providers).map(([key, state]) => [key, (0, exports.cloneProviderState)(state)]))
});
exports.cloneDiscoverySnapshot = cloneDiscoverySnapshot;
const normalizeForComparison = (value) => {
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeForComparison(entry));
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    return Object.fromEntries(Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, normalizeForComparison(nestedValue)]));
};
const serializeDiscoverySnapshot = (snapshot) => {
    return JSON.stringify(normalizeForComparison(snapshot));
};
exports.serializeDiscoverySnapshot = serializeDiscoverySnapshot;
const resolvePresenceCheckAtSec = (presence, fallbackNowSec) => {
    return typeof presence.nowSec === 'number' && Number.isFinite(presence.nowSec)
        ? presence.nowSec
        : fallbackNowSec;
};
const buildProviderGroups = (services) => {
    const groups = new Map();
    for (const service of services) {
        const status = Number(service?.status ?? 0);
        if (Number.isFinite(status) && status < 0) {
            continue;
        }
        const available = Number(service?.available ?? 1);
        if (Number.isFinite(available) && available === 0) {
            continue;
        }
        const globalMetaId = (0, exports.resolveServiceGlobalMetaId)(service);
        const address = (0, exports.resolveServiceProviderAddress)(service);
        if (!address) {
            continue;
        }
        const key = (0, exports.buildProviderKey)(globalMetaId, address);
        const existing = groups.get(key);
        if (existing) {
            existing.services.push(service);
            continue;
        }
        groups.set(key, {
            key,
            globalMetaId,
            address,
            services: [service]
        });
    }
    return [...groups.values()];
};
exports.buildProviderGroups = buildProviderGroups;
const buildPresenceSnapshot = (services, presence, fallbackNowSec, forcedOfflineGlobalMetaIds) => {
    const onlineBots = Object.fromEntries(Object.entries(presence.onlineBots)
        .filter(([globalMetaId]) => !forcedOfflineGlobalMetaIds.has(globalMetaId))
        .map(([globalMetaId, state]) => [globalMetaId, state.lastSeenSec]));
    const availableServices = [];
    const providers = {};
    const lastCheckAt = resolvePresenceCheckAtSec(presence, fallbackNowSec);
    for (const group of (0, exports.buildProviderGroups)(services)) {
        const forcedOffline = Boolean(group.globalMetaId) && forcedOfflineGlobalMetaIds.has(group.globalMetaId);
        const presenceState = !forcedOffline && group.globalMetaId ? presence.onlineBots[group.globalMetaId] : undefined;
        const online = Boolean(presenceState);
        providers[group.key] = {
            key: group.key,
            globalMetaId: group.globalMetaId,
            address: group.address,
            lastSeenSec: presenceState?.lastSeenSec ?? null,
            lastCheckAt,
            lastSource: 'presence',
            lastError: forcedOffline ? 'locally_disabled' : null,
            online,
            optimisticLocal: false
        };
        if (online) {
            availableServices.push(...group.services);
        }
    }
    return {
        onlineBots,
        availableServices,
        providers
    };
};
exports.buildPresenceSnapshot = buildPresenceSnapshot;
