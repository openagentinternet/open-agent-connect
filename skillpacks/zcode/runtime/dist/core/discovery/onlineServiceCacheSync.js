"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshOnlineServiceCacheFromChain = refreshOnlineServiceCacheFromChain;
const chainDirectoryReader_1 = require("./chainDirectoryReader");
const onlineServiceCache_1 = require("./onlineServiceCache");
const ratingDetailSync_1 = require("../ratings/ratingDetailSync");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
async function enrichServicesWithProviderChatPublicKeys(input) {
    if (!input.resolvePeerChatPublicKey) {
        return input.services;
    }
    const chatKeyByProvider = new Map();
    const enriched = [];
    for (const service of input.services) {
        const providerGlobalMetaId = normalizeText(service.providerGlobalMetaId ?? service.globalMetaId);
        const existingChatKey = normalizeText(service.providerChatPublicKey ?? service.chatPublicKey);
        if (!providerGlobalMetaId || existingChatKey) {
            enriched.push(existingChatKey ? { ...service, providerChatPublicKey: existingChatKey } : service);
            continue;
        }
        if (!chatKeyByProvider.has(providerGlobalMetaId)) {
            try {
                chatKeyByProvider.set(providerGlobalMetaId, normalizeText(await input.resolvePeerChatPublicKey(providerGlobalMetaId)) || null);
            }
            catch {
                chatKeyByProvider.set(providerGlobalMetaId, null);
            }
        }
        const providerChatPublicKey = chatKeyByProvider.get(providerGlobalMetaId);
        enriched.push(providerChatPublicKey ? { ...service, providerChatPublicKey } : service);
    }
    return enriched;
}
async function refreshOnlineServiceCacheFromChain(input) {
    const current = await input.store.read();
    const directory = await (0, chainDirectoryReader_1.readChainDirectoryWithFallback)({
        chainApiBaseUrl: input.chainApiBaseUrl,
        socketPresenceApiBaseUrl: input.socketPresenceApiBaseUrl,
        socketPresenceFailureMode: input.socketPresenceFailureMode,
        onlineOnly: true,
        fetchSeededDirectoryServices: input.fetchSeededDirectoryServices ?? (async () => []),
    });
    if (directory.fallbackUsed && directory.services.length === 0 && current.services.length > 0) {
        return current;
    }
    let ratingDetails = [];
    if (input.ratingDetailStateStore) {
        const currentRatingState = await input.ratingDetailStateStore.read();
        try {
            const refreshed = await (0, ratingDetailSync_1.refreshRatingDetailCacheFromChain)({
                store: input.ratingDetailStateStore,
                chainApiBaseUrl: input.chainApiBaseUrl,
                now: input.now,
            });
            ratingDetails = refreshed.state.items;
        }
        catch {
            ratingDetails = currentRatingState.items;
        }
    }
    const services = await enrichServicesWithProviderChatPublicKeys({
        services: directory.services,
        resolvePeerChatPublicKey: input.resolvePeerChatPublicKey,
    });
    return input.store.write((0, onlineServiceCache_1.buildOnlineServiceCacheState)({
        services,
        ratingDetails,
        discoverySource: directory.source,
        fallbackUsed: directory.fallbackUsed,
        now: input.now,
    }));
}
