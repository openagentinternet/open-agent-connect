"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PresenceRegistry = void 0;
const serviceDirectory_1 = require("./serviceDirectory");
const HEARTBEAT_ONLINE_WINDOW_SEC = 10 * 60;
const HEARTBEAT_POLL_INTERVAL_MS = 60 * 1000;
const HEARTBEAT_FETCH_CONCURRENCY = 6;
const toSafeString = (value) => {
    if (typeof value === 'string')
        return value.trim();
    if (value == null)
        return '';
    return String(value).trim();
};
const toNumberOrNull = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};
const pickLatestTimestamp = (...values) => {
    let latest = null;
    for (const value of values) {
        if (typeof value !== 'number' || !Number.isFinite(value))
            continue;
        if (latest == null || value > latest) {
            latest = value;
        }
    }
    return latest;
};
const normalizeHeartbeatSource = (value) => {
    const normalized = toSafeString(value);
    return normalized || null;
};
class PresenceRegistry {
    deps;
    _onlineBots = new Map();
    _availableServices = [];
    _providerStates = new Map();
    _localHeartbeatsByAddress = new Map();
    _forcedOfflineGlobalMetaIds = new Set();
    _listeners = new Set();
    _intervalId = null;
    _getServices = null;
    _pollPromise = null;
    _pendingRefresh = false;
    constructor(deps) {
        this.deps = deps;
    }
    get onlineBots() {
        return this._onlineBots;
    }
    get availableServices() {
        return this._availableServices;
    }
    get providerStates() {
        return this._providerStates;
    }
    getDiscoverySnapshot() {
        return (0, serviceDirectory_1.cloneDiscoverySnapshot)({
            onlineBots: Object.fromEntries(this._onlineBots),
            availableServices: this._availableServices,
            providers: Object.fromEntries([...this._providerStates.entries()].map(([key, state]) => [key, { ...state }]))
        });
    }
    subscribe(listener) {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }
    checkOnlineStatus(timestampSec) {
        if (timestampSec == null)
            return false;
        const nowSec = Math.floor(this.nowMs() / 1000);
        return nowSec - timestampSec <= HEARTBEAT_ONLINE_WINDOW_SEC;
    }
    recordLocalHeartbeat(input) {
        const address = toSafeString(input.address);
        if (!address)
            return;
        const timestampSec = toNumberOrNull(input.timestampSec) ?? Math.floor(this.nowMs() / 1000);
        this._localHeartbeatsByAddress.set(address, {
            globalMetaId: (0, serviceDirectory_1.normalizeComparableGlobalMetaId)(input.globalMetaId),
            lastSeenSec: timestampSec
        });
    }
    async pollAll(services) {
        const providerGroups = (0, serviceDirectory_1.buildProviderGroups)(services);
        const results = await this.mapWithConcurrency(providerGroups, HEARTBEAT_FETCH_CONCURRENCY, async (group) => this.evaluateProviderGroup(group));
        const nextOnlineBots = new Map();
        const nextAvailableServices = [];
        const nextProviderStates = new Map();
        for (const result of results) {
            nextProviderStates.set(result.state.key, result.state);
            if (!result.state.online)
                continue;
            if (result.state.globalMetaId && result.state.lastSeenSec != null) {
                const existing = nextOnlineBots.get(result.state.globalMetaId);
                if (existing == null || result.state.lastSeenSec > existing) {
                    nextOnlineBots.set(result.state.globalMetaId, result.state.lastSeenSec);
                }
            }
            nextAvailableServices.push(...result.services);
        }
        this._onlineBots = nextOnlineBots;
        this._availableServices = nextAvailableServices;
        this._providerStates = nextProviderStates;
        this.emitChange();
    }
    startPolling(getServices) {
        this.stopPolling();
        this._getServices = getServices;
        void this.refreshNow().catch((err) => {
            console.warn('[PresenceRegistry] initial poll error:', err);
        });
        this._intervalId = setInterval(() => {
            void this.refreshNow().catch((err) => {
                console.warn('[PresenceRegistry] interval poll error:', err);
            });
        }, HEARTBEAT_POLL_INTERVAL_MS);
    }
    async refreshNow() {
        if (!this._getServices) {
            return;
        }
        if (this._pollPromise) {
            this._pendingRefresh = true;
            return this._pollPromise;
        }
        this._pollPromise = (async () => {
            do {
                this._pendingRefresh = false;
                await this.pollAll(this._getServices ? this._getServices() : []);
            } while (this._pendingRefresh);
        })().finally(() => {
            this._pollPromise = null;
        });
        return this._pollPromise;
    }
    stopPolling() {
        if (this._intervalId !== null) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
    }
    markOffline(globalMetaId) {
        const normalizedGlobalMetaId = (0, serviceDirectory_1.normalizeComparableGlobalMetaId)(globalMetaId);
        if (!normalizedGlobalMetaId)
            return;
        this._onlineBots.delete(normalizedGlobalMetaId);
        this._availableServices = this._availableServices.filter((service) => (0, serviceDirectory_1.normalizeComparableGlobalMetaId)(service?.providerGlobalMetaId || service?.globalMetaId) !== normalizedGlobalMetaId);
        this._providerStates = new Map([...this._providerStates.entries()].filter(([, state]) => state.globalMetaId !== normalizedGlobalMetaId));
        this._localHeartbeatsByAddress = new Map([...this._localHeartbeatsByAddress.entries()].filter(([, state]) => state.globalMetaId !== normalizedGlobalMetaId));
        this.emitChange();
    }
    forceOffline(globalMetaId) {
        const normalizedGlobalMetaId = (0, serviceDirectory_1.normalizeComparableGlobalMetaId)(globalMetaId);
        if (!normalizedGlobalMetaId)
            return;
        this._forcedOfflineGlobalMetaIds.add(normalizedGlobalMetaId);
        this.markOffline(normalizedGlobalMetaId);
    }
    clearForceOffline(globalMetaId) {
        const normalizedGlobalMetaId = (0, serviceDirectory_1.normalizeComparableGlobalMetaId)(globalMetaId);
        if (!normalizedGlobalMetaId)
            return;
        this._forcedOfflineGlobalMetaIds.delete(normalizedGlobalMetaId);
    }
    nowMs() {
        return this.deps.now ? this.deps.now() : Date.now();
    }
    emitChange() {
        if (this._listeners.size === 0)
            return;
        const snapshot = this.getDiscoverySnapshot();
        for (const listener of this._listeners) {
            try {
                listener(snapshot);
            }
            catch (error) {
                console.warn('[PresenceRegistry] change listener failed:', error);
            }
        }
    }
    async evaluateProviderGroup(group) {
        const previousState = this._providerStates.get(group.key);
        const localHeartbeat = this._localHeartbeatsByAddress.get(group.address);
        let fetchResult = null;
        let fetchError = null;
        try {
            fetchResult = await this.deps.fetchHeartbeat(group.address);
        }
        catch (error) {
            fetchError = error instanceof Error ? error.message : String(error);
        }
        const fetchedTimestamp = toNumberOrNull(fetchResult?.timestamp);
        const previousTimestamp = previousState?.lastSeenSec ?? null;
        const optimisticLocalTimestamp = localHeartbeat && this.checkOnlineStatus(localHeartbeat.lastSeenSec)
            ? localHeartbeat.lastSeenSec
            : null;
        const latestTimestamp = pickLatestTimestamp(fetchedTimestamp, previousTimestamp, optimisticLocalTimestamp);
        const forcedOffline = Boolean(group.globalMetaId) && this._forcedOfflineGlobalMetaIds.has(group.globalMetaId);
        const online = forcedOffline ? false : this.checkOnlineStatus(latestTimestamp);
        const optimisticLocal = !forcedOffline
            && optimisticLocalTimestamp != null
            && latestTimestamp === optimisticLocalTimestamp
            && fetchedTimestamp == null;
        const lastSource = latestTimestamp != null && fetchedTimestamp != null && latestTimestamp === fetchedTimestamp
            ? normalizeHeartbeatSource(fetchResult?.source) ?? 'remote'
            : optimisticLocal
                ? 'local-heartbeat'
                : previousState?.lastSource ?? normalizeHeartbeatSource(fetchResult?.source);
        const fetchResultError = toSafeString(fetchResult?.error || '');
        const lastError = forcedOffline
            ? 'locally_disabled'
            : (fetchError ?? (fetchResultError || null));
        const state = {
            key: group.key,
            globalMetaId: group.globalMetaId,
            address: group.address,
            lastSeenSec: latestTimestamp,
            lastCheckAt: Math.floor(this.nowMs() / 1000),
            lastSource,
            lastError,
            online,
            optimisticLocal
        };
        return {
            services: online ? group.services : [],
            state
        };
    }
    async mapWithConcurrency(items, limit, worker) {
        if (items.length === 0)
            return [];
        const results = new Array(items.length);
        const concurrency = Math.max(1, Math.min(limit, items.length));
        let nextIndex = 0;
        await Promise.all(Array.from({ length: concurrency }, async () => {
            while (true) {
                const index = nextIndex;
                nextIndex += 1;
                if (index >= items.length) {
                    return;
                }
                results[index] = await worker(items[index]);
            }
        }));
        return results;
    }
}
exports.PresenceRegistry = PresenceRegistry;
