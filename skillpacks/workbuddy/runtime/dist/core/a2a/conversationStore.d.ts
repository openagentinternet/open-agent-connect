import { type MetabotPaths } from '../state/paths';
import type { A2AConversationLocalProfile, A2AConversationMessage, A2AConversationPeerProfile, A2AConversationSession, A2AConversationState } from './conversationTypes';
export interface CreateA2AConversationStoreInput {
    homeDir?: string;
    paths?: MetabotPaths;
    local: A2AConversationLocalProfile;
    peer: A2AConversationPeerProfile;
}
export interface A2AConversationStore {
    paths: MetabotPaths;
    conversationPath: string;
    lockPath: string;
    readConversation(): Promise<A2AConversationState>;
    writeConversation(nextState: A2AConversationState): Promise<A2AConversationState>;
    updateConversation(updater: (state: A2AConversationState) => A2AConversationState | Promise<A2AConversationState>): Promise<A2AConversationState>;
    appendMessages(messages: A2AConversationMessage[]): Promise<A2AConversationMessage[]>;
    upsertSession(session: A2AConversationSession): Promise<A2AConversationSession>;
    findSessionById(sessionId: string): Promise<A2AConversationSession | null>;
    findSessionByOrderTxid(orderTxid: string): Promise<A2AConversationSession | null>;
    findSessionByPaymentTxid(paymentTxid: string): Promise<A2AConversationSession | null>;
}
export declare function resolveA2AConversationFilePath(paths: MetabotPaths, localGlobalMetaId: string, peerGlobalMetaId: string): string;
export declare function createA2AConversationStore(input: CreateA2AConversationStoreInput): A2AConversationStore;
