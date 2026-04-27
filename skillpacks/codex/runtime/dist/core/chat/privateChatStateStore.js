"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPrivateChatStateStore = createPrivateChatStateStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../state/paths");
const runtimeStateStore_1 = require("../state/runtimeStateStore");
const PRIVATE_CHAT_STATE_SCHEMA_VERSION = 1;
const MAX_MESSAGES = 10_000;
const MAX_CONVERSATIONS = 500;
const LOCKFILE_BASE_DELAY_MS = 25;
const LOCKFILE_MAX_ATTEMPTS = 200;
const LOCKFILE_STALE_WITH_PID_MS = 5 * 60 * 1000;
const LOCKFILE_STALE_WITHOUT_PID_MS = 30_000;
function cloneEmptyState() {
    return {
        version: PRIVATE_CHAT_STATE_SCHEMA_VERSION,
        conversations: [],
        messages: [],
    };
}
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
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
                // Best effort quarantine.
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
                    // Best effort cleanup.
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
    throw new Error(`Timed out acquiring private-chat-state lock: ${lockPath}`);
}
function normalizeState(value) {
    if (!value || typeof value !== 'object') {
        return cloneEmptyState();
    }
    const source = value;
    return {
        version: typeof source.version === 'number' ? source.version : PRIVATE_CHAT_STATE_SCHEMA_VERSION,
        conversations: Array.isArray(source.conversations)
            ? source.conversations.slice(-MAX_CONVERSATIONS)
            : [],
        messages: Array.isArray(source.messages)
            ? source.messages.slice(-MAX_MESSAGES)
            : [],
    };
}
function createPrivateChatStateStore(homeDirOrPaths) {
    const paths = typeof homeDirOrPaths === 'string' ? (0, paths_1.resolveMetabotPaths)(homeDirOrPaths) : homeDirOrPaths;
    const privateChatStatePath = paths.privateChatStatePath;
    const lockPath = `${privateChatStatePath}.lock`;
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
    return {
        paths,
        privateChatStatePath,
        async readState() {
            await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
            return normalizeState(await readJsonFile(privateChatStatePath));
        },
        async updateState(updater) {
            return runExclusive(async () => {
                await (0, runtimeStateStore_1.ensureRuntimeLayout)(paths);
                const current = normalizeState(await readJsonFile(privateChatStatePath));
                const nextState = await updater(current);
                const normalized = normalizeState(nextState);
                await writeJsonFileAtomically(privateChatStatePath, normalized);
                return normalized;
            });
        },
        async upsertConversation(conv) {
            await this.updateState(state => ({
                ...state,
                conversations: [
                    ...state.conversations.filter(c => c.conversationId !== conv.conversationId),
                    conv,
                ],
            }));
            return conv;
        },
        async appendMessages(messages) {
            if (messages.length === 0)
                return messages;
            await this.updateState(state => {
                const existingIds = new Set(state.messages.map(m => m.messageId));
                const newMessages = messages.filter(m => !existingIds.has(m.messageId));
                if (newMessages.length === 0)
                    return state;
                return {
                    ...state,
                    messages: [...state.messages, ...newMessages].slice(-MAX_MESSAGES),
                };
            });
            return messages;
        },
        async getConversationByPeer(peerGlobalMetaId) {
            const state = await this.readState();
            const normalizedPeer = normalizeText(peerGlobalMetaId).toLowerCase();
            const matching = state.conversations
                .filter(c => normalizeText(c.peerGlobalMetaId).toLowerCase() === normalizedPeer)
                .sort((a, b) => b.updatedAt - a.updatedAt);
            const active = matching.find(c => c.state === 'active');
            return active ?? matching[0] ?? null;
        },
        async getRecentMessages(conversationId, limit = 20) {
            const state = await this.readState();
            const filtered = state.messages
                .filter(m => m.conversationId === conversationId)
                .sort((a, b) => a.timestamp - b.timestamp);
            return filtered.slice(-limit);
        },
    };
}
