/**
 * A2A conversation UI-meta writer (IDBots `cowork_sessions` pin/rename/
 * archive parity). Pin/archive/rename are list-presentation flags: the stored
 * messages, sessions, and indexes are never touched, and archiving only
 * stamps `archivedAt` so the live list hides the row while every record stays
 * intact for the (future) archived-chats surface.
 */
import { createA2AConversationStore } from './conversationStore';
import { findPeerConversationState, peerConversationId } from './conversationProjection';
import type { A2AConversationMeta } from './conversationTypes';

export interface UpdatePeerConversationMetaInput {
  homeDir: string;
  localGlobalMetaId: string;
  peerGlobalMetaId: string;
  /** Set the pinned flag; omit to leave unchanged. */
  pinned?: boolean;
  /** true stamps `archivedAt` (now); false clears it back to null. */
  archived?: boolean;
  /**
   * Rename override. An empty/whitespace string CLEARS the override so the
   * row falls back to the peer profile name (group-task rename semantics).
   */
  displayName?: string | null;
}

export interface UpdatePeerConversationMetaResult extends A2AConversationMeta {
  conversationId: string;
}

/**
 * Apply one meta patch to the stored local↔peer conversation. Returns null
 * when no conversation exists for the pair (pin/archive/rename only address
 * existing rows — unlike message persistence, meta writes never create one).
 */
export async function updatePeerConversationMeta(
  input: UpdatePeerConversationMetaInput,
): Promise<UpdatePeerConversationMetaResult | null> {
  const conversation = await findPeerConversationState({
    homeDir: input.homeDir,
    localGlobalMetaId: input.localGlobalMetaId,
    peerGlobalMetaId: input.peerGlobalMetaId,
  });
  if (!conversation) {
    return null;
  }
  const store = createA2AConversationStore({
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
    conversationId: peerConversationId(next),
    ...meta,
  };
}
