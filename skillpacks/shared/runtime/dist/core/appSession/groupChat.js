"use strict";
/**
 * Group chat client for the App/Game Runtime.
 *
 * Docs/10: Agent-Game-v2 reuses the existing simplegroupchat group as an
 * event bus. The runtime reads through `group-chat-list-by-index` (socket is
 * only a realtime notification; history is the source of truth), decrypts
 * `simplegroupchat` content with the public AES group scheme and parses the
 * `agent-game/1` envelope.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.groupIdToSecretKey = groupIdToSecretKey;
exports.encryptGroupContent = encryptGroupContent;
exports.decryptGroupContent = decryptGroupContent;
exports.normalizeGroupChatMessage = normalizeGroupChatMessage;
exports.fetchGroupMessages = fetchGroupMessages;
exports.parseAgentGameEnvelope = parseAgentGameEnvelope;
exports.buildGroupChatWritePayload = buildGroupChatWritePayload;
const node_crypto_1 = require("node:crypto");
const types_1 = require("./types");
const GROUP_AES_KEY_CHAR_LEN = 16;
const GROUP_AES_IV = '0000000000000000';
const DEFAULT_PAGE_SIZE = 50;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
/**
 * Group message secret key: the first 16 UTF-8 characters of groupId, padded
 * with '0'. Matches idchat / the chess MetaApp (`js/groupCrypto.js`).
 */
function groupIdToSecretKey(groupId) {
    const text = normalizeText(groupId);
    if (text.length >= GROUP_AES_KEY_CHAR_LEN) {
        return text.slice(0, GROUP_AES_KEY_CHAR_LEN);
    }
    return text.padEnd(GROUP_AES_KEY_CHAR_LEN, '0');
}
/**
 * AES-128-CBC + PKCS7 group message encryption with the public IV
 * "0000000000000000"; ciphertext is hex encoded. Host-side write path uses
 * this to encrypt the game event before the pin write.
 */
function encryptGroupContent(plaintext, groupId) {
    const key = Buffer.from(groupIdToSecretKey(groupId), 'utf8');
    const iv = Buffer.from(GROUP_AES_IV, 'utf8');
    const cipher = (0, node_crypto_1.createCipheriv)('aes-128-cbc', key, iv);
    const encrypted = Buffer.concat([
        cipher.update(Buffer.from(String(plaintext), 'utf8')),
        cipher.final(),
    ]);
    return encrypted.toString('hex');
}
/**
 * Decrypt a simplegroupchat content field. When the ciphertext does not
 * decrypt (public/unencrypted group or foreign message), return the original
 * text unchanged — matching idchat convention.
 */
function decryptGroupContent(content, groupId) {
    const hex = normalizeText(content);
    if (!hex || hex.length % 16 !== 0 || /[^0-9a-f]/iu.test(hex)) {
        return content;
    }
    try {
        const key = Buffer.from(groupIdToSecretKey(groupId), 'utf8');
        const iv = Buffer.from(GROUP_AES_IV, 'utf8');
        const decipher = (0, node_crypto_1.createDecipheriv)('aes-128-cbc', key, iv);
        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(hex, 'hex')),
            decipher.final(),
        ]);
        return decrypted.toString('utf8');
    }
    catch {
        return content;
    }
}
function toMilliseconds(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num) || num <= 0) {
        return Date.now();
    }
    return Math.trunc(num < 1_000_000_000_000 ? num * 1000 : num);
}
function normalizeIndex(value) {
    const num = Number(value);
    return Number.isFinite(num) && num >= 0 ? Math.trunc(num) : 0;
}
function extractList(rawData) {
    if (Array.isArray(rawData)) {
        return rawData.filter((item) => Boolean(item) && typeof item === 'object');
    }
    if (!rawData || typeof rawData !== 'object') {
        return [];
    }
    const record = rawData;
    const data = record.data;
    if (data && typeof data === 'object') {
        const dataRecord = data;
        for (const key of ['list', 'items', 'messages']) {
            if (Array.isArray(dataRecord[key])) {
                return dataRecord[key];
            }
        }
        return [];
    }
    for (const key of ['list', 'items', 'messages']) {
        if (Array.isArray(record[key])) {
            return record[key];
        }
    }
    return [];
}
function senderMetaIdFrom(item) {
    const userInfo = item.userInfo && typeof item.userInfo === 'object'
        ? item.userInfo
        : null;
    const fromUserInfo = item.fromUserInfo && typeof item.fromUserInfo === 'object'
        ? item.fromUserInfo
        : null;
    return normalizeText(item.globalMetaId
        || item.fromGlobalMetaId
        || item.createGlobalMetaId
        || userInfo?.globalMetaId
        || fromUserInfo?.globalMetaId
        || item.metaId
        || item.metaid);
}
function normalizeGroupChatMessage(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }
    const item = raw;
    const content = normalizeText(item.content);
    if (!content) {
        return null;
    }
    const groupId = normalizeText(item.groupId || item.groupID || item.channelId || item.channelID || item.metanetId);
    const senderMetaId = senderMetaIdFrom(item);
    if (!groupId || !senderMetaId) {
        return null;
    }
    return {
        index: normalizeIndex(item.index ?? item.msgIndex),
        senderMetaId,
        timestamp: toMilliseconds(item.timestamp ?? item.time ?? item.createTime),
        content,
        encryption: normalizeText(item.encryption ?? item.Encryption).toLowerCase(),
        protocol: normalizeText(item.protocol ?? item.protocolPath ?? item.path),
        pinId: normalizeText(item.pinId ?? item.pinID ?? item.id),
        groupId,
    };
}
/**
 * Fetch messages with index >= startIndex from `group-chat-list-by-index`.
 * Returns messages sorted by index ascending; callers deduplicate by index.
 */
