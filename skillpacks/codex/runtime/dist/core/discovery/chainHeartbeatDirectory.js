"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEARTBEAT_ONLINE_WINDOW_SEC = exports.CHAIN_HEARTBEAT_PROTOCOL_PATH = void 0;
exports.isChainHeartbeatSemanticMiss = isChainHeartbeatSemanticMiss;
exports.parseHeartbeatTimestamp = parseHeartbeatTimestamp;
exports.isHeartbeatFresh = isHeartbeatFresh;
exports.applyHeartbeatOnlineState = applyHeartbeatOnlineState;
exports.filterOnlineChainServices = filterOnlineChainServices;
exports.CHAIN_HEARTBEAT_PROTOCOL_PATH = '/protocols/metabot-heartbeat';
exports.HEARTBEAT_ONLINE_WINDOW_SEC = 10 * 60;
function toSafeString(value) {
    if (typeof value === 'string')
        return value.trim();
    if (value == null)
        return '';
    return String(value).trim();
}
function toNumberOrNull(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function isChainHeartbeatSemanticMiss(payload) {
    const list = (payload?.data?.list
        ?? payload?.list
        ?? payload?.result?.list);
    return !Array.isArray(list) || list.length === 0;
}
function parseHeartbeatTimestamp(payload) {
    const list = (payload?.data?.list
        ?? payload?.list
        ?? payload?.result?.list);
    if (!Array.isArray(list) || list.length === 0) {
        return null;
    }
    const item = list[0];
    return toNumberOrNull(item?.seenTime ?? item?.seen_time);
}
function isHeartbeatFresh(timestampSec, nowMs = Date.now()) {
    if (timestampSec == null)
        return false;
    const nowSec = Math.floor(nowMs / 1000);
    return nowSec - timestampSec <= exports.HEARTBEAT_ONLINE_WINDOW_SEC;
}
function applyHeartbeatOnlineState(services, heartbeats, options = {}) {
    const heartbeatByAddress = new Map();
    for (const heartbeat of heartbeats) {
        const address = toSafeString(heartbeat.address);
        if (!address) {
            continue;
        }
        const current = heartbeatByAddress.get(address) ?? null;
        if (current == null || ((heartbeat.timestamp ?? -Infinity) > current)) {
            heartbeatByAddress.set(address, heartbeat.timestamp ?? null);
        }
    }
    const nowMs = options.now ? options.now() : Date.now();
    return services.map((service) => {
        const address = toSafeString(service.providerAddress);
        const lastSeenSec = address ? (heartbeatByAddress.get(address) ?? null) : null;
        return {
            ...service,
            online: isHeartbeatFresh(lastSeenSec, nowMs),
            lastSeenSec,
        };
    });
}
function filterOnlineChainServices(services, heartbeats, options = {}) {
    return applyHeartbeatOnlineState(services, heartbeats, options)
        .filter((service) => service.online);
}
