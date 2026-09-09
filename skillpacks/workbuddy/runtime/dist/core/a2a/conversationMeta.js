"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePeerConversationMeta = updatePeerConversationMeta;
/**
 * A2A conversation UI-meta writer (IDBots `cowork_sessions` pin/rename/
 * archive parity). Pin/archive/rename are list-presentation flags: the stored
 * messages, sessions, and indexes are never touched, and archiving only
 * stamps `archivedAt` so the live list hides the row while every record stays
 * intact for the (future) archived-chats surface.
 */
const conversationStore_1 = require("./conversationStore");
const conversationProjection_1 = require("./conversationProjection");
/**
 * Apply one meta patch to the stored local↔peer conversation. Returns null
 * when no conversation exists for the pair (pin/archive/rename only address
 * existing rows — unlike message persistence, meta writes never create one).
 */
async function updatePeerConversationMeta(input) {
    const conversation = await (0, conversationProjection_1.findPeerConversationState)({
        homeDir: input.homeDir,
        localGlobalMetaId: input.localGlobalMetaId,
        peerGlobalMetaId: input.peerGlobalMetaId,
    });
    if (!conversation) {
        return null;
    }
    const store = (0, conversationStore_1.createA2AConversationStore)({
        homeDir: input.homeDir,
        local: conversation.local,
        peer: conversation.peer,
    });
    const next = await store.updateConversation((state) => ({
        ...state,
        meta: {
            pinned: input.pinned ?? state.meta?.pinned ?? false,
            archivedAt: input.archived === undefined
                ? state.meta?.archivedAt ?? null
                : (input.archived ? Date.now() : null),
            displayName: input.displayName === undefined
                ? state.meta?.displayName ?? null
                : (input.displayName?.trim() || null),
        },
    }));
    const meta = next.meta ?? { pinned: false, archivedAt: null, displayName: null };
    return {
        conversationId: (0, conversationProjection_1.peerConversationId)(next),
        ...meta,
    };
}
