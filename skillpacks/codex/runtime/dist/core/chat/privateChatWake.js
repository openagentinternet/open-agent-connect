"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_EMPTY_REPLY_RETRY_DELAYS_MS = exports.DEFAULT_PRIVATE_CHAT_WAKE_DELAYS_MS = void 0;
exports.nextPrivateChatWakeAt = nextPrivateChatWakeAt;
exports.createPrivateChatWakeStore = createPrivateChatWakeStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
/**
 * Bounded host wake for silent-but-open private-chat conversations
 * (IDBots privateChatDaemon wake parity, 2026-09-16 deadlock postmortem).
 *
 * When a reply turn ends WITHOUT delivering anything — the model answered
 * `[NO_REPLY]`, an echo guard blocked the send, or the completion came back
 * empty — the conversation tail stays silent. The host only runs the bot
 * again when a NEW peer message arrives, so if the bot owes the peer a
 * deferred answer, both sides wait forever. This store arms a bounded timer
 * per conversation that re-drives the silent tail: the model gets a host
 * wake notice and decides again (deliver the owed answer / close politely /
 * stay silent). A new peer message, a delivered reply, or a closed
 * conversation cancels the wake.
 *
 * State persists at `<profile>/.runtime/state/private-chat-wake.json` (lazy,
 * atomic write-then-rename like the auto-reply backfill cursor; the only
 * writer is the profile's own orchestrator, so no lockfile is needed).
 */
exports.DEFAULT_PRIVATE_CHAT_WAKE_DELAYS_MS = [
    15 * 60_000,
    2 * 60 * 60_000,
    12 * 60 * 60_000,
];
exports.DEFAULT_EMPTY_REPLY_RETRY_DELAYS_MS = [
    15_000,
    60_000,
    240_000,
];
const WAKE_STATE_SCHEMA_VERSION = 1;
const WAKE_STATE_FILE_NAME = 'private-chat-wake.json';
const MAX_WAKE_RECORDS = 500;
/** Fire timestamp for the given delay schedule after `fires` fires. */
function nextPrivateChatWakeAt(fires, delays = exports.DEFAULT_PRIVATE_CHAT_WAKE_DELAYS_MS, now = Date.now()) {
    const safeFires = Number.isFinite(fires) && fires >= 0 ? Math.floor(fires) : 0;
    const delay = delays[safeFires];
    if (!Number.isFinite(delay) || delay <= 0)
        return null;
    return now + delay;
}
function normalizeDelays(value) {
    if (!Array.isArray(value))
        return null;
    const filtered = value
        .filter((entry) => Number.isFinite(entry) && entry > 0)
        .map((entry) => Math.floor(entry));
    return filtered.length > 0 ? filtered : null;
}
function normalizeRecord(value) {
    if (!value || typeof value !== 'object')
        return null;
    const source = value;
    const conversationId = typeof source.conversationId === 'string' ? source.conversationId.trim() : '';
    const peerGlobalMetaId = typeof source.peerGlobalMetaId === 'string' ? source.peerGlobalMetaId.trim() : '';
    const triggerMessageId = typeof source.triggerMessageId === 'string' ? source.triggerMessageId.trim() : '';
    const kind = source.kind === 'empty_reply' ? 'empty_reply' : 'silent_tail';
    const fires = Number.isFinite(source.fires) && source.fires >= 0
        ? Math.floor(source.fires)
        : 0;
    const fireAt = Number.isFinite(source.fireAt) && source.fireAt > 0
        ? Math.floor(source.fireAt)
        : 0;
    if (!conversationId || !peerGlobalMetaId || !triggerMessageId || !fireAt)
        return null;
    return {
        conversationId,
        peerGlobalMetaId,
        triggerMessageId,
        kind,
        fires,
        fireAt,
        scheduledAt: Number.isFinite(source.scheduledAt) && source.scheduledAt > 0
            ? Math.floor(source.scheduledAt)
            : fireAt,
    };
}
function normalizeState(value) {
    if (!value || typeof value !== 'object') {
        return { version: WAKE_STATE_SCHEMA_VERSION, wakes: [] };
    }
    const source = value;
    const wakes = Array.isArray(source.wakes)
        ? source.wakes
            .map(normalizeRecord)
            .filter((record) => record !== null)
        : [];
    return { version: WAKE_STATE_SCHEMA_VERSION, wakes: wakes.slice(-MAX_WAKE_RECORDS) };
}
async function readJsonFile(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT')
            return null;
        if (error instanceof SyntaxError)
            return null;
        throw error;
    }
}
async function writeJsonFileAtomically(filePath, value) {
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await node_fs_1.promises.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await node_fs_1.promises.rename(tempPath, filePath);
}
function createPrivateChatWakeStore(paths) {
    const wakeStatePath = node_path_1.default.join(paths.stateRoot, WAKE_STATE_FILE_NAME);
    let pendingWrite = Promise.resolve();
    const runExclusive = async (operation) => {
        const next = pendingWrite.then(operation, operation);
        pendingWrite = next.then(() => undefined, () => undefined);
        return next;
    };
    return {
        async readWakes() {
            return normalizeState(await readJsonFile(wakeStatePath)).wakes;
        },
        async schedule(input) {
            return runExclusive(async () => {
                const fireAt = nextPrivateChatWakeAt(input.fires, input.delays ?? exports.DEFAULT_PRIVATE_CHAT_WAKE_DELAYS_MS, input.now);
                if (!fireAt)
                    return null;
                const state = normalizeState(await readJsonFile(wakeStatePath));
                const record = {
                    conversationId: input.conversationId,
                    peerGlobalMetaId: input.peerGlobalMetaId,
                    triggerMessageId: input.triggerMessageId,
                    kind: input.kind,
                    fires: input.fires,
                    fireAt,
                    scheduledAt: input.now,
                };
                const wakes = [
                    ...state.wakes.filter((entry) => entry.conversationId !== record.conversationId),
                    record,
                ].slice(-MAX_WAKE_RECORDS);
                await writeJsonFileAtomically(wakeStatePath, { version: WAKE_STATE_SCHEMA_VERSION, wakes });
                return record;
            });
        },
        async deferFire(conversationId, byMs) {
            await runExclusive(async () => {
                const state = normalizeState(await readJsonFile(wakeStatePath));
                const wakes = state.wakes.map((entry) => (entry.conversationId === conversationId
                    ? { ...entry, fireAt: entry.fireAt + Math.max(1, Math.floor(byMs)) }
                    : entry));
                await writeJsonFileAtomically(wakeStatePath, { version: WAKE_STATE_SCHEMA_VERSION, wakes });
            });
        },
        async remove(conversationId) {
            await runExclusive(async () => {
                const state = normalizeState(await readJsonFile(wakeStatePath));
                const wakes = state.wakes.filter((entry) => entry.conversationId !== conversationId);
                if (wakes.length === state.wakes.length)
                    return;
                await writeJsonFileAtomically(wakeStatePath, { version: WAKE_STATE_SCHEMA_VERSION, wakes });
            });
        },
    };
}
