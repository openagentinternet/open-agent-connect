"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHAT_INTERIM_EXTENSION = exports.PRIVATE_CHAT_TURN_CONTEXT_TTL_MS = exports.MAX_INTERIM_MESSAGE_LENGTH = exports.DEFAULT_INTERIM_MESSAGE_QUOTA = exports.PRIVATE_CHAT_TURN_CONTEXT_FILE_NAME = void 0;
exports.privateChatTurnContextPath = privateChatTurnContextPath;
exports.writePrivateChatTurnContext = writePrivateChatTurnContext;
exports.readPrivateChatTurnContext = readPrivateChatTurnContext;
exports.consumePrivateChatTurnQuota = consumePrivateChatTurnQuota;
exports.normalizeInterimMessageText = normalizeInterimMessageText;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
/**
 * Host-issued "turn ticket" for bot-initiated interim private-chat messages
 * (IDBots send_private_chat parity, adapted to OAC's single-shot reply
 * runner: local runtimes execute skills as shell commands, so the controlled
 * send surface is a CLI command gated by a ticket file instead of an MCP
 * tool).
 *
 * Before each reply turn with a chat workspace, the reply runner writes
 * `.oac-private-chat-turn.json` into the workspace. It locks the recipient
 * to the turn's peer, caps how many interim updates the turn may deliver,
 * and expires shortly after the turn. `metabot chat interim --turn-file …`
 * validates and consumes the ticket before sending, so interim messaging
 * stays: turn-scoped, single-recipient, quota-capped, and time-boxed.
 */
exports.PRIVATE_CHAT_TURN_CONTEXT_FILE_NAME = '.oac-private-chat-turn.json';
exports.DEFAULT_INTERIM_MESSAGE_QUOTA = 3;
exports.MAX_INTERIM_MESSAGE_LENGTH = 600;
exports.PRIVATE_CHAT_TURN_CONTEXT_TTL_MS = 15 * 60_000;
exports.CHAT_INTERIM_EXTENSION = 'chatInterim';
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
async function writeJsonFileAtomically(filePath, value) {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await node_fs_1.promises.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await node_fs_1.promises.rename(tempPath, filePath);
}
function privateChatTurnContextPath(workspaceDir) {
    return node_path_1.default.join(workspaceDir, exports.PRIVATE_CHAT_TURN_CONTEXT_FILE_NAME);
}
/** Issues (overwrites) the ticket for a fresh reply turn. */
async function writePrivateChatTurnContext(input) {
    const now = input.now ?? Date.now();
    const ttlMs = Number.isFinite(input.ttlMs) && input.ttlMs > 0
        ? input.ttlMs
        : exports.PRIVATE_CHAT_TURN_CONTEXT_TTL_MS;
    const quota = Number.isFinite(input.quota) && input.quota > 0
        ? Math.floor(input.quota)
        : exports.DEFAULT_INTERIM_MESSAGE_QUOTA;
    const context = {
        version: 1,
        conversationId: normalizeText(input.conversationId),
        peerGlobalMetaId: normalizeText(input.peerGlobalMetaId),
        remaining: quota,
        issuedAt: now,
        expiresAt: now + ttlMs,
    };
    if (!context.conversationId || !context.peerGlobalMetaId) {
        throw new Error('Private-chat turn ticket requires conversationId and peerGlobalMetaId.');
    }
    await node_fs_1.promises.mkdir(input.workspaceDir, { recursive: true });
    await writeJsonFileAtomically(privateChatTurnContextPath(input.workspaceDir), context);
    return context;
}
async function readPrivateChatTurnContext(turnFilePath) {
    try {
        const raw = await node_fs_1.promises.readFile(turnFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed
            && parsed.version === 1
            && typeof parsed.conversationId === 'string'
            && typeof parsed.peerGlobalMetaId === 'string'
            && Number.isFinite(parsed.remaining)
            && Number.isFinite(parsed.expiresAt)) {
            return {
                version: 1,
                conversationId: parsed.conversationId.trim(),
                peerGlobalMetaId: parsed.peerGlobalMetaId.trim(),
                remaining: Math.floor(parsed.remaining),
                issuedAt: Number.isFinite(parsed.issuedAt) ? Math.floor(parsed.issuedAt) : 0,
                expiresAt: Math.floor(parsed.expiresAt),
            };
        }
        return null;
    }
    catch {
        return null;
    }
}
/**
 * Validates the ticket and atomically spends one interim slot. The recipient
 * comes from the ticket (never from the caller), so a spent or forged file
 * cannot redirect a send.
 */
async function consumePrivateChatTurnQuota(input) {
    const now = input.now ?? Date.now();
    const context = await readPrivateChatTurnContext(input.turnFilePath);
    if (!context)
        return { ok: false, error: 'ticket_not_found' };
    if (context.expiresAt <= now)
        return { ok: false, error: 'ticket_expired' };
    if (context.remaining <= 0)
        return { ok: false, error: 'ticket_exhausted' };
    const consumed = {
        ...context,
        remaining: context.remaining - 1,
    };
    try {
        await writeJsonFileAtomically(input.turnFilePath, consumed);
    }
    catch {
        return { ok: false, error: 'ticket_not_found' };
    }
    return { ok: true, context: consumed };
}
/** Normalizes candidate interim text: trimmed, length-capped, no close markers. */
function normalizeInterimMessageText(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text)
        return { ok: false, error: 'interim text is required' };
    if (text.length > exports.MAX_INTERIM_MESSAGE_LENGTH) {
        return { ok: false, error: `interim text must be at most ${exports.MAX_INTERIM_MESSAGE_LENGTH} characters` };
    }
    const finalLine = text.split(/\r?\n/u).reverse().find((line) => line.trim()) ?? '';
    if (/^(?:bye|goodbye)[.!。！]?$/iu.test(finalLine.trim())) {
        return { ok: false, error: 'interim updates must not carry a close marker' };
    }
    return { ok: true, text };
}
