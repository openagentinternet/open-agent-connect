"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeOrderProtocolReference = normalizeOrderProtocolReference;
exports.shouldAcceptServiceDeliveryForReplyWaiter = shouldAcceptServiceDeliveryForReplyWaiter;
exports.shouldAcceptServiceRatingRequestForReplyWaiter = shouldAcceptServiceRatingRequestForReplyWaiter;
exports.createSocketIoMetaWebReplyWaiter = createSocketIoMetaWebReplyWaiter;
const socket_io_client_1 = require("socket.io-client");
const privateChat_1 = require("../chat/privateChat");
const orderProtocol_1 = require("./protocol/orderProtocol");
const serviceOrderProtocols_1 = require("../orders/serviceOrderProtocols");
const DEFAULT_SOCKET_ENDPOINTS = [
    { url: 'wss://api.idchat.io', path: '/socket/socket.io' },
    { url: 'wss://www.show.now', path: '/socket/socket.io' },
];
const DEFAULT_NEEDS_RATING_GRACE_MS = 3_000;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeOrderProtocolReference(value) {
    const text = normalizeText(value).toLowerCase();
    const normalizedTxid = (0, orderProtocol_1.normalizeOrderProtocolTxid)(text);
    if (normalizedTxid)
        return normalizedTxid;
    const pinMatch = text.match(/^([0-9a-f]{64})i\d+$/i);
    return pinMatch ? (0, orderProtocol_1.normalizeOrderProtocolTxid)(pinMatch[1]) : '';
}
function shouldAcceptServiceDeliveryForReplyWaiter(input) {
    const deliveryOrderTxid = normalizeOrderProtocolReference(input.delivery.orderTxid);
    const expectedOrderTxid = normalizeOrderProtocolReference(input.expected.orderTxid);
    const deliveryPaymentTxid = normalizeText(input.delivery.paymentTxid);
    const expectedPaymentTxid = normalizeText(input.expected.paymentTxid);
    const deliveryServicePinId = normalizeText(input.delivery.servicePinId);
    const expectedServicePinId = normalizeText(input.expected.servicePinId);
    const matchesPayment = Boolean(deliveryPaymentTxid
        && expectedPaymentTxid
        && deliveryPaymentTxid === expectedPaymentTxid);
    const matchesService = Boolean(deliveryServicePinId
        && expectedServicePinId
        && deliveryServicePinId === expectedServicePinId);
    if (deliveryOrderTxid) {
        if (expectedOrderTxid) {
            return deliveryOrderTxid === expectedOrderTxid;
        }
        return matchesPayment;
    }
    return matchesPayment || matchesService;
}
function shouldAcceptServiceRatingRequestForReplyWaiter(input) {
    const ratingOrderTxid = normalizeOrderProtocolReference(input.ratingOrderTxid);
    if (!ratingOrderTxid) {
        return true;
    }
    const expectedOrderTxid = normalizeOrderProtocolReference(input.expectedOrderTxid);
    if (expectedOrderTxid) {
        return ratingOrderTxid === expectedOrderTxid;
    }
    const pendingDeliveryOrderTxid = normalizeOrderProtocolReference(input.pendingDeliveryOrderTxid);
    return Boolean(pendingDeliveryOrderTxid && ratingOrderTxid === pendingDeliveryOrderTxid);
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
        return normalizeText(received.plaintext) || null;
    }
    catch {
        return null;
    }
}
function createSocketIoMetaWebReplyWaiter() {
    return {
        awaitServiceReply(input) {
            const timeoutMs = Number.isFinite(input.timeoutMs)
                ? Math.max(250, Math.floor(input.timeoutMs))
                : 15_000;
            return new Promise((resolve) => {
                let settled = false;
                let timeoutHandle = null;
                let ratingGraceHandle = null;
                const sockets = [];
                let pendingDelivery = null;
                let pendingDeliveryOrderTxid = null;
                const finish = (result) => {
                    if (settled)
                        return;
                    settled = true;
                    if (timeoutHandle) {
                        clearTimeout(timeoutHandle);
                        timeoutHandle = null;
                    }
                    if (ratingGraceHandle) {
                        clearTimeout(ratingGraceHandle);
                        ratingGraceHandle = null;
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
                        const ratingRequest = (0, orderProtocol_1.parseNeedsRatingMessage)(plaintext);
                        if (ratingRequest && pendingDelivery) {
                            if (!shouldAcceptServiceRatingRequestForReplyWaiter({
                                ratingOrderTxid: ratingRequest.orderTxid,
                                expectedOrderTxid: input.orderTxid,
                                pendingDeliveryOrderTxid,
                            })) {
                                return;
                            }
                            finish({
                                state: 'completed',
                                ...pendingDelivery,
                                ratingRequestText: ratingRequest.content,
                            });
                            return;
                        }
                        const delivery = (0, serviceOrderProtocols_1.parseDeliveryMessage)(plaintext);
                        if (!delivery) {
                            return;
                        }
                        if (!shouldAcceptServiceDeliveryForReplyWaiter({
                            delivery,
                            expected: input,
                        })) {
                            return;
                        }
                        pendingDeliveryOrderTxid = normalizeOrderProtocolReference(delivery.orderTxid) || null;
                        pendingDelivery = {
                            responseText: (0, serviceOrderProtocols_1.cleanServiceResultText)(normalizeText(delivery.result)) || normalizeText(delivery.result),
                            deliveryPinId: pinIdFromMessage(message),
                            observedAt: typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
                                ? message.timestamp
                                : null,
                            rawMessage: normalizeObject(message),
                            ratingRequestText: null,
                        };
                        if (timeoutHandle) {
                            clearTimeout(timeoutHandle);
                            timeoutHandle = null;
                        }
                        if (ratingGraceHandle) {
                            clearTimeout(ratingGraceHandle);
                        }
                        ratingGraceHandle = setTimeout(() => {
                            if (!pendingDelivery) {
                                finish({ state: 'timeout' });
                                return;
                            }
                            finish({
                                state: 'completed',
                                ...pendingDelivery,
                            });
                        }, DEFAULT_NEEDS_RATING_GRACE_MS);
                    });
                }
            });
        },
    };
}
