"use strict";
/**
 * Daemon-side group chat socket listener for the App/Game Runtime.
 *
 * Reuses the existing Metaso socket infrastructure (same endpoint and
 * `type: 'pc'` connection parameters as the MetaApp chat client and the A2A
 * simplemsg listener). The socket is a realtime notification only: the
 * runtime always catches up through `group-chat-list-by-index`. Messages that
 * do not belong to a running app session are ignored (normal group chat
 * traffic is not processed by the daemon).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeGroupChatSocketPayload = normalizeGroupChatSocketPayload;
exports.createGroupChatListenerManager = createGroupChatListenerManager;
const socket_io_client_1 = require("socket.io-client");
const DEFAULT_RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function defaultSocketClientFactory(endpoint, options) {
    return (0, socket_io_client_1.io)(endpoint.url, options);
}
/**
 * Normalize a socket payload into a group chat message. Accepts the raw
 * message object, a `{ M, D }` envelope, or the two-element array form used by
 * older clients. Only group chat notifications are returned.
 */
function normalizeGroupChatSocketPayload(data) {
    let parsed = data;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        }
        catch {
            return null;
        }
    }
    if (Array.isArray(parsed) && parsed.length >= 2) {
        const eventName = normalizeText(parsed[0]);
        if (eventName === 'WS_SERVER_NOTIFY_GROUP_CHAT') {
            return normalizeGroupChatMessagePayload(parsed[1]);
        }
        return null;
    }
    const wrapper = normalizeObject(parsed);
    if (!wrapper) {
        return null;
    }
    const eventName = normalizeText(wrapper.M);
    if (eventName === 'WS_SERVER_NOTIFY_GROUP_CHAT') {
        return normalizeGroupChatMessagePayload(wrapper.D);
    }
    if (eventName === 'WS_RESPONSE_SUCCESS') {
        return normalizeGroupChatMessagePayload(normalizeObject(wrapper.D)?.data ?? wrapper.D);
    }
    if (!eventName) {
        return normalizeGroupChatMessagePayload(parsed);
    }
    return null;
}
function normalizeGroupChatMessagePayload(raw) {
    const item = normalizeObject(raw);
    if (!item) {
        return null;
    }
    const groupId = normalizeText(item.groupId || item.groupID || item.channelId || item.channelID || item.metanetId);
    if (!groupId) {
        return null;
    }
    const protocol = normalizeText(item.protocol || item.protocolPath || item.path);
    if (protocol && !['/protocols/simplegroupchat', '/protocols/simplefilegroupchat'].includes(protocol)) {
        return null;
    }
    return {
        groupId,
        index: Number.isFinite(Number(item.index)) ? Math.max(0, Math.trunc(Number(item.index))) : 0,
        senderMetaId: normalizeText(item.globalMetaId
            || item.fromGlobalMetaId
            || item.createGlobalMetaId
            || normalizeObject(item.userInfo)?.globalMetaId
            || normalizeObject(item.fromUserInfo)?.globalMetaId),
        timestamp: Number.isFinite(Number(item.timestamp))
            ? Math.trunc(Number(item.timestamp) < 1_000_000_000_000 ? Number(item.timestamp) * 1000 : Number(item.timestamp))
            : Date.now(),
        content: normalizeText(item.content),
        encryption: normalizeText(item.encryption || item.Encryption).toLowerCase(),
        protocol,
        pinId: normalizeText(item.pinId || item.pinID || item.id),
    };
}
function createGroupChatListenerManager(options) {
    const socketClientFactory = options.socketClientFactory ?? defaultSocketClientFactory;
    const nowMs = options.now ?? (() => Date.now());
    const log = options.logger ?? (() => undefined);
    const listeners = new Map();
    const heartbeatTimers = new Map();
    let running = false;
    let lastStarted = [];
    let lastSkipped = [];
    function startHeartbeat(socket, slug) {
        stopHeartbeat(slug);
        const timer = setInterval(() => {
            try {
                socket.emit?.('heartbeat', { metaid: '', at: nowMs() });
            }
            catch {
                // Heartbeat is best effort.
            }
        }, DEFAULT_HEARTBEAT_INTERVAL_MS);
        heartbeatTimers.set(slug, timer);
    }
    function stopHeartbeat(slug) {
        const timer = heartbeatTimers.get(slug);
        if (timer) {
            clearInterval(timer);
            heartbeatTimers.delete(slug);
        }
    }
    async function connectProfile(profile) {
        const slug = normalizeText(profile.slug) || normalizeText(profile.name);
        const globalMetaId = normalizeText(profile.globalMetaId);
        if (!slug || !globalMetaId) {
            return { ok: false, reason: 'profile has no globalMetaId' };
        }
        const endpoints = await options.resolveSocketEndpoints();
        if (!endpoints.length) {
            return { ok: false, reason: 'no socket endpoints configured' };
        }
        let activeEndpointIndex = 0;
        const registerSocket = (socket, endpointIndex) => {
            const handlePayload = async (data) => {
                const message = normalizeGroupChatSocketPayload(data);
                if (!message || !message.groupId) {
                    return;
                }
                await options.onGroupMessage(profile, message);
            };
            socket.on('connect', () => {
                startHeartbeat(socket, slug);
                log(`[app-session group listener] ${slug} connected`);
            });
            socket.on('disconnect', () => {
                stopHeartbeat(slug);
            });
            socket.on('message', (data) => {
                void handlePayload(data).catch((error) => {
                    options.onError?.(error instanceof Error ? error : new Error(String(error)));
                });
            });
            socket.on('WS_SERVER_NOTIFY_GROUP_CHAT', (data) => {
                void handlePayload(data).catch((error) => {
                    options.onError?.(error instanceof Error ? error : new Error(String(error)));
                });
            });
            socket.on('connect_error', (error) => {
                options.onError?.(error);
                stopHeartbeat(slug);
                if (endpointIndex !== activeEndpointIndex || endpointIndex >= endpoints.length - 1) {
                    return;
                }
                activeEndpointIndex += 1;
                try {
                    socket.removeAllListeners();
                    socket.disconnect();
                }
                catch {
                    // Best effort fallback shutdown.
                }
                connectEndpoint(activeEndpointIndex);
            });
        };
        const connectEndpoint = (endpointIndex) => {
            const endpoint = endpoints[endpointIndex];
            if (!endpoint) {
                return;
            }
            const socket = socketClientFactory(endpoint, {
                path: endpoint.path,
                query: { metaid: globalMetaId, type: 'pc' },
                reconnection: true,
                reconnectionDelay: DEFAULT_RECONNECT_DELAY_MS,
                reconnectionDelayMax: MAX_RECONNECT_DELAY_MS,
                transports: ['websocket', 'polling'],
            });
            listeners.set(slug, socket);
            registerSocket(socket, endpointIndex);
        };
        connectEndpoint(0);
        return { ok: true };
    }
    return {
        async start() {
            if (running) {
                return { started: lastStarted, skipped: lastSkipped };
            }
            running = true;
            lastStarted = [];
            lastSkipped = [];
            const profiles = await options.listProfiles();
            for (const profile of profiles) {
                const slug = normalizeText(profile.slug) || normalizeText(profile.name);
                if (!slug) {
                    continue;
                }
                try {
                    const result = await connectProfile(profile);
                    if (result.ok) {
                        lastStarted.push(slug);
                    }
                    else {
                        lastSkipped.push({ slug, reason: result.reason });
                    }
                }
                catch (error) {
                    lastSkipped.push({
                        slug,
                        reason: error instanceof Error ? error.message : String(error),
                    });
                }
            }
            return { started: lastStarted, skipped: lastSkipped };
        },
        stop() {
            running = false;
            for (const [slug, socket] of listeners.entries()) {
                stopHeartbeat(slug);
                try {
                    socket.removeAllListeners();
                    socket.disconnect();
                }
                catch {
                    // Best effort shutdown.
                }
            }
            listeners.clear();
        },
        isRunning() {
            return running;
        },
    };
}
