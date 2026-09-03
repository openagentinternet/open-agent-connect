"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendTranscriptTurn = appendTranscriptTurn;
exports.readTranscript = readTranscript;
exports.listRecentChats = listRecentChats;
exports.searchConversations = searchConversations;
// Transcript mirror store: per-session JSONL turn mirrors under
// `.runtime/memory/transcripts/`. The dsh-plugin post-turn observer appends
// DSH session turns here so that memory extraction, recall tools, and dream
// activity gathering treat local DSH sessions and on-chain A2A conversations
// uniformly. This module also reads the existing `.runtime/A2A/chat-*.json`
// stores for the recent-chats / conversation-search surfaces.
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const memoryText_1 = require("./memoryText");
const TRANSCRIPT_TEXT_MAX_CHARS = 4000;
const SNIPPET_MAX_CHARS = 280;
function sanitizeSessionId(sessionId) {
    const trimmed = sessionId.trim();
    const safe = trimmed.replace(/[^a-zA-Z0-9._-]/g, '');
    if (safe && safe.length <= 120)
        return safe;
    return `sid-${node_crypto_1.default.createHash('sha1').update(trimmed).digest('hex').slice(0, 16)}`;
}
function transcriptPath(paths, sessionId) {
    return node_path_1.default.join(paths.memoryTranscriptsRoot, `${sanitizeSessionId(sessionId)}.jsonl`);
}
function truncateText(value, maxChars) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxChars)
        return normalized;
    return `${normalized.slice(0, maxChars - 1)}…`;
}
function normalizeTurn(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const role = record.role === 'assistant' ? 'assistant' : record.role === 'user' ? 'user' : null;
    const text = typeof record.text === 'string' ? record.text : '';
    if (!role || !text.trim())
        return null;
    return {
        ...(typeof record.turn === 'number' && Number.isFinite(record.turn) ? { turn: record.turn } : {}),
        role,
        text,
        ts: typeof record.ts === 'number' && Number.isFinite(record.ts) ? record.ts : 0,
        channel: typeof record.channel === 'string' && record.channel.trim() ? record.channel.trim() : 'dsh',
        peerGlobalMetaId: typeof record.peerGlobalMetaId === 'string' && record.peerGlobalMetaId.trim()
            ? record.peerGlobalMetaId.trim()
            : null,
    };
}
/** Append one turn mirror line. Fire-and-forget friendly: never throws on ENOENT races. */
async function appendTranscriptTurn(paths, input) {
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
    if (!sessionId) {
        throw new Error('A transcript turn requires a sessionId.');
    }
    const normalized = normalizeTurn(input);
    if (!normalized) {
        throw new Error('A transcript turn requires role (user|assistant) and non-empty text.');
    }
    await node_fs_1.promises.mkdir(paths.memoryTranscriptsRoot, { recursive: true });
    const line = `${JSON.stringify(normalized)}\n`;
    await node_fs_1.promises.appendFile(transcriptPath(paths, sessionId), line, 'utf8');
}
async function readTranscript(paths, sessionId, options = {}) {
    let raw;
    try {
        raw = await node_fs_1.promises.readFile(transcriptPath(paths, sessionId), 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
    const turns = raw
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
        try {
            return normalizeTurn(JSON.parse(line));
        }
        catch {
            return null;
        }
    })
        .filter((turn) => turn !== null);
    // No limit by default: gatherActivity needs the whole day, not just the
    // last turn. Callers that pass a limit get the capped tail.
    const limit = options.limit === undefined ? 0 : Math.max(0, Math.floor(options.limit));
    return limit > 0 ? turns.slice(-limit) : turns;
}
async function listA2AConversationFiles(paths) {
    try {
        const entries = await node_fs_1.promises.readdir(paths.a2aRoot);
        return entries.filter((entry) => entry.startsWith('chat-') && entry.endsWith('.json'));
    }
    catch {
        return [];
    }
}
async function readA2AConversation(paths, fileName) {
    try {
        const parsed = JSON.parse(await node_fs_1.promises.readFile(node_path_1.default.join(paths.a2aRoot, fileName), 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : null;
    }
    catch {
        return null;
    }
}
async function listTranscriptSessions(paths) {
    try {
        const entries = await node_fs_1.promises.readdir(paths.memoryTranscriptsRoot);
        return entries
            .filter((entry) => entry.endsWith('.jsonl'))
            .map((entry) => entry.slice(0, -'.jsonl'.length));
    }
    catch {
        return [];
    }
}
/** Recent chats across mirrored DSH transcripts and on-chain A2A conversations, newest first. */
async function listRecentChats(paths, options = {}) {
    const limit = Math.max(1, Math.min(20, Math.floor(options.limit ?? 10)));
    const chats = [];
    for (const sessionId of await listTranscriptSessions(paths)) {
        const turns = await readTranscript(paths, sessionId);
        if (turns.length === 0)
            continue;
        const last = turns[turns.length - 1];
        chats.push({
            sessionId,
            channel: last.channel,
            peerGlobalMetaId: last.peerGlobalMetaId ?? null,
            peerName: null,
            messageCount: turns.length,
            lastMessageText: truncateText(last.text, SNIPPET_MAX_CHARS),
            lastMessageAt: last.ts,
        });
    }
    for (const fileName of await listA2AConversationFiles(paths)) {
        const conversation = await readA2AConversation(paths, fileName);
        if (!conversation || !Array.isArray(conversation.messages) || conversation.messages.length === 0)
            continue;
        const messages = conversation.messages.filter((message) => (typeof message?.content === 'string' && message.content.trim()));
        if (messages.length === 0)
            continue;
        const last = messages[messages.length - 1];
        chats.push({
            sessionId: fileName.slice(0, -'.json'.length),
            channel: 'metaweb_private',
            peerGlobalMetaId: conversation.peer?.globalMetaId ?? null,
            peerName: conversation.peer?.name ?? null,
            messageCount: messages.length,
            lastMessageText: truncateText(last.content ?? '', SNIPPET_MAX_CHARS),
            lastMessageAt: typeof last.timestamp === 'number' ? last.timestamp : 0,
        });
    }
    chats.sort((left, right) => right.lastMessageAt - left.lastMessageAt);
    if (options.sortOrder === 'asc')
        chats.reverse();
    return chats.slice(0, limit);
}
/** Keyword search over mirrored DSH transcripts and A2A conversation messages. */
async function searchConversations(paths, options) {
    const terms = (0, memoryText_1.extractConversationSearchTerms)(options.query);
    if (terms.length === 0)
        return [];
    const maxResults = Math.max(1, Math.min(10, Math.floor(options.maxResults ?? 5)));
    const before = typeof options.before === 'number' && Number.isFinite(options.before) ? options.before : null;
    const after = typeof options.after === 'number' && Number.isFinite(options.after) ? options.after : null;
    const matches = [];
    const consider = (record) => {
        if (before !== null && record.ts >= before)
            return;
        if (after !== null && record.ts <= after)
            return;
        const haystack = record.text.toLowerCase();
        if (!terms.some((term) => haystack.includes(term)))
            return;
        matches.push(record);
    };
    for (const sessionId of await listTranscriptSessions(paths)) {
        for (const turn of await readTranscript(paths, sessionId)) {
            consider({
                sessionId,
                channel: turn.channel,
                peerGlobalMetaId: turn.peerGlobalMetaId ?? null,
                peerName: null,
                role: turn.role,
                text: truncateText(turn.text, SNIPPET_MAX_CHARS),
                ts: turn.ts,
            });
        }
    }
    for (const fileName of await listA2AConversationFiles(paths)) {
        const conversation = await readA2AConversation(paths, fileName);
        if (!conversation || !Array.isArray(conversation.messages))
            continue;
        for (const message of conversation.messages) {
            if (typeof message?.content !== 'string' || !message.content.trim())
                continue;
            consider({
                sessionId: fileName.slice(0, -'.json'.length),
                channel: 'metaweb_private',
                peerGlobalMetaId: conversation.peer?.globalMetaId ?? null,
                peerName: conversation.peer?.name ?? null,
                role: message.direction === 'outgoing' ? 'assistant' : 'user',
                text: truncateText(message.content, SNIPPET_MAX_CHARS),
                ts: typeof message.timestamp === 'number' ? message.timestamp : 0,
            });
        }
    }
    matches.sort((left, right) => right.ts - left.ts);
    return matches.slice(0, maxResults);
}
