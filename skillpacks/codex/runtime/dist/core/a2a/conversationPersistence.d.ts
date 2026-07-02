import { type MetabotPaths } from '../state/paths';
import type { A2AConversationLocalProfile, A2AConversationMessage, A2AConversationPeerProfile, A2AOrderConversationSession } from './conversationTypes';
export interface PersistA2AConversationMessageInput {
    homeDir?: string;
    paths?: MetabotPaths;
    local: A2AConversationLocalProfile;
    peer: A2AConversationPeerProfile;
    message: {
        messageId?: string | null;
        direction: 'incoming' | 'outgoing';
        content: string;
        contentType?: string | null;
        artifacts?: unknown;
        chain?: string | null;
        pinId?: string | null;
        txid?: string | null;
        txids?: string[] | null;
        replyPinId?: string | null;
        timestamp?: number | null;
        chainTimestamp?: number | null;
        orderTxid?: string | null;
        serviceOrderPinId?: string | null;
        orderPinId?: string | null;
        paymentTxid?: string | null;
        raw?: Record<string, unknown> | null;
    };
    orderSession?: Partial<A2AOrderConversationSession> | null;
}
export type A2AConversationMessagePersister = (input: PersistA2AConversationMessageInput) => Promise<A2AConversationMessage>;
export interface A2AConversationPersistenceEvent {
    type: 'conversation-message';
    localGlobalMetaId: string;
    peerGlobalMetaId: string;
    messageId: string;
    timestamp: number;
    kind: string;
    protocolTag: string | null;
}
export interface PersistA2AConversationMessageBestEffortResult {
    persisted: boolean;
    message: A2AConversationMessage | null;
    errorMessage: string | null;
}
export declare function publishA2AConversationPersistenceEvent(event: A2AConversationPersistenceEvent): void;
export declare function subscribeA2AConversationPersistenceEvents(localGlobalMetaId: string, subscriber: (event: A2AConversationPersistenceEvent) => void): () => void;
export declare function sanitizeA2ARawMetadata(raw: Record<string, unknown> | null | undefined): Record<string, unknown> | null;
export declare function buildA2APeerSessionId(localGlobalMetaId: string, peerGlobalMetaId: string): string;
export declare function buildA2AOrderSessionId(orderTxid: string): string;
export declare function persistA2AConversationMessage(input: PersistA2AConversationMessageInput): Promise<A2AConversationMessage>;
export declare function persistA2AConversationMessageBestEffort(input: PersistA2AConversationMessageInput, persister?: A2AConversationMessagePersister): Promise<PersistA2AConversationMessageBestEffortResult>;
