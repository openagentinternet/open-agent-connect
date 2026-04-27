import type { MetabotPaths } from '../state/paths';
import type { PrivateChatState, PrivateChatConversation, PrivateChatMessage } from './privateChatTypes';
export interface PrivateChatStateStore {
    paths: MetabotPaths;
    privateChatStatePath: string;
    readState(): Promise<PrivateChatState>;
    updateState(updater: (state: PrivateChatState) => PrivateChatState | Promise<PrivateChatState>): Promise<PrivateChatState>;
    upsertConversation(conv: PrivateChatConversation): Promise<PrivateChatConversation>;
    appendMessages(messages: PrivateChatMessage[]): Promise<PrivateChatMessage[]>;
    getConversationByPeer(peerGlobalMetaId: string): Promise<PrivateChatConversation | null>;
    getRecentMessages(conversationId: string, limit?: number): Promise<PrivateChatMessage[]>;
}
export declare function createPrivateChatStateStore(homeDirOrPaths: string | MetabotPaths): PrivateChatStateStore;
