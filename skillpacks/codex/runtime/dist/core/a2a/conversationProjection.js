"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listPeerConversationSummaries = listPeerConversationSummaries;
exports.readPeerConversationMessages = readPeerConversationMessages;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../state/paths");
const simplemsgPayload_1 = require("./simplemsgPayload");
const CHAT_FILE_RE = /^chat-[a-z0-9]+-[a-z0-9]+\.json$/u;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeTimestamp(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    const normalized = parsed < 1_000_000_000_000 ? parsed * 1000 : parsed;
    return Math.trunc(normalized);
}
function normalizeLimit(value, fallback = 50) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.min(100, Math.max(1, Math.trunc(parsed)));
}
function normalizeActor(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value;
    const globalMetaId = normalizeText(record.globalMetaId);
    if (!globalMetaId) {
        return null;
    }
    return {
        globalMetaId,
        name: normalizeText(record.name) || null,
        avatar: normalizeText(record.avatar) || null,
        chatPublicKey: normalizeText(record.chatPublicKey) || null,
    };
}
function normalizeMessage(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const message = value;
    if (!normalizeText(message.messageId)) {
        return null;
    }
    const display = (0, simplemsgPayload_1.normalizeSimplemsgDisplayContent)({
        content: message.content,
        contentType: message.contentType,
        payloadContentType: (0, simplemsgPayload_1.readSimplemsgPayloadContentType)(message.raw),
    });
    return {
        ...message,
        messageId: normalizeText(message.messageId),
        content: display.content,
        contentType: display.contentType,
        timestamp: normalizeTimestamp(message.timestamp),
    };
}
function normalizeSession(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const session = value;
    return normalizeText(session.sessionId) ? session : null;
}
function normalizeConversationState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value;
    const local = normalizeActor(record.local);
    const peer = normalizeActor(record.peer);
    if (!local || !peer) {
        return null;
    }
    const messages = Array.isArray(record.messages)
        ? record.messages.map(normalizeMessage).filter((entry) => Boolean(entry))
        : [];
    const sessions = Array.isArray(record.sessions)
        ? record.sessions.map(normalizeSession).filter((entry) => Boolean(entry))
        : [];
    return {
        version: 1,
        local,
        peer,
        messages,
        sessions,
        indexes: record.indexes ?? {
            messageIds: messages.map((message) => message.messageId),
            orderTxidToSessionId: {},
            paymentTxidToSessionId: {},
        },
        updatedAt: normalizeTimestamp(record.updatedAt),
    };
}
function sortMessages(messages) {
    return [...messages].sort((left, right) => {
        if (left.timestamp !== right.timestamp) {
            return left.timestamp - right.timestamp;
        }
        return left.messageId.localeCompare(right.messageId);
    });
}
function latestPeerSession(conversation) {
    return [...conversation.sessions]
        .filter((session) => session.type === 'peer')
        .sort((left, right) => normalizeTimestamp(right.updatedAt) - normalizeTimestamp(left.updatedAt))[0] ?? null;
}
function conversationIdFor(conversation) {
    const peerSession = latestPeerSession(conversation);
    if (peerSession) {
        return peerSession.sessionId;
    }
    return `peer-${conversation.local.globalMetaId}-${conversation.peer.globalMetaId}`;
}
async function readJsonFile(filePath) {
    try {
        return JSON.parse(await node_fs_1.promises.readFile(filePath, 'utf8'));
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT' || error instanceof SyntaxError) {
            return null;
        }
        throw error;
    }
}
async function listConversationFiles(homeDir) {
    const paths = (0, paths_1.resolveMetabotPaths)(homeDir);
    try {
        const entries = await node_fs_1.promises.readdir(paths.a2aRoot, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isFile() && CHAT_FILE_RE.test(entry.name))
            .map((entry) => node_path_1.default.join(paths.a2aRoot, entry.name))
            .sort();
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}
async function readConversations(homeDir) {
    const files = await listConversationFiles(homeDir);
    const conversations = [];
    for (const filePath of files) {
        const conversation = normalizeConversationState(await readJsonFile(filePath));
        if (conversation) {
            conversations.push(conversation);
        }
    }
    return conversations;
}
function filterLocalConversations(conversations, localGlobalMetaId) {
    const normalizedLocal = normalizeText(localGlobalMetaId);
    return conversations.filter((conversation) => conversation.local.globalMetaId === normalizedLocal);
}
function summarizeConversation(conversation) {
    const messages = sortMessages(conversation.messages);
    const latestMessage = messages[messages.length - 1] ?? null;
    const kinds = [];
    for (const message of messages) {
        if (!kinds.includes(message.kind)) {
            kinds.push(message.kind);
        }
    }
    const peerSession = latestPeerSession(conversation);
    return {
        conversationId: conversationIdFor(conversation),
        localGlobalMetaId: conversation.local.globalMetaId,
        localName: conversation.local.name ?? null,
        localAvatar: conversation.local.avatar ?? null,
        peerGlobalMetaId: conversation.peer.globalMetaId,
        peerName: conversation.peer.name ?? null,
        peerAvatar: conversation.peer.avatar ?? null,
        latestText: latestMessage?.content ?? '',
        latestAt: latestMessage?.timestamp ?? conversation.updatedAt,
        messageCount: messages.length,
        kinds,
        state: normalizeText(peerSession?.state) || 'active',
    };
}
async function listPeerConversationSummaries(input) {
    const conversations = filterLocalConversations(await readConversations(input.homeDir), input.localGlobalMetaId);
    const first = conversations[0] ?? null;
    const limit = normalizeLimit(input.limit, 100);
    return {
        localBot: {
            globalMetaId: normalizeText(input.localGlobalMetaId),
            name: first?.local.name ?? null,
            avatar: first?.local.avatar ?? null,
        },
        conversations: conversations
            .map(summarizeConversation)
            .sort((left, right) => right.latestAt - left.latestAt)
            .slice(0, limit),
    };
}
async function readPeerConversationMessages(input) {
    const localGlobalMetaId = normalizeText(input.localGlobalMetaId);
    const peerGlobalMetaId = normalizeText(input.peerGlobalMetaId);
    const conversation = (await readConversations(input.homeDir)).find((entry) => (entry.local.globalMetaId === localGlobalMetaId
        && entry.peer.globalMetaId === peerGlobalMetaId)) ?? null;
    const sortedMessages = sortMessages(conversation?.messages ?? []);
    const limit = normalizeLimit(input.limit);
    const before = Number.isFinite(input.before) ? Math.trunc(Number(input.before)) : null;
    const after = Number.isFinite(input.after) ? Math.trunc(Number(input.after)) : null;
    const windowed = (() => {
        if (after !== null) {
            return sortedMessages.filter((message) => message.timestamp > after).slice(0, limit);
        }
        if (before !== null) {
            return sortedMessages.filter((message) => message.timestamp < before).slice(-limit);
        }
        return sortedMessages.slice(-limit);
    })();
    const firstMessage = windowed[0] ?? null;
    const lastMessage = windowed[windowed.length - 1] ?? null;
    return {
        localBot: {
            globalMetaId: localGlobalMetaId,
            name: conversation?.local.name ?? null,
            avatar: conversation?.local.avatar ?? null,
        },
        peerBot: {
            globalMetaId: peerGlobalMetaId,
            name: conversation?.peer.name ?? null,
            avatar: conversation?.peer.avatar ?? null,
        },
        messages: windowed,
        pagination: {
            beforeCursor: firstMessage?.timestamp ?? null,
            afterCursor: lastMessage?.timestamp ?? null,
            hasMoreBefore: firstMessage
                ? sortedMessages.some((message) => message.timestamp < firstMessage.timestamp)
                : false,
        },
    };
}
