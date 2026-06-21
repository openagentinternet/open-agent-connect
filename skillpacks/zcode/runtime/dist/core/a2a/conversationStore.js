"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveA2AConversationFilePath = resolveA2AConversationFilePath;
exports.createA2AConversationStore = createA2AConversationStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../state/paths");
const runtimeStateStore_1 = require("../state/runtimeStateStore");
const A2A_CONVERSATION_SCHEMA_VERSION = 1;
const MAX_MESSAGES = 2_000;
const LOCKFILE_BASE_DELAY_MS = 25;
const LOCKFILE_MAX_ATTEMPTS = 200;
const LOCKFILE_STALE_WITH_PID_MS = 5 * 60 * 1000;
const LOCKFILE_STALE_WITHOUT_PID_MS = 30_000;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeGlobalMetaIdPrefix(value, label) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) {
        throw new Error(`${label} globalMetaId is required for A2A conversation storage.`);
    }
    if (normalized.length < 8) {
        throw new Error(`${label} globalMetaId must be at least 8 characters for A2A conversation storage.`);
    }
    const prefix = normalized.slice(0, 8);
    if (!/^[a-z0-9]+$/.test(prefix)) {
        throw new Error(`${label} globalMetaId prefix contains unsupported filename characters.`);
    }
    return prefix;
}
function normalizeActor(actor) {
    return {
        ...actor,
        globalMetaId: normalizeText(actor.globalMetaId),
        name: normalizeText(actor.name) || null,
        avatar: normalizeText(actor.avatar) || null,
        chatPublicKey: normalizeText(actor.chatPublicKey) || null,
    };
}
function buildIndexes(messages, sessions) {
    const messageIds = messages.map(message => normalizeText(message.messageId)).filter(Boolean);
    const orderTxidToSessionId = {};
    const paymentTxidToSessionId = {};
    for (const session of sessions) {
        if (session.type !== 'service_order') {
            continue;
        }
        const sessionId = normalizeText(session.sessionId);
        if (!sessionId) {
            continue;
        }
        const orderTxid = normalizeText(session.orderTxid);
        const paymentTxid = normalizeText(session.paymentTxid);
        if (orderTxid) {
            orderTxidToSessionId[orderTxid] = sessionId;
        }
        if (paymentTxid) {
            paymentTxidToSessionId[paymentTxid] = sessionId;
        }
    }
    return {
        messageIds,
        orderTxidToSessionId,
        paymentTxidToSessionId,
    };
}
function cloneEmptyConversation(input) {
    const updatedAt = Date.now();
    return {
        version: A2A_CONVERSATION_SCHEMA_VERSION,
        local: normalizeActor(input.local),
        peer: normalizeActor(input.peer),
        messages: [],
        sessions: [],
        indexes: {
            messageIds: [],
            orderTxidToSessionId: {},
            paymentTxidToSessionId: {},
        },
        updatedAt,
    };
}
function normalizeMessages(messages) {
    if (!Array.isArray(messages)) {
        return [];
    }
    return messages
        .filter(message => normalizeText(message?.messageId))
        .slice(-MAX_MESSAGES);
}
function normalizeSessions(sessions) {
    if (!Array.isArray(sessions)) {
        return [];
    }
    return sessions
        .filter(session => normalizeText(session?.sessionId));
}
function normalizeConversationState(value, input) {
    if (!value || typeof value !== 'object') {
        return cloneEmptyConversation(input);
    }
    const messages = normalizeMessages(value.messages);
    const sessions = normalizeSessions(value.sessions);
    return {
        version: A2A_CONVERSATION_SCHEMA_VERSION,
        local: normalizeActor(value.local ?? input.local),
        peer: normalizeActor(value.peer ?? input.peer),
        messages,
        sessions,
        indexes: buildIndexes(messages, sessions),
        updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
    };
}
async function readJsonFile(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT') {
            return null;
        }
        if (error instanceof SyntaxError) {
            const corruptPath = `${filePath}.corrupt-${Date.now()}`;
            try {
                await node_fs_1.promises.rename(filePath, corruptPath);
            }
            catch {
                // Best effort quarantine so one bad peer file does not block A2A rendering.
            }
            return null;
        }
        throw error;
    }
}
async function readLockInfo(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            pid: typeof parsed.pid === 'number' ? parsed.pid : undefined,
            acquiredAt: typeof parsed.acquiredAt === 'number' ? parsed.acquiredAt : undefined,
        };
    }
    catch {
        return null;
    }
}
async function writeJsonFileAtomically(filePath, value) {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    let handle = null;
    try {
        handle = await node_fs_1.promises.open(tempPath, 'w');
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await handle.sync();
        await handle.close();
        handle = null;
        await node_fs_1.promises.rename(tempPath, filePath);
        try {
            const directoryHandle = await node_fs_1.promises.open(node_path_1.default.dirname(filePath), 'r');
            try {
                await directoryHandle.sync();
            }
            finally {
                await directoryHandle.close();
            }
        }
        catch (error) {
            const code = error.code;
            if (code !== 'EINVAL' && code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EBADF') {
                throw error;
            }
        }
    }
    catch (error) {
        if (handle) {
            await handle.close();
        }
        await node_fs_1.promises.rm(tempPath, { force: true });
        throw error;
    }
}
async function sleep(ms) {
    await new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        const code = error.code;
        return code !== 'ESRCH';
    }
}
async function withLock(lockPath, operation) {
    for (let attempt = 0; attempt < LOCKFILE_MAX_ATTEMPTS; attempt += 1) {
        try {
            const handle = await node_fs_1.promises.open(lockPath, 'wx');
            try {
                await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: Date.now() })}\n`, 'utf8');
                return await operation();
            }
            finally {
                await handle.close();
                try {
                    await node_fs_1.promises.rm(lockPath, { force: true });
                }
                catch {
                    // Best effort cleanup; stale lock recovery handles leftovers.
                }
            }
        }
        catch (error) {
            const code = error.code;
            if (code !== 'EEXIST') {
                throw error;
            }
            try {
                const lockInfo = await readLockInfo(lockPath);
                const stat = await node_fs_1.promises.stat(lockPath);
                const lockPid = typeof lockInfo?.pid === 'number' ? lockInfo.pid : null;
                const acquiredAt = typeof lockInfo?.acquiredAt === 'number' ? lockInfo.acquiredAt : stat.mtimeMs;
                const ownerAlive = lockPid ? isProcessAlive(lockPid) : false;
                if (lockPid && !ownerAlive) {
                    await node_fs_1.promises.rm(lockPath, { force: true });
                    continue;
                }
                const staleThreshold = lockPid ? LOCKFILE_STALE_WITH_PID_MS : LOCKFILE_STALE_WITHOUT_PID_MS;
                const stale = Date.now() - acquiredAt > staleThreshold;
                if (!lockPid && stale) {
                    await node_fs_1.promises.rm(lockPath, { force: true });
                    continue;
                }
            }
            catch {
                // Another writer may have released the lock between stat/remove attempts.
            }
            await sleep(Math.min(LOCKFILE_BASE_DELAY_MS * (attempt + 1), 250));
        }
    }
    throw new Error(`Timed out acquiring A2A conversation lock: ${lockPath}`);
}
function resolveA2AConversationFilePath(paths, localGlobalMetaId, peerGlobalMetaId) {
    const localPrefix = normalizeGlobalMetaIdPrefix(localGlobalMetaId, 'local');
    const peerPrefix = normalizeGlobalMetaIdPrefix(peerGlobalMetaId, 'peer');
    return node_path_1.default.join(paths.a2aRoot, `chat-${localPrefix}-${peerPrefix}.json`);
}
function createA2AConversationStore(input) {
    const paths = input.paths ?? (input.homeDir ? (0, paths_1.resolveMetabotPaths)(input.homeDir) : null);
    if (!paths) {
        throw new Error('homeDir or paths is required for A2A conversation storage.');
    }
    const local = normalizeActor(input.local);
    const peer = normalizeActor(input.peer);
    const conversationPath = resolveA2AConversationFilePath(paths, local.globalMetaId, peer.globalMetaId);
    const lockPath = `${conversationPath}.lock`;
    let pendingWrite = Promise.resolve();
    const runExclusive = async (operation) => {
        const next = pendingWrite.then(async () => {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            return withLock(lockPath, operation);
        }, async () => {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            return withLock(lockPath, operation);
        });
        pendingWrite = next.then(() => undefined, () => undefined);
        return next;
    };
    const readNormalized = async () => {
        await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
        return normalizeConversationState(await readJsonFile(conversationPath), { local, peer });
    };
    const writeNormalized = async (nextState) => {
        await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
        const normalized = normalizeConversationState({
            ...nextState,
            updatedAt: Date.now(),
        }, { local, peer });
        await writeJsonFileAtomically(conversationPath, normalized);
        return normalized;
    };
    return {
        paths,
        conversationPath,
        lockPath,
        async readConversation() {
            return readNormalized();
        },
        async writeConversation(nextState) {
            return runExclusive(async () => writeNormalized(nextState));
        },
        async updateConversation(updater) {
            return runExclusive(async () => {
                const current = normalizeConversationState(await readJsonFile(conversationPath), { local, peer });
                const nextState = await updater(current);
                return writeNormalized(nextState);
            });
        },
        async appendMessages(messages) {
            if (messages.length === 0) {
                return [];
            }
            let appended = [];
            await this.updateConversation(state => {
                const existingIds = new Set(state.messages.map(message => message.messageId));
                const uniqueMessages = [];
                for (const message of messages) {
                    const messageId = normalizeText(message.messageId);
                    if (!messageId || existingIds.has(messageId)) {
                        continue;
                    }
                    existingIds.add(messageId);
                    uniqueMessages.push({
                        ...message,
                        messageId,
                    });
                }
                appended = uniqueMessages;
                if (uniqueMessages.length === 0) {
                    return state;
                }
                return {
                    ...state,
                    messages: [...state.messages, ...uniqueMessages].slice(-MAX_MESSAGES),
                };
            });
            return appended;
        },
        async upsertSession(session) {
            await this.updateConversation(state => ({
                ...state,
                sessions: [
                    ...state.sessions.filter(existing => existing.sessionId !== session.sessionId),
                    session,
                ],
            }));
            return session;
        },
        async findSessionById(sessionId) {
            const normalizedSessionId = normalizeText(sessionId);
            if (!normalizedSessionId) {
                return null;
            }
            const state = await this.readConversation();
            return state.sessions.find(session => session.sessionId === normalizedSessionId) ?? null;
        },
        async findSessionByOrderTxid(orderTxid) {
            const normalizedOrderTxid = normalizeText(orderTxid);
            if (!normalizedOrderTxid) {
                return null;
            }
            const state = await this.readConversation();
            const sessionId = state.indexes.orderTxidToSessionId[normalizedOrderTxid];
            return sessionId
                ? state.sessions.find(session => session.sessionId === sessionId) ?? null
                : null;
        },
        async findSessionByPaymentTxid(paymentTxid) {
            const normalizedPaymentTxid = normalizeText(paymentTxid);
            if (!normalizedPaymentTxid) {
                return null;
            }
            const state = await this.readConversation();
            const sessionId = state.indexes.paymentTxidToSessionId[normalizedPaymentTxid];
            return sessionId
                ? state.sessions.find(session => session.sessionId === sessionId) ?? null
                : null;
        },
    };
}
