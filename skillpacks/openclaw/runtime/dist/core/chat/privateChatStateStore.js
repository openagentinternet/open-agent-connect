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
const DEFAULT_PENDING_GUIDANCE_LEASE_MS = 5 * 60 * 1000;
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
function normalizeTimestampMs(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 0;
    }
    return numeric < 1_000_000_000_000 ? Math.floor(numeric * 1000) : Math.floor(numeric);
}
function normalizeConversation(conversation) {
    const source = conversation;
    const pendingGuidanceText = normalizeText(source.pendingGuidanceText);
    return {
        ...conversation,
        pendingGuidanceText: pendingGuidanceText || null,
        pendingGuidanceCreatedAt: pendingGuidanceText && typeof source.pendingGuidanceCreatedAt === 'number'
            ? source.pendingGuidanceCreatedAt
            : null,
        pendingGuidanceLeaseId: typeof source.pendingGuidanceLeaseId === 'string' ? source.pendingGuidanceLeaseId : null,
        pendingGuidanceLeaseExpiresAt: typeof source.pendingGuidanceLeaseExpiresAt === 'number' ? source.pendingGuidanceLeaseExpiresAt : null,
    };
}
function buildPendingGuidanceLeaseId() {
    const random = Math.random().toString(36).slice(2, 10);
    return `guidance-lease-${Date.now()}-${random}`;
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
            ? source.conversations
                .slice(-MAX_CONVERSATIONS)
                .map(normalizeConversation)
            : [],
        messages: Array.isArray(source.messages)
            ? source.messages
                .slice(-MAX_MESSAGES)
                .map((message) => ({
                ...message,
                timestamp: normalizeTimestampMs(message.timestamp),
            }))
            : [],
    };
}
function replaceConversation(conversations, conversationId, updater) {
    return conversations.map(conversation => conversation.conversationId === conversationId ? updater(conversation) : conversation);
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
                    normalizeConversation(conv),
                ],
            }));
            return normalizeConversation(conv);
        },
        async setPendingGuidance(conversationId, guidanceText, createdAt) {
            let updatedConversation = null;
            const normalizedGuidanceText = normalizeText(guidanceText);
            await this.updateState(state => {
                const conversations = replaceConversation(state.conversations, conversationId, conversation => {
                    updatedConversation = {
                        ...conversation,
                        pendingGuidanceText: normalizedGuidanceText || null,
                        pendingGuidanceCreatedAt: normalizedGuidanceText ? createdAt : null,
                        pendingGuidanceLeaseId: null,
                        pendingGuidanceLeaseExpiresAt: null,
                    };
                    return updatedConversation;
                });
                return { ...state, conversations };
            });
            return updatedConversation;
        },
        async setPendingGuidanceAndClaim(conversationId, guidanceText, createdAt, options = {}) {
            let updatedConversation = null;
            let claim = null;
            const normalizedGuidanceText = normalizeText(guidanceText);
            const now = typeof options.now === 'number' ? options.now : Date.now();
            const leaseMs = typeof options.leaseMs === 'number'
                ? Math.max(1, Math.trunc(options.leaseMs))
                : DEFAULT_PENDING_GUIDANCE_LEASE_MS;
            await this.updateState(state => {
                const conversations = replaceConversation(state.conversations, conversationId, conversation => {
                    if (!normalizedGuidanceText) {
                        updatedConversation = {
                            ...conversation,
                            pendingGuidanceText: null,
                            pendingGuidanceCreatedAt: null,
                            pendingGuidanceLeaseId: null,
                            pendingGuidanceLeaseExpiresAt: null,
                        };
                        return updatedConversation;
                    }
                    const leaseId = buildPendingGuidanceLeaseId();
                    const leaseExpiresAt = now + leaseMs;
                    updatedConversation = {
                        ...conversation,
                        pendingGuidanceText: normalizedGuidanceText,
                        pendingGuidanceCreatedAt: createdAt,
                        pendingGuidanceLeaseId: leaseId,
                        pendingGuidanceLeaseExpiresAt: leaseExpiresAt,
                    };
                    claim = {
                        guidanceText: normalizedGuidanceText,
                        createdAt,
                        leaseId,
                        leaseExpiresAt,
                    };
                    return updatedConversation;
                });
                return { ...state, conversations };
            });
            return updatedConversation && claim
                ? { conversation: updatedConversation, claim }
                : null;
        },
        async claimPendingGuidance(conversationId, options = {}) {
            let claim = null;
            const now = typeof options.now === 'number' ? options.now : Date.now();
            const leaseMs = typeof options.leaseMs === 'number'
                ? Math.max(1, Math.trunc(options.leaseMs))
                : DEFAULT_PENDING_GUIDANCE_LEASE_MS;
            await this.updateState(state => {
                const conversations = replaceConversation(state.conversations, conversationId, conversation => {
                    const guidanceText = normalizeText(conversation.pendingGuidanceText);
                    const createdAt = conversation.pendingGuidanceCreatedAt;
                    if (!guidanceText || typeof createdAt !== 'number') {
                        return conversation;
                    }
                    const activeLeaseId = normalizeText(conversation.pendingGuidanceLeaseId);
                    const activeLeaseExpiresAt = conversation.pendingGuidanceLeaseExpiresAt;
                    if (activeLeaseId
                        && typeof activeLeaseExpiresAt === 'number'
                        && activeLeaseExpiresAt > now) {
                        return conversation;
                    }
                    const leaseId = buildPendingGuidanceLeaseId();
                    const leaseExpiresAt = now + leaseMs;
                    claim = {
                        guidanceText,
                        createdAt,
                        leaseId,
                        leaseExpiresAt,
                    };
                    return {
                        ...conversation,
                        pendingGuidanceLeaseId: leaseId,
                        pendingGuidanceLeaseExpiresAt: leaseExpiresAt,
                    };
                });
                return { ...state, conversations };
            });
            return claim;
        },
        async releasePendingGuidanceClaimIfMatches(conversationId, claim) {
            let updatedConversation = null;
            await this.updateState(state => {
                const conversations = replaceConversation(state.conversations, conversationId, conversation => {
                    if (conversation.pendingGuidanceText !== claim.guidanceText ||
                        conversation.pendingGuidanceCreatedAt !== claim.createdAt ||
                        conversation.pendingGuidanceLeaseId !== claim.leaseId) {
                        updatedConversation = conversation;
                        return conversation;
                    }
                    updatedConversation = {
                        ...conversation,
                        pendingGuidanceLeaseId: null,
                        pendingGuidanceLeaseExpiresAt: null,
                    };
                    return updatedConversation;
                });
                return { ...state, conversations };
            });
            return updatedConversation;
        },
        async clearPendingGuidanceIfMatches(conversationId, guidanceText, createdAt, leaseId = null) {
            let updatedConversation = null;
            await this.updateState(state => {
                const conversations = replaceConversation(state.conversations, conversationId, conversation => {
                    if (conversation.pendingGuidanceText !== guidanceText ||
                        conversation.pendingGuidanceCreatedAt !== createdAt ||
                        (leaseId && conversation.pendingGuidanceLeaseId !== leaseId)) {
                        updatedConversation = conversation;
                        return conversation;
                    }
                    updatedConversation = {
                        ...conversation,
                        pendingGuidanceText: null,
                        pendingGuidanceCreatedAt: null,
                        pendingGuidanceLeaseId: null,
                        pendingGuidanceLeaseExpiresAt: null,
                    };
                    return updatedConversation;
                });
                return { ...state, conversations };
            });
            return updatedConversation;
        },
        async appendMessages(messages) {
            if (messages.length === 0)
                return messages;
            let appendedMessages = messages;
            await this.updateState(state => {
                const normalizedMessages = messages.map(message => ({
                    ...message,
                    timestamp: normalizeTimestampMs(message.timestamp),
                }));
                const existingIds = new Set(state.messages.map(m => m.messageId));
                const newMessages = normalizedMessages.filter(m => !existingIds.has(m.messageId));
                appendedMessages = newMessages;
                if (newMessages.length === 0)
                    return state;
                return {
                    ...state,
                    messages: [...state.messages, ...newMessages].slice(-MAX_MESSAGES),
                };
            });
            return appendedMessages;
        },
        async replaceMessage(messageId, replacement) {
            const normalizedMessageId = normalizeText(messageId);
            if (!normalizedMessageId)
                return null;
            let replacedMessage = null;
            await this.updateState(state => {
                const messageIndex = state.messages.findIndex(message => message.messageId === normalizedMessageId);
                if (messageIndex < 0)
                    return state;
                const normalizedReplacement = {
                    ...replacement,
                    messageId: normalizedMessageId,
                    timestamp: normalizeTimestampMs(replacement.timestamp),
                };
                const messages = state.messages.slice();
                messages[messageIndex] = normalizedReplacement;
                replacedMessage = normalizedReplacement;
                return { ...state, messages };
            });
            return replacedMessage;
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
