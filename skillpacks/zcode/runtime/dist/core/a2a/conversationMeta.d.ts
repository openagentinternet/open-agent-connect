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
export declare function updatePeerConversationMeta(input: UpdatePeerConversationMetaInput): Promise<UpdatePeerConversationMetaResult | null>;
