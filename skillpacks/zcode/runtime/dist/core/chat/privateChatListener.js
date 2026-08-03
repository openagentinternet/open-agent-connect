"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pinIdFromPrivateChatSocketMessage = pinIdFromPrivateChatSocketMessage;
exports.senderGlobalMetaIdFromPrivateChatSocketMessage = senderGlobalMetaIdFromPrivateChatSocketMessage;
exports.normalizePrivateChatSocketMessage = normalizePrivateChatSocketMessage;
exports.decryptPrivateChatSocketMessage = decryptPrivateChatSocketMessage;
const privateChat_1 = require("./privateChat");
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
function senderGlobalMetaIdFromPrivateChatSocketMessage(message) {
    return normalizeText(message.fromUserInfo?.globalMetaId)
        || normalizeText(message.fromGlobalMetaId);
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
                fromGlobalMetaId: senderGlobalMetaIdFromPrivateChatSocketMessage(message),
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
