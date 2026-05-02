"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pinIdFromPrivateChatSocketMessage = pinIdFromPrivateChatSocketMessage;
exports.normalizePrivateChatSocketMessage = normalizePrivateChatSocketMessage;
exports.decryptPrivateChatSocketMessage = decryptPrivateChatSocketMessage;
exports.createPrivateChatListener = createPrivateChatListener;
const socket_io_client_1 = require("socket.io-client");
const privateChat_1 = require("./privateChat");
const DEFAULT_SOCKET_ENDPOINTS = [
    { url: 'wss://api.idchat.io', path: '/socket/socket.io' },
    { url: 'wss://www.show.now', path: '/socket/socket.io' },
];
const DEFAULT_RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function pinIdFromPrivateChatSocketMessage(message) {
    const pinId = normalizeText(message.pinId);
    if (pinId)
        return pinId;
    const txId = normalizeText(message.txId);
    return txId ? `${txId}i0` : null;
}
function normalizePrivateChatSocketMessage(data) {
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
        const payload = normalizeObject(parsed[1]);
        if (eventName === 'WS_SERVER_NOTIFY_PRIVATE_CHAT') {
            return payload;
        }
        if (eventName === 'WS_RESPONSE_SUCCESS') {
            return normalizeObject(payload?.data);
        }
        return null;
    }
    const wrapper = normalizeObject(parsed);
    if (!wrapper) {
        return null;
    }
    const eventName = normalizeText(wrapper.M);
    const payload = normalizeObject(wrapper.D);
    if (eventName === 'WS_SERVER_NOTIFY_PRIVATE_CHAT') {
        return payload;
    }
    if (eventName === 'WS_RESPONSE_SUCCESS') {
        return normalizeObject(payload?.data);
    }
    return null;
}
function decryptPrivateChatSocketMessage(message, identity, peerChatPublicKeyOverride) {
    const peerChatPublicKey = normalizeText(message.fromUserInfo?.chatPublicKey)
        || normalizeText(peerChatPublicKeyOverride);
    if (!peerChatPublicKey) {
        return null;
    }
    try {
        const received = (0, privateChat_1.receivePrivateChat)({
            localIdentity: {
                globalMetaId: identity.globalMetaId,
                privateKeyHex: identity.privateKeyHex,
            },
            peerChatPublicKey,
            payload: {
                fromGlobalMetaId: normalizeText(message.fromGlobalMetaId),
                content: normalizeText(message.content) || null,
                rawData: normalizeText(message.content)
                    ? JSON.stringify({ content: normalizeText(message.content) })
                    : null,
                replyPinId: normalizeText(message.replyPin),
            },
        });
        return normalizeText(received.plaintext) || null;
    }
    catch {
        return null;
    }
}
function createPrivateChatListener(input) {
    const endpoints = input.socketEndpoints ?? DEFAULT_SOCKET_ENDPOINTS;
    const baseReconnectDelay = input.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
    const maxReconnectDelay = input.maxReconnectDelayMs ?? MAX_RECONNECT_DELAY_MS;
    let running = false;
    let sockets = [];
    let reconnectTimer = null;
    let reconnectAttempt = 0;
    const seenPinIds = new Set();
    const MAX_SEEN_PIN_IDS = 5_000;
    function deduplicateByPinId(pinId) {
        if (!pinId)
            return true;
        if (seenPinIds.has(pinId))
            return false;
        seenPinIds.add(pinId);
        if (seenPinIds.size > MAX_SEEN_PIN_IDS) {
            const iterator = seenPinIds.values();
            for (let i = 0; i < 1000; i += 1) {
                const next = iterator.next();
                if (next.done)
                    break;
                seenPinIds.delete(next.value);
            }
        }
        return true;
    }
    async function handleSocketMessage(data, identity) {
        const message = normalizePrivateChatSocketMessage(data);
        if (!message)
            return;
        const fromGlobalMetaId = normalizeText(message.fromGlobalMetaId);
        if (!fromGlobalMetaId)
            return;
        // Filter out messages not addressed to us, but allow messages with no toGlobalMetaId
        // (some socket push formats omit the recipient field).
        const toGlobalMetaId = normalizeText(message.toGlobalMetaId);
        if (toGlobalMetaId && toGlobalMetaId !== normalizeText(identity.globalMetaId)) {
            return;
        }
        // Skip messages sent by ourselves (echo from our own outbound messages).
        if (normalizeText(fromGlobalMetaId) === normalizeText(identity.globalMetaId)) {
            return;
        }
        const messagePinId = pinIdFromPrivateChatSocketMessage(message);
        if (!deduplicateByPinId(messagePinId))
            return;
        let peerChatPublicKey = normalizeText(message.fromUserInfo?.chatPublicKey) || null;
        if (!peerChatPublicKey && input.resolvePeerChatPublicKey) {
            try {
                peerChatPublicKey = await input.resolvePeerChatPublicKey(fromGlobalMetaId);
            }
            catch {
                // Failed to resolve peer chat public key.
            }
        }
        const plaintext = decryptPrivateChatSocketMessage(message, identity, peerChatPublicKey);
        if (!plaintext)
            return;
        const inboundMessage = {
            fromGlobalMetaId,
            content: plaintext,
            messagePinId,
            fromChatPublicKey: peerChatPublicKey,
            timestamp: typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
                ? message.timestamp
                : Date.now(),
            rawMessage: normalizeObject(message),
        };
        try {
            await input.callbacks.onMessage(inboundMessage);
        }
        catch (error) {
            input.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
        }
    }
    function disconnectAll() {
        for (const socket of sockets) {
            try {
                socket.removeAllListeners();
                socket.disconnect();
            }
            catch {
                // Best effort cleanup.
            }
        }
        sockets = [];
    }
    function scheduleReconnect() {
        if (!running)
            return;
        if (reconnectTimer)
            return;
        const delay = Math.min(baseReconnectDelay * Math.pow(1.5, reconnectAttempt), maxReconnectDelay);
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (running) {
                void connectSockets();
            }
        }, delay);
    }
    async function connectSockets() {
        if (!running)
            return;
        const identity = await input.getIdentity();
        if (!identity) {
            scheduleReconnect();
            return;
        }
        disconnectAll();
        for (const endpoint of endpoints) {
            const socket = (0, socket_io_client_1.io)(endpoint.url, {
                path: endpoint.path,
                query: {
                    metaid: identity.globalMetaId,
                    type: 'pc',
                },
                reconnection: true,
                reconnectionDelay: baseReconnectDelay,
                reconnectionDelayMax: maxReconnectDelay,
                transports: ['websocket'],
            });
            socket.on('connect', () => {
                reconnectAttempt = 0;
                input.callbacks.onConnect?.();
            });
            socket.on('message', (data) => {
                if (!running)
                    return;
                void handleSocketMessage(data, identity);
            });
            socket.on('WS_SERVER_NOTIFY_PRIVATE_CHAT', (data) => {
                if (!running)
                    return;
                const wrapped = ['WS_SERVER_NOTIFY_PRIVATE_CHAT', data];
                void handleSocketMessage(wrapped, identity);
            });
            socket.on('disconnect', (reason) => {
                input.callbacks.onDisconnect?.(reason);
            });
            socket.on('connect_error', (error) => {
                input.callbacks.onError?.(error);
            });
            sockets.push(socket);
        }
    }
    return {
        start() {
            if (running)
                return;
            running = true;
            reconnectAttempt = 0;
            void connectSockets();
        },
        stop() {
            running = false;
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            disconnectAll();
            seenPinIds.clear();
        },
        isRunning() {
            return running;
        },
    };
}