async function fetchGroupMessages(input) {
    const fetchImpl = input.fetchImpl ?? globalThis.fetch;
    const baseUrl = normalizeText(input.chatApiBaseUrl).replace(/\/+$/u, '');
    if (!baseUrl) {
        throw new Error('chatApiBaseUrl is required.');
    }
    const url = new URL(`${baseUrl}/group-chat-list-by-index`);
    url.searchParams.set('groupId', normalizeText(input.groupId));
    url.searchParams.set('startIndex', String(Math.max(0, Math.trunc(Number(input.startIndex) || 0))));
    url.searchParams.set('size', String(input.size && input.size > 0 ? Math.trunc(input.size) : DEFAULT_PAGE_SIZE));
    const response = await fetchImpl(url.toString(), {
        headers: { 'content-type': 'application/json' },
        ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!response.ok) {
        const error = new Error(`group-chat-list-by-index failed: ${response.status}`);
        error.status = response.status;
        throw error;
    }
    const raw = await response.json();
    const list = extractList(raw);
    const messages = list
        .map(normalizeGroupChatMessage)
        .filter((message) => message !== null)
        .sort((left, right) => left.index - right.index);
    return messages;
}
/**
 * Parse the decrypted simplegroupchat plaintext as an agent-game/1 envelope.
 * Returns null for non-game content so normal group traffic is ignored.
 */
function parseAgentGameEnvelope(plaintext) {
    let parsed;
    try {
        parsed = JSON.parse(plaintext);
    }
    catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
    }
    const record = parsed;
    if (normalizeText(record.protocol) !== types_1.AGENT_GAME_PROTOCOL) {
        return null;
    }
    const gameId = normalizeText(record.gameId);
    const matchId = normalizeText(record.matchId);
    const rulesHash = normalizeText(record.rulesHash);
    const type = normalizeText(record.type);
    if (!gameId || !matchId || !rulesHash || !type) {
        return null;
    }
    const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
        ? record.payload
        : {};
    return {
        protocol: types_1.AGENT_GAME_PROTOCOL,
        gameId,
        matchId,
        rulesHash,
        type,
        ...(normalizeText(record.eventId) ? { eventId: normalizeText(record.eventId) } : {}),
        ...(Number.isInteger(record.actionSeq) ? { actionSeq: Number(record.actionSeq) } : {}),
        ...(normalizeText(record.prevStateHash) ? { prevStateHash: normalizeText(record.prevStateHash) } : {}),
        ...(normalizeText(record.stateHash) ? { stateHash: normalizeText(record.stateHash) } : {}),
        payload,
    };
}
/**
 * Build a group chat write payload body (the JSON value of the
 * simplegroupchat pin), matching the idchat / chess MetaApp shape exactly.
 */
function buildGroupChatWritePayload(input) {
    return {
        groupId: normalizeText(input.groupId),
        nickName: normalizeText(input.nickName) || '',
        content: encryptGroupContent(input.plaintext, input.groupId),
        contentType: 'text/plain',
        encryption: 'aes',
        timestamp: input.now ?? Date.now(),
        replyPin: normalizeText(input.replyPin) || '',
        mention: Array.isArray(input.mention) ? input.mention.filter((value) => normalizeText(value)) : [],
    };
}
