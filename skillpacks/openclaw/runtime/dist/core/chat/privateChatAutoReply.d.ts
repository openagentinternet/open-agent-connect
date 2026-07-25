import { type A2AConversationMessagePersister } from '../a2a/conversationPersistence';
import { type PrivateChatSendFailureEvent } from './privateChatSendFailureLog';
import type { PrivateChatPendingGuidanceClaim, PrivateChatStateStore } from './privateChatStateStore';
import type { ChatStrategyStore } from './chatStrategyStore';
import type { MetabotPaths } from '../state/paths';
import type { Signer } from '../signing/signer';
import type { PrivateChatInboundMessage, PrivateChatMessage, ChatReplyRunner, PrivateChatAutoReplyConfig } from './privateChatTypes';
export interface PrivateChatAutoReplyDependencies {
    stateStore: PrivateChatStateStore;
    strategyStore: ChatStrategyStore;
    paths: MetabotPaths;
    signer: Signer;
    selfGlobalMetaId: () => Promise<string | null>;
    resolvePeerChatPublicKey: (globalMetaId: string) => Promise<string | null>;
    replyRunner: ChatReplyRunner;
    a2aConversationPersister?: A2AConversationMessagePersister;
    logSendFailure?: (event: PrivateChatSendFailureEvent) => void;
    now?: () => number;
}
export interface PrivateChatAutoReplyOrchestrator {
    handleInboundMessage(message: PrivateChatInboundMessage): Promise<void>;
    retryPendingInboundMessage(peerGlobalMetaId: string): Promise<boolean>;
    retryOutboundMessage(peerGlobalMetaId: string, message: PrivateChatMessage): Promise<boolean>;
    handleLocalGuidedTurn(peerGlobalMetaId: string, options?: {
        guidanceToConsume?: PrivateChatPendingGuidanceClaim | null;
    }): Promise<void>;
}
export declare function createPrivateChatAutoReplyOrchestrator(deps: PrivateChatAutoReplyDependencies, config: PrivateChatAutoReplyConfig): PrivateChatAutoReplyOrchestrator;
