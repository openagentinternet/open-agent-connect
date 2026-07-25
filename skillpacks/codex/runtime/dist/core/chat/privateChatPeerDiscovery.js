"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listLocalA2AProjectedPeerGlobalMetaIds = listLocalA2AProjectedPeerGlobalMetaIds;
exports.buildLocalA2AProjectedPeerIndex = buildLocalA2AProjectedPeerIndex;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const conversationStore_1 = require("../a2a/conversationStore");
const paths_1 = require("../state/paths");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
async function listLocalA2AProjectedPeerGlobalMetaIds(input) {
    const selfGlobalMetaId = normalizeText(input.selfGlobalMetaId);
    const normalizedSelf = selfGlobalMetaId.toLowerCase();
    if (!selfGlobalMetaId)
        return [];
    const peers = await Promise.all(input.profiles.map(async (profile) => {
        const candidateGlobalMetaId = normalizeText(profile.globalMetaId);
        if (!candidateGlobalMetaId || candidateGlobalMetaId.toLowerCase() === normalizedSelf) {
            return null;
        }
        const paths = (0, paths_1.resolveMetabotPaths)(profile.homeDir);
        const conversationPath = (0, conversationStore_1.resolveA2AConversationFilePath)(paths, candidateGlobalMetaId, selfGlobalMetaId);
        try {
            const conversation = JSON.parse(await node_fs_1.promises.readFile(conversationPath, 'utf8'));
            const storedLocal = normalizeText(conversation.local?.globalMetaId).toLowerCase();
            const storedPeer = normalizeText(conversation.peer?.globalMetaId).toLowerCase();
            const hasOutboundMessage = Array.isArray(conversation.messages)
                && conversation.messages.some((message) => message?.direction === 'outgoing');
            return storedLocal === candidateGlobalMetaId.toLowerCase()
                && storedPeer === normalizedSelf
                && hasOutboundMessage
                ? candidateGlobalMetaId
                : null;
        }
        catch {
            return null;
        }
    }));
    return peers.filter((peer) => Boolean(peer));
}
async function buildLocalA2AProjectedPeerIndex(profiles) {
    const entries = await Promise.all(profiles.map(async (profile) => {
        const candidateGlobalMetaId = normalizeText(profile.globalMetaId);
        if (!candidateGlobalMetaId)
            return [];
        const paths = (0, paths_1.resolveMetabotPaths)(profile.homeDir);
        let fileNames;
        try {
            fileNames = await node_fs_1.promises.readdir(paths.a2aRoot);
        }
        catch {
            return [];
        }
        const projectedPeers = await Promise.all(fileNames
            .filter((fileName) => fileName.startsWith('chat-') && fileName.endsWith('.json'))
            .map(async (fileName) => {
            try {
                const conversation = JSON.parse(await node_fs_1.promises.readFile(node_path_1.default.join(paths.a2aRoot, fileName), 'utf8'));
                const storedLocal = normalizeText(conversation.local?.globalMetaId);
                const storedPeer = normalizeText(conversation.peer?.globalMetaId);
                const hasOutboundMessage = Array.isArray(conversation.messages)
                    && conversation.messages.some((message) => message?.direction === 'outgoing');
                return storedLocal.toLowerCase() === candidateGlobalMetaId.toLowerCase()
                    && storedPeer
                    && hasOutboundMessage
                    ? { recipient: storedPeer.toLowerCase(), sender: candidateGlobalMetaId }
                    : null;
            }
            catch {
                return null;
            }
        }));
        return projectedPeers.filter((entry) => Boolean(entry));
    }));
    const index = new Map();
    for (const entry of entries.flat()) {
        const senders = index.get(entry.recipient) ?? new Set();
        senders.add(entry.sender);
        index.set(entry.recipient, senders);
    }
    return new Map(Array.from(index.entries(), ([recipient, senders]) => ([recipient, Array.from(senders)])));
}
