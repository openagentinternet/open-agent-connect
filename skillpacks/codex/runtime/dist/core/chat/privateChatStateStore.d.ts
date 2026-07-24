import type { MetabotPaths } from '../state/paths';
import type { PrivateChatState, PrivateChatConversation, PrivateChatMessage } from './privateChatTypes';
export interface PrivateChatPendingGuidanceClaim {
    guidanceText: string;
    createdAt: number;
    leaseId: string;
    leaseExpiresAt: number;
}
export interface PrivateChatStateStore {
    paths: MetabotPaths;
    privateChatStatePath: string;
    readState(): Promise<PrivateChatState>;
    updateState(updater: (state: PrivateChatState) => PrivateChatState | Promise<PrivateChatState>): Promise<PrivateChatState>;
    upsertConversation(conv: PrivateChatConversation): Promise<PrivateChatConversation>;
    setPendingGuidance(conversationId: string, guidanceText: string, createdAt: number): Promise<PrivateChatConversation | null>;
    setPendingGuidanceAndClaim(conversationId: string, guidanceText: string, createdAt: number, options?: {
        now?: number;
        leaseMs?: number;
    }): Promise<{
        conversation: PrivateChatConversation;
        claim: PrivateChatPendingGuidanceClaim;
    } | null>;
    claimPendingGuidance(conversationId: string, options?: {
        now?: number;
        leaseMs?: number;
    }): Promise<PrivateChatPendingGuidanceClaim | null>;
    releasePendingGuidanceClaimIfMatches(conversationId: string, claim: PrivateChatPendingGuidanceClaim): Promise<PrivateChatConversation | null>;
    clearPendingGuidanceIfMatches(conversationId: string, guidanceText: string, createdAt: number, leaseId?: string | null): Promise<PrivateChatConversation | null>;
    appendMessages(messages: PrivateChatMessage[]): Promise<PrivateChatMessage[]>;
    replaceMessage(messageId: string, replacement: PrivateChatMessage): Promise<PrivateChatMessage | null>;
    getConversationByPeer(peerGlobalMetaId: string): Promise<PrivateChatConversation | null>;
    getRecentMessages(conversationId: string, limit?: number): Promise<PrivateChatMessage[]>;
}
export declare function createPrivateChatStateStore(homeDirOrPaths: string | MetabotPaths): PrivateChatStateStore;
