"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decorateRecordsWithOnlineBots = decorateRecordsWithOnlineBots;
exports.decorateRecordsWithSocketPresence = decorateRecordsWithSocketPresence;
const socketPresenceDirectory_1 = require("./socketPresenceDirectory");
const serviceDirectory_1 = require("./serviceDirectory");
const DEFAULT_SOCKET_PRESENCE_LIMIT = 100;
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
function resolveRecordGlobalMetaId(record) {
    return (0, serviceDirectory_1.normalizeComparableGlobalMetaId)(record.providerGlobalMetaId
        ?? record.globalMetaId
        ?? record.providerMetaBot
        ?? record.providerMetabot);
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
function buildSyntheticOnlineBotsFromRecords(records) {
    const nowMs = Date.now();
    const seen = new Set();
    const bots = [];
    for (const record of records) {
        const globalMetaId = resolveRecordGlobalMetaId(record);
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
function decorateRecordsWithOnlineBots(input) {
    const onlineIndex = buildOnlineMetaBotIndex(input.onlineBots);
    const decorated = input.records.map((record) => {
        const recordObject = record;
        const globalMetaId = resolveRecordGlobalMetaId(recordObject);
        const onlineBot = globalMetaId ? onlineIndex.get(globalMetaId) : undefined;
        const lastSeenAt = typeof onlineBot?.lastSeenAt === 'number' && Number.isFinite(onlineBot.lastSeenAt)
            ? Math.max(0, Math.floor(onlineBot.lastSeenAt))
            : null;
        return {
            ...record,
            online: Boolean(onlineBot),
            lastSeenSec: normalizeLastSeenSec(lastSeenAt),
            lastSeenAt,
            lastSeenAgoSeconds: typeof onlineBot?.lastSeenAgoSeconds === 'number'
                ? Math.max(0, Math.floor(onlineBot.lastSeenAgoSeconds))
                : null,
            deviceCount: typeof onlineBot?.deviceCount === 'number'
                ? Math.max(0, Math.floor(onlineBot.deviceCount))
                : null,
            providerName: onlineBot?.name ?? '',
        };
    });
    if (input.onlineOnly === true) {
        return decorated.filter((record) => record.online);
    }
    return decorated;
}
async function decorateRecordsWithSocketPresence(records, options = {}) {
    let onlineBots = [];
    try {
        const onlineDirectory = await (0, socketPresenceDirectory_1.readOnlineMetaBotsFromSocketPresence)({
            fetchImpl: options.fetchImpl,
            apiBaseUrl: options.socketPresenceApiBaseUrl,
            limit: normalizeSocketPresenceLimit(options.socketPresenceLimit),
        });
        onlineBots = onlineDirectory.bots;
    }
    catch (error) {
        if (options.socketPresenceFailureMode === 'assume_service_providers_online') {
            onlineBots = buildSyntheticOnlineBotsFromRecords(records.map((record) => ({ ...record })));
        }
        else if (options.onlineOnly === true) {
            throw error;
        }
    }
    return decorateRecordsWithOnlineBots({
        records,
        onlineBots,
        onlineOnly: options.onlineOnly,
    });
}
