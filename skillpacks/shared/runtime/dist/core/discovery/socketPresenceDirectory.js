"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readOnlineMetaBotsFromSocketPresence = readOnlineMetaBotsFromSocketPresence;
const DEFAULT_SOCKET_PRESENCE_API_BASE = 'https://api.idchat.io';
const DEFAULT_SOCKET_PRESENCE_SIZE = 20;
const MAX_SOCKET_PRESENCE_SIZE = 100;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeInteger(value, fallback = 0) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.floor(value));
    }
    const parsed = Number.parseInt(normalizeText(value), 10);
    if (Number.isFinite(parsed)) {
        return Math.max(0, parsed);
    }
    return fallback;
}
function normalizeApiBaseUrl(value) {
    const normalized = normalizeText(value);
    return (normalized || DEFAULT_SOCKET_PRESENCE_API_BASE).replace(/\/$/, '');
}
function normalizeListSize(value) {
    if (!Number.isFinite(value)) {
        return DEFAULT_SOCKET_PRESENCE_SIZE;
    }
    return Math.min(MAX_SOCKET_PRESENCE_SIZE, Math.max(1, Math.floor(value)));
}
function normalizeBioGoal(bio) {
    const bioStr = normalizeText(bio);
    if (!bioStr)
        return '';
    try {
        const parsed = JSON.parse(bioStr);
        return normalizeText(parsed.goal);
    }
    catch {
        return bioStr;
    }
}
function normalizeUserRow(row) {
    const globalMetaId = normalizeText(row.globalMetaId);
    if (!globalMetaId) {
        return null;
    }
    const userInfo = row.userInfo && typeof row.userInfo === 'object'
        ? row.userInfo
        : {};
    return {
        globalMetaId,
        lastSeenAt: normalizeInteger(row.lastSeenAt),
        lastSeenAgoSeconds: normalizeInteger(row.lastSeenAgoSeconds),
        deviceCount: normalizeInteger(row.deviceCount),
        online: true,
        name: normalizeText(userInfo.name),
        goal: normalizeBioGoal(userInfo.bio),
    };
}
function parseOnlineUsersEnvelope(payload) {
    const envelope = (payload ?? {});
    const code = normalizeInteger(envelope.code, Number.NaN);
    if (code !== 0) {
        throw new Error('socket_presence_semantic_error');
    }
    const data = envelope.data && typeof envelope.data === 'object'
        ? envelope.data
        : {};
    const rows = Array.isArray(data.list) ? data.list : [];
    const bots = rows
        .map((entry) => normalizeUserRow(entry))
        .filter((entry) => entry !== null);
    const windowSeconds = data.onlineWindowSeconds;
    const onlineWindowSeconds = typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)
        ? Math.max(0, Math.floor(windowSeconds))
        : null;
    return {
        source: 'socket_presence',
        total: normalizeInteger(data.total, bots.length),
        onlineWindowSeconds,
        bots,
    };
}
async function readOnlineMetaBotsFromSocketPresence(options = {}) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const size = normalizeListSize(options.limit);
    const url = new URL(`${normalizeApiBaseUrl(options.apiBaseUrl)}/group-chat/socket/online-users`);
    url.searchParams.set('cursor', '0');
    url.searchParams.set('size', String(size));
    url.searchParams.set('withUserInfo', 'true');
    const response = await fetchImpl(url.toString());
    if (!response.ok) {
        throw new Error(`socket_presence_http_${response.status}`);
    }
    const payload = await response.json();
    const parsed = parseOnlineUsersEnvelope(payload);
    return {
        ...parsed,
        bots: parsed.bots.slice(0, size),
    };
}
