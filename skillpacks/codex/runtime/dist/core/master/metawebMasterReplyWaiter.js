"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSocketIoMetaWebMasterReplyWaiter = createSocketIoMetaWebMasterReplyWaiter;
const socket_io_client_1 = require("socket.io-client");
const privateChat_1 = require("../chat/privateChat");
const masterMessageSchema_1 = require("./masterMessageSchema");
const DEFAULT_SOCKET_ENDPOINTS = [
    { url: 'wss://api.idchat.io', path: '/socket/socket.io' },
    { url: 'wss://www.show.now', path: '/socket/socket.io' },
];
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function pinIdFromMessage(message) {
    const pinId = normalizeText(message.pinId);
    if (pinId)
        return pinId;
    const txId = normalizeText(message.txId);
    return txId ? `${txId}i0` : null;
}
function extractSocketMessage(data) {
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
function matchesExpectedPeer(message, input) {
    return (normalizeText(message.fromGlobalMetaId) === normalizeText(input.providerGlobalMetaId)
        && normalizeText(message.toGlobalMetaId) === normalizeText(input.callerGlobalMetaId));
}
function decryptInboundPlaintext(message, input) {
    const peerChatPublicKey = normalizeText(message.fromUserInfo?.chatPublicKey)
        || normalizeText(input.providerChatPublicKey);
    if (!peerChatPublicKey) {
        return null;
    }
    try {
        const received = (0, privateChat_1.receivePrivateChat)({
            localIdentity: {
                globalMetaId: input.callerGlobalMetaId,
                privateKeyHex: input.callerPrivateKeyHex,
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
        return normalizeText(received.plaintextJson) || null;
    }
    catch {
        return null;
    }
}
function matchesExpectedResponse(response, input) {
    return (normalizeText(response.requestId) === normalizeText(input.requestId)
        && normalizeText(response.traceId) === normalizeText(input.traceId)
        && normalizeText(response.responder.providerGlobalMetaId) === normalizeText(input.providerGlobalMetaId)
        && normalizeText(response.responder.masterServicePinId) === normalizeText(input.masterServicePinId));
}
function createSocketIoMetaWebMasterReplyWaiter() {
    return {
        awaitMasterReply(input) {
            const timeoutMs = Number.isFinite(input.timeoutMs)
                ? Math.max(250, Math.floor(input.timeoutMs))
                : 15_000;
            return new Promise((resolve) => {
                let settled = false;
                let timeoutHandle = null;
                const sockets = [];
                const finish = (result) => {
                    if (settled)
                        return;
                    settled = true;
                    if (timeoutHandle) {
                        clearTimeout(timeoutHandle);
                        timeoutHandle = null;
                    }
                    for (const socket of sockets) {
                        try {
                            socket.removeAllListeners();
                            socket.disconnect();
                        }
                        catch {
                            // Best effort cleanup.
                        }
                    }
                    resolve(result);
                };
                timeoutHandle = setTimeout(() => {
                    finish({ state: 'timeout' });
                }, timeoutMs);
                for (const endpoint of DEFAULT_SOCKET_ENDPOINTS) {
                    const socket = (0, socket_io_client_1.io)(endpoint.url, {
                        path: endpoint.path,
                        query: {
                            metaid: input.callerGlobalMetaId,
                            type: 'pc',
                        },
                        reconnection: false,
                        transports: ['websocket'],
                    });
                    sockets.push(socket);
                    socket.on('message', (data) => {
                        if (settled)
                            return;
                        const message = extractSocketMessage(data);
                        if (!message || !matchesExpectedPeer(message, input)) {
                            return;
                        }
                        const plaintext = decryptInboundPlaintext(message, input);
                        if (!plaintext) {
                            return;
                        }
                        const parsed = (0, masterMessageSchema_1.parseMasterResponse)(plaintext);
                        if (!parsed.ok || !matchesExpectedResponse(parsed.value, input)) {
                            return;
                        }
                        finish({
                            state: 'completed',
                            response: parsed.value,
                            responseJson: plaintext,
                            deliveryPinId: pinIdFromMessage(message),
                            observedAt: typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
                                ? message.timestamp
                                : null,
                            rawMessage: normalizeObject(message),
                        });
                    });
                }
            });
        },
    };
}
