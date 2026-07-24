"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPrivateChatAutoReplyBackfillLoop = createPrivateChatAutoReplyBackfillLoop;
exports.createPrivateChatAutoReplyBackfillProfileManager = createPrivateChatAutoReplyBackfillProfileManager;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const mvcPendingUtxos_1 = require("../chain/mvcPendingUtxos");
const simplemsgClassifier_1 = require("../a2a/simplemsgClassifier");
const identityProfiles_1 = require("../identity/identityProfiles");
const privateConversation_1 = require("./privateConversation");
const CURSOR_STATE_VERSION = 1;
const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_RECENT_LIMIT = 100;
const DEFAULT_STARTUP_CATCH_UP_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_OUTBOUND_RECOVERY_ATTEMPTS = 3;
const UNABLE_TO_DECRYPT_TEXT = '[Unable to decrypt message]';
const UNSUPPORTED_FILE_TEXT = '[Unsupported file message]';
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeGlobalMetaId(value) {
    return normalizeText(value).toLowerCase();
}
function normalizePositiveInteger(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}
function normalizeEpochSeconds(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0)
        return 0;
    return Math.floor(numeric > 1_000_000_000_000 ? numeric / 1000 : numeric);
}
function emptyCursorState() {
    return {
        version: CURSOR_STATE_VERSION,
        peers: {},
    };
}
function normalizeCursorState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return emptyCursorState();
    }
    const record = value;
    const peersRecord = record.peers && typeof record.peers === 'object' && !Array.isArray(record.peers)
        ? record.peers
        : {};
    const peers = {};
    for (const [rawPeer, rawState] of Object.entries(peersRecord)) {
        const peer = normalizeGlobalMetaId(rawPeer);
        const state = rawState && typeof rawState === 'object' && !Array.isArray(rawState)
            ? rawState
            : null;
        const afterIndex = Number(state?.afterIndex);
        if (!peer || !Number.isFinite(afterIndex) || afterIndex < 0) {
            continue;
        }
        peers[peer] = {
            afterIndex: Math.floor(afterIndex),
            updatedAt: Number.isFinite(Number(state?.updatedAt))
                ? Math.floor(Number(state?.updatedAt))
                : 0,
        };
    }
    return {
        version: CURSOR_STATE_VERSION,
        peers,
    };
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
async function readCursorState(cursorPath) {
    return normalizeCursorState(await readJsonFile(cursorPath));
}
async function writeCursorState(cursorPath, state) {
    await writeJsonFileAtomically(cursorPath, normalizeCursorState(state));
}
async function listA2AConversationPeerGlobalMetaIds(paths) {
    let entries;
    try {
        entries = await node_fs_1.promises.readdir(paths.a2aRoot);
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT')
            return [];
        throw error;
    }
    const peers = [];
    for (const entry of entries) {
        if (!entry.startsWith('chat-') || !entry.endsWith('.json')) {
            continue;
        }
        try {
            const raw = await node_fs_1.promises.readFile(node_path_1.default.join(paths.a2aRoot, entry), 'utf8');
            const parsed = JSON.parse(raw);
            const peer = normalizeText(parsed.peer?.globalMetaId);
            if (peer)
                peers.push(peer);
        }
        catch {
            continue;
        }
    }
    return peers;
}
function collectProcessedMessageIds(state) {
    const ids = new Set();
    for (const message of state.messages) {
        const messageId = normalizeText(message.messageId);
        const pinId = normalizeText(message.messagePinId);
        if (messageId)
            ids.add(messageId);
        if (pinId)
            ids.add(pinId);
    }
    return ids;
}
function mapConversationPeerById(state) {
    const byId = new Map();
    for (const conversation of state.conversations) {
        const conversationId = normalizeText(conversation.conversationId);
        const peer = normalizeText(conversation.peerGlobalMetaId);
        if (conversationId && peer) {
            byId.set(conversationId, peer);
        }
    }
    return byId;
}
function collectLatestInboundTimestampByPeer(state) {
    const conversationPeerById = mapConversationPeerById(state);
    const latestByPeer = new Map();
    for (const message of state.messages) {
        if (message.direction !== 'inbound')
            continue;
        const peer = normalizeGlobalMetaId(conversationPeerById.get(message.conversationId) || message.senderGlobalMetaId);
        if (!peer)
            continue;
        const timestampSeconds = normalizeEpochSeconds(message.timestamp);
        latestByPeer.set(peer, Math.max(latestByPeer.get(peer) ?? 0, timestampSeconds));
    }
    return latestByPeer;
}
async function collectKnownPeerGlobalMetaIds(deps, state, selfGlobalMetaId) {
    const peers = new Map();
    const addPeer = (value) => {
        const peer = normalizeText(value);
        const key = normalizeGlobalMetaId(peer);
        if (!peer || !key || key === normalizeGlobalMetaId(selfGlobalMetaId))
            return;
        peers.set(key, peer);
    };
    for (const conversation of state.conversations) {
        addPeer(conversation.peerGlobalMetaId);
    }
    for (const peer of await listA2AConversationPeerGlobalMetaIds(deps.paths)) {
        addPeer(peer);
    }
    if (deps.listPeerGlobalMetaIds) {
        for (const peer of await deps.listPeerGlobalMetaIds()) {
            addPeer(peer);
        }
    }
    return Array.from(peers.values());
}
function isReplyableIncomingMessage(message, selfGlobalMetaId, peerGlobalMetaId) {
    if (normalizeGlobalMetaId(message.fromGlobalMetaId) !== normalizeGlobalMetaId(peerGlobalMetaId)) {
        return false;
    }
    if (normalizeGlobalMetaId(message.toGlobalMetaId) !== normalizeGlobalMetaId(selfGlobalMetaId)) {
        return false;
    }
    if (message.protocol && message.protocol !== '/protocols/simplemsg') {
        return false;
    }
    const content = normalizeText(message.content);
    return Boolean(content)
        && content !== UNABLE_TO_DECRYPT_TEXT
        && content !== UNSUPPORTED_FILE_TEXT;
}
function shouldProcessInitialMessage(input) {
    const messageTimestampSeconds = normalizeEpochSeconds(input.message.timestamp);
    if (!messageTimestampSeconds)
        return false;
    const nowSeconds = normalizeEpochSeconds(input.nowMs);
    const catchUpCutoffSeconds = nowSeconds - Math.floor(input.startupCatchUpMs / 1000);
    if (messageTimestampSeconds < catchUpCutoffSeconds)
        return false;
    const latestInbound = input.latestInboundTimestampByPeer.get(normalizeGlobalMetaId(input.peerGlobalMetaId)) ?? 0;
    return latestInbound <= 0 || messageTimestampSeconds > latestInbound;
}
function createRawBackfillMessage(message) {
    return {
        source: 'private-chat-history-backfill',
        pinId: normalizeText(message.pinId) || null,
        txId: normalizeText(message.txId) || null,
        index: message.index,
        protocol: message.protocol,
    };
}
function toInboundMessage(message, peerChatPublicKey) {
    return {
        fromGlobalMetaId: message.fromGlobalMetaId,
        content: message.content,
        messagePinId: normalizeText(message.pinId) || normalizeText(message.txId) || message.id || null,
        fromChatPublicKey: peerChatPublicKey,
        timestamp: message.timestamp,
        rawMessage: createRawBackfillMessage(message),
    };
}
function createDefaultHistoryClient(options) {
    return {
        async fetchRecent(historyInput) {
            const chatApiBaseUrl = await Promise.resolve(options.resolveChatApiBaseUrl?.());
            const firstPage = await (0, privateConversation_1.fetchPrivateChatHistoryPage)({
                selfGlobalMetaId: historyInput.selfGlobalMetaId,
                peerGlobalMetaId: historyInput.peerGlobalMetaId,
                startIndex: 0,
                limit: 1,
                chatApiBaseUrl,
                fetchImpl: options.fetchImpl,
            });
            const startIndex = firstPage.total === null
                ? 0
                : Math.max(0, firstPage.total - historyInput.limit);
            const page = await (0, privateConversation_1.fetchPrivateChatHistoryPage)({
                selfGlobalMetaId: historyInput.selfGlobalMetaId,
                peerGlobalMetaId: historyInput.peerGlobalMetaId,
                startIndex,
                limit: historyInput.limit,
                chatApiBaseUrl,
                fetchImpl: options.fetchImpl,
            });
            return (0, privateConversation_1.buildPrivateConversationResponse)({
                selfGlobalMetaId: historyInput.selfGlobalMetaId,
                peerGlobalMetaId: historyInput.peerGlobalMetaId,
                localPrivateKeyHex: historyInput.localPrivateKeyHex,
                peerChatPublicKey: historyInput.peerChatPublicKey,
                afterIndex: startIndex > 0 ? startIndex - 1 : undefined,
                limit: historyInput.limit,
                fetchHistory: async () => page.rows,
            });
        },
        async fetchAfter(historyInput) {
            const chatApiBaseUrl = await Promise.resolve(options.resolveChatApiBaseUrl?.());
            return (0, privateConversation_1.buildPrivateConversationResponse)({
                selfGlobalMetaId: historyInput.selfGlobalMetaId,
                peerGlobalMetaId: historyInput.peerGlobalMetaId,
                localPrivateKeyHex: historyInput.localPrivateKeyHex,
                peerChatPublicKey: historyInput.peerChatPublicKey,
                afterIndex: historyInput.afterIndex,
                limit: historyInput.limit,
                chatApiBaseUrl,
                fetchImpl: options.fetchImpl,
            });
        },
    };
}
function getMessageDedupId(message) {
    return normalizeText(message.pinId) || normalizeText(message.txId) || normalizeText(message.id);
}
function normalizePinTransactionId(value) {
    return normalizeText(value).replace(/i\d+$/iu, '');
}
function collectHistoryMessageIds(messages) {
    const ids = new Set();
    for (const message of messages) {
        for (const value of [message.id, message.pinId, message.txId]) {
            const normalized = normalizeText(value);
            if (normalized)
                ids.add(normalized);
            const transactionId = normalizePinTransactionId(normalized);
            if (transactionId)
                ids.add(transactionId);
        }
    }
    return ids;
}
function isOutboundMessageVisible(message, historyMessages) {
    const historyIds = collectHistoryMessageIds(historyMessages);
    const attemptedPinIds = [
        message.messagePinId,
        ...(message.deliveryRecovery?.failedPinIds ?? []),
    ];
    return attemptedPinIds.some((value) => {
        const normalized = normalizeText(value);
        return Boolean(normalized) && (historyIds.has(normalized)
            || historyIds.has(normalizePinTransactionId(normalized)));
    });
}
function createPrivateChatAutoReplyBackfillLoop(deps, options = {}) {
    const intervalMs = normalizePositiveInteger(options.intervalMs, DEFAULT_INTERVAL_MS);
    const recentLimit = normalizePositiveInteger(options.recentLimit, DEFAULT_RECENT_LIMIT);
    const startupCatchUpMs = normalizePositiveInteger(options.startupCatchUpMs, DEFAULT_STARTUP_CATCH_UP_MS);
    const outboundRecoveryDelayMs = normalizePositiveInteger(options.outboundRecoveryDelayMs, mvcPendingUtxos_1.MVC_PENDING_UTXO_TTL_MS);
    const maxOutboundRecoveryAttempts = normalizePositiveInteger(options.maxOutboundRecoveryAttempts, DEFAULT_MAX_OUTBOUND_RECOVERY_ATTEMPTS);
    const cursorPath = options.cursorPath
        ?? node_path_1.default.join(deps.paths.stateRoot, 'private-chat-auto-reply-backfill.json');
    const historyClient = deps.historyClient ?? createDefaultHistoryClient({
        resolveChatApiBaseUrl: deps.resolveChatApiBaseUrl,
        fetchImpl: deps.fetchImpl,
    });
    const getNow = deps.now ?? (() => Date.now());
    let timer = null;
    let syncing = false;
    const syncOnce = async () => {
        const selfGlobalMetaId = normalizeText(await deps.selfGlobalMetaId());
        if (!selfGlobalMetaId) {
            return { peers: 0, processed: 0, skipped: 0, failed: 0, recovered: 0 };
        }
        const localIdentity = await deps.getLocalPrivateChatIdentity();
        const localPrivateKeyHex = normalizeText(localIdentity.privateKeyHex);
        if (!localPrivateKeyHex) {
            return { peers: 0, processed: 0, skipped: 0, failed: 0, recovered: 0 };
        }
        const state = await deps.stateStore.readState();
        const processedIds = collectProcessedMessageIds(state);
        const latestInboundTimestampByPeer = collectLatestInboundTimestampByPeer(state);
        const peers = await collectKnownPeerGlobalMetaIds(deps, state, selfGlobalMetaId);
        const cursorState = await readCursorState(cursorPath);
        let cursorChanged = false;
        let processed = 0;
        let skipped = 0;
        let failed = 0;
        let recovered = 0;
        for (const peerGlobalMetaId of peers) {
            const peerKey = normalizeGlobalMetaId(peerGlobalMetaId);
            const peerChatPublicKey = normalizeText(await deps.resolvePeerChatPublicKey(peerGlobalMetaId));
            if (!peerChatPublicKey) {
                skipped += 1;
                continue;
            }
            const existingCursor = cursorState.peers[peerKey];
            let response;
            try {
                response = existingCursor
                    ? await historyClient.fetchAfter({
                        selfGlobalMetaId,
                        peerGlobalMetaId,
                        localPrivateKeyHex,
                        peerChatPublicKey,
                        // MetaSO can assign the same index to messages from opposite directions.
                        // Re-read the cursor index and rely on message IDs to deduplicate it.
                        afterIndex: Math.max(-1, existingCursor.afterIndex - 1),
                        limit: recentLimit,
                    })
                    : await historyClient.fetchRecent({
                        selfGlobalMetaId,
                        peerGlobalMetaId,
                        localPrivateKeyHex,
                        peerChatPublicKey,
                        limit: recentLimit,
                    });
            }
            catch (error) {
                failed += 1;
                deps.onError?.(error instanceof Error ? error : new Error(String(error)));
                continue;
            }
            let peerFailed = false;
            for (const message of response.messages) {
                if (!isReplyableIncomingMessage(message, selfGlobalMetaId, peerGlobalMetaId)) {
                    skipped += 1;
                    continue;
                }
                const dedupId = getMessageDedupId(message);
                if (dedupId && processedIds.has(dedupId)) {
                    skipped += 1;
                    continue;
                }
                if (!existingCursor && !shouldProcessInitialMessage({
                    message,
                    peerGlobalMetaId,
                    latestInboundTimestampByPeer,
                    nowMs: getNow(),
                    startupCatchUpMs,
                })) {
                    skipped += 1;
                    continue;
                }
                try {
                    await deps.handleInboundMessage(toInboundMessage(message, peerChatPublicKey));
                    if (dedupId)
                        processedIds.add(dedupId);
                    processed += 1;
                }
                catch (error) {
                    failed += 1;
                    peerFailed = true;
                    deps.onError?.(error instanceof Error ? error : new Error(String(error)));
                }
            }
            if (!peerFailed) {
                const nextAfterIndex = Math.max(existingCursor?.afterIndex ?? 0, Number.isFinite(Number(response.nextPollAfterIndex))
                    ? Math.floor(Number(response.nextPollAfterIndex))
                    : 0);
                cursorState.peers[peerKey] = {
                    afterIndex: nextAfterIndex,
                    updatedAt: getNow(),
                };
                cursorChanged = true;
            }
            if (deps.recoverOutboundMessage) {
                const conversation = await deps.stateStore.getConversationByPeer(peerGlobalMetaId);
                const latestMessages = conversation
                    ? await deps.stateStore.getRecentMessages(conversation.conversationId, 1)
                    : [];
                const latestMessage = latestMessages.at(-1) ?? null;
                const retryCount = latestMessage?.deliveryRecovery?.retryCount ?? 0;
                const recoveryEligible = Boolean(latestMessage
                    && latestMessage.direction === 'outbound'
                    && normalizeText(latestMessage.messagePinId)
                    && (0, simplemsgClassifier_1.classifySimplemsgContent)(latestMessage.content).kind === 'private_chat'
                    && getNow() - latestMessage.timestamp >= outboundRecoveryDelayMs
                    && retryCount < maxOutboundRecoveryAttempts);
                if (recoveryEligible && latestMessage) {
                    try {
                        const recoveryHistory = existingCursor
                            ? await historyClient.fetchRecent({
                                selfGlobalMetaId,
                                peerGlobalMetaId,
                                localPrivateKeyHex,
                                peerChatPublicKey,
                                limit: recentLimit,
                            })
                            : response;
                        if (!isOutboundMessageVisible(latestMessage, recoveryHistory.messages)) {
                            if (await deps.recoverOutboundMessage(peerGlobalMetaId, latestMessage)) {
                                recovered += 1;
                            }
                        }
                    }
                    catch (error) {
                        failed += 1;
                        deps.onError?.(error instanceof Error ? error : new Error(String(error)));
                    }
                }
            }
        }
        if (cursorChanged) {
            await writeCursorState(cursorPath, cursorState);
        }
        return {
            peers: peers.length,
            processed,
            skipped,
            failed,
            recovered,
        };
    };
    const runBackgroundSync = () => {
        if (syncing)
            return;
        syncing = true;
        void syncOnce()
            .catch((error) => {
            deps.onError?.(error instanceof Error ? error : new Error(String(error)));
        })
            .finally(() => {
            syncing = false;
        });
    };
    return {
        syncOnce,
        start() {
            if (timer)
                return;
            runBackgroundSync();
            timer = setInterval(runBackgroundSync, intervalMs);
            timer.unref?.();
        },
        stop() {
            if (!timer)
                return;
            clearInterval(timer);
            timer = null;
        },
        isRunning() {
            return timer !== null;
        },
    };
}
function cloneProfileReport(report) {
    return {
        started: report.started.map((profile) => ({
            ...profile,
            aliases: profile.aliases.slice(),
        })),
        skipped: report.skipped.map((entry) => ({
            profile: {
                ...entry.profile,
                aliases: entry.profile.aliases.slice(),
            },
            reason: entry.reason,
        })),
    };
}
function createPrivateChatAutoReplyBackfillProfileManager(input) {
    const listProfiles = input.listProfiles ?? identityProfiles_1.listIdentityProfiles;
    let loops = [];
    let running = false;
    let lastReport = {
        started: [],
        skipped: [],
    };
    return {
        async start() {
            if (running)
                return cloneProfileReport(lastReport);
            const profiles = await listProfiles(input.systemHomeDir);
            const nextLoops = [];
            const started = [];
            const skipped = [];
            for (const profile of profiles) {
                try {
                    const loop = await input.createLoop(profile);
                    if (!loop) {
                        skipped.push({ profile, reason: 'profile_backfill_unavailable' });
                        continue;
                    }
                    loop.start();
                    nextLoops.push(loop);
                    started.push(profile);
                }
                catch (error) {
                    skipped.push({
                        profile,
                        reason: error instanceof Error ? error.message : String(error),
                    });
                }
            }
            loops = nextLoops;
            running = true;
            lastReport = { started, skipped };
            return cloneProfileReport(lastReport);
        },
        stop() {
            for (const loop of loops) {
                loop.stop();
            }
            loops = [];
            running = false;
            lastReport = { started: [], skipped: [] };
        },
        isRunning() {
            return running;
        },
        getLastReport() {
            return cloneProfileReport(lastReport);
        },
    };
}
