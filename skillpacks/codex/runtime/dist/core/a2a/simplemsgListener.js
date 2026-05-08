"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeSimplemsgSocketMessage = normalizeSimplemsgSocketMessage;
exports.createA2ASimplemsgListenerManager = createA2ASimplemsgListenerManager;
const socket_io_client_1 = require("socket.io-client");
const identityProfiles_1 = require("../identity/identityProfiles");
const fileSecretStore_1 = require("../secrets/fileSecretStore");
const paths_1 = require("../state/paths");
const localMnemonicSigner_1 = require("../signing/localMnemonicSigner");
const privateChatListener_1 = require("../chat/privateChatListener");
const conversationPersistence_1 = require("./conversationPersistence");
const DEFAULT_SOCKET_ENDPOINTS = [
    { url: 'wss://api.idchat.io', path: '/socket/socket.io' },
    { url: 'wss://www.show.now', path: '/socket/socket.io' },
];
const DEFAULT_RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const MAX_SEEN_PIN_IDS = 5_000;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function toFiniteTimestamp(value) {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.trunc(value)
        : Date.now();
}
function defaultSocketClientFactory(endpoint, options) {
    return (0, socket_io_client_1.io)(endpoint.url, options);
}
function deduplicateByPinId(seenPinIds, pinId) {
    if (!pinId)
        return true;
    if (seenPinIds.has(pinId))
        return false;
    seenPinIds.add(pinId);
    if (seenPinIds.size > MAX_SEEN_PIN_IDS) {
        const iterator = seenPinIds.values();
        for (let i = 0; i < 1000; i += 1) {
            const next = iterator.next();
            if (next.done)
                break;
            seenPinIds.delete(next.value);
        }
    }
    return true;
}
async function loadProfileIdentity(profile) {
    const paths = (0, paths_1.resolveMetabotPaths)(profile.homeDir);
    const profileGlobalMetaId = normalizeText(profile.globalMetaId);
    const secretStore = (0, fileSecretStore_1.createFileSecretStore)(paths);
    const secrets = await secretStore.readIdentitySecrets();
    const secretGlobalMetaId = normalizeText(secrets?.globalMetaId);
    let globalMetaId = secretGlobalMetaId || profileGlobalMetaId;
    let privateKeyHex = normalizeText(secrets?.privateKeyHex);
    let chatPublicKey = normalizeText(secrets?.chatPublicKey);
    if (profileGlobalMetaId && secretGlobalMetaId && profileGlobalMetaId !== secretGlobalMetaId) {
        return null;
    }
    if (!globalMetaId || !privateKeyHex || !chatPublicKey) {
        const signer = (0, localMnemonicSigner_1.createLocalMnemonicSigner)({ secretStore });
        const derived = await signer.getPrivateChatIdentity();
        globalMetaId = normalizeText(derived.globalMetaId);
        privateKeyHex = normalizeText(derived.privateKeyHex);
        chatPublicKey = normalizeText(derived.chatPublicKey);
    }
    if (!globalMetaId || !privateKeyHex || !chatPublicKey) {
        return null;
    }
    if (profileGlobalMetaId && profileGlobalMetaId !== globalMetaId) {
        return null;
    }
    return {
        paths,
        identity: {
            globalMetaId,
            privateKeyHex,
            chatPublicKey,
        },
    };
}
function normalizeSimplemsgSocketMessage(data) {
    return (0, privateChatListener_1.normalizePrivateChatSocketMessage)(data);
}
function createProfileSimplemsgListener(input) {
    let sockets = [];
    const seenPinIds = new Set();
    let activeEndpointIndex = 0;
    const handleSocketPayload = async (payload) => {
        const message = normalizeSimplemsgSocketMessage(payload);
        if (!message)
            return;
        const fromGlobalMetaId = normalizeText(message.fromGlobalMetaId);
        if (!fromGlobalMetaId)
            return;
        const localGlobalMetaId = normalizeText(input.identity.globalMetaId);
        const toGlobalMetaId = normalizeText(message.toGlobalMetaId);
        if (toGlobalMetaId && toGlobalMetaId !== localGlobalMetaId) {
            return;
        }
        if (fromGlobalMetaId === localGlobalMetaId) {
            return;
        }
        const messagePinId = (0, privateChatListener_1.pinIdFromPrivateChatSocketMessage)(message);
        if (!deduplicateByPinId(seenPinIds, messagePinId))
            return;
        let peerChatPublicKey = normalizeText(message.fromUserInfo?.chatPublicKey) || null;
        if (!peerChatPublicKey && input.resolvePeerChatPublicKey) {
            try {
                peerChatPublicKey = await input.resolvePeerChatPublicKey(fromGlobalMetaId);
            }
            catch {
                // Peer key lookup is best-effort; decryption will skip if it is unavailable.
            }
        }
        const plaintext = (0, privateChatListener_1.decryptPrivateChatSocketMessage)(message, input.identity, peerChatPublicKey);
        if (!plaintext)
            return;
        const inboundMessage = {
            fromGlobalMetaId,
            content: plaintext,
            messagePinId,
            fromChatPublicKey: peerChatPublicKey,
            timestamp: toFiniteTimestamp(message.timestamp),
            rawMessage: normalizeObject(message),
        };
        await (0, conversationPersistence_1.persistA2AConversationMessageBestEffort)({
            paths: input.paths,
            local: {
                profileSlug: input.profile.slug,
                globalMetaId: localGlobalMetaId,
                name: input.profile.name,
                chatPublicKey: input.identity.chatPublicKey,
            },
            peer: {
                globalMetaId: fromGlobalMetaId,
                name: normalizeText(message.fromUserInfo?.name) || null,
                avatar: normalizeText(message.fromUserInfo?.avatar) || null,
                chatPublicKey: peerChatPublicKey,
            },
            message: {
                messageId: messagePinId,
                direction: 'incoming',
                content: plaintext,
                pinId: messagePinId,
                txid: normalizeText(message.txId) || null,
                replyPinId: normalizeText(message.replyPin) || null,
                chain: 'mvc',
                timestamp: inboundMessage.timestamp,
                raw: inboundMessage.rawMessage,
            },
        }, input.persister);
        await input.onMessage?.(input.profile, inboundMessage);
    };
    const registerSocket = (socket, endpointIndex) => {
        socket.on('message', async (data) => {
            await handleSocketPayload(data).catch((error) => {
                input.onError?.(error instanceof Error ? error : new Error(String(error)));
            });
        });
        socket.on('WS_SERVER_NOTIFY_PRIVATE_CHAT', async (data) => {
            await handleSocketPayload(['WS_SERVER_NOTIFY_PRIVATE_CHAT', data]).catch((error) => {
                input.onError?.(error instanceof Error ? error : new Error(String(error)));
            });
        });
        socket.on('WS_RESPONSE_SUCCESS', async (data) => {
            await handleSocketPayload(['WS_RESPONSE_SUCCESS', data]).catch((error) => {
                input.onError?.(error instanceof Error ? error : new Error(String(error)));
            });
        });
        socket.on('connect_error', (error) => {
            input.onError?.(error);
            if (endpointIndex !== activeEndpointIndex || endpointIndex >= input.endpoints.length - 1) {
                return;
            }
            activeEndpointIndex += 1;
            try {
                socket.removeAllListeners();
                socket.disconnect();
            }
            catch {
                // Best effort fallback shutdown.
            }
            connectEndpoint(activeEndpointIndex);
        });
    };
    const connectEndpoint = (endpointIndex) => {
        const endpoint = input.endpoints[endpointIndex];
        if (!endpoint)
            return;
        const socket = input.socketClientFactory(endpoint, {
            path: endpoint.path,
            query: {
                metaid: input.identity.globalMetaId,
                type: 'pc',
            },
            reconnection: true,
            reconnectionDelay: input.reconnectDelayMs,
            reconnectionDelayMax: input.maxReconnectDelayMs,
            transports: ['websocket'],
        });
        registerSocket(socket, endpointIndex);
        sockets.push(socket);
    };
    return {
        start() {
            if (sockets.length > 0)
                return;
            activeEndpointIndex = 0;
            connectEndpoint(activeEndpointIndex);
        },
        stop() {
            for (const socket of sockets) {
                try {
                    socket.removeAllListeners();
                    socket.disconnect();
                }
                catch {
                    // Best effort shutdown.
                }
            }
            sockets = [];
            seenPinIds.clear();
        },
    };
}
function createA2ASimplemsgListenerManager(input) {
    const endpoints = input.socketEndpoints ?? DEFAULT_SOCKET_ENDPOINTS;
    const socketClientFactory = input.socketClientFactory ?? defaultSocketClientFactory;
    const persister = input.persister ?? conversationPersistence_1.persistA2AConversationMessage;
    const listProfiles = input.listProfiles ?? identityProfiles_1.listIdentityProfiles;
    const loadIdentity = input.loadProfileIdentity ?? loadProfileIdentity;
    const reconnectDelayMs = input.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
    const maxReconnectDelayMs = input.maxReconnectDelayMs ?? MAX_RECONNECT_DELAY_MS;
    let listeners = [];
    let running = false;
    let lastReport = { started: [], skipped: [] };
    return {
        async start() {
            if (running) {
                return lastReport;
            }
            const profiles = await listProfiles(input.systemHomeDir);
            const started = [];
            const skipped = [];
            const nextListeners = [];
            for (const profile of profiles) {
                const globalMetaId = normalizeText(profile.globalMetaId) || null;
                let loaded = null;
                try {
                    loaded = await loadIdentity(profile);
                }
                catch (error) {
                    skipped.push({
                        slug: profile.slug,
                        name: profile.name,
                        homeDir: profile.homeDir,
                        globalMetaId,
                        reason: error instanceof Error ? error.message : String(error),
                    });
                    continue;
                }
                if (!loaded) {
                    skipped.push({
                        slug: profile.slug,
                        name: profile.name,
                        homeDir: profile.homeDir,
                        globalMetaId,
                        reason: 'identity_secret_missing',
                    });
                    continue;
                }
                const listener = createProfileSimplemsgListener({
                    profile,
                    paths: loaded.paths,
                    identity: loaded.identity,
                    endpoints,
                    socketClientFactory,
                    resolvePeerChatPublicKey: input.resolvePeerChatPublicKey,
                    persister,
                    reconnectDelayMs,
                    maxReconnectDelayMs,
                    onMessage: input.onMessage,
                    onError: input.onError,
                });
                listener.start();
                nextListeners.push(listener);
                started.push({
                    slug: profile.slug,
                    name: profile.name,
                    homeDir: profile.homeDir,
                    globalMetaId: loaded.identity.globalMetaId,
                });
            }
            listeners = nextListeners;
            running = true;
            lastReport = { started, skipped };
            return lastReport;
        },
        stop() {
            for (const listener of listeners) {
                listener.stop();
            }
            listeners = [];
            running = false;
            lastReport = { started: [], skipped: [] };
        },
        isRunning() {
            return running;
        },
    };
}
