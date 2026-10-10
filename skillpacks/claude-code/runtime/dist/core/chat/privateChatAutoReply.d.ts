import type { ChatSkillWaitNoticeGenerator } from './chatSkillWaitNotice';
import type { ChatEpisodeSummaryGenerator } from './chatEpisodeSummary';
import { type PrivateChatWakeStore } from './privateChatWake';
import { type A2AConversationMessagePersister } from '../a2a/conversationPersistence';
import { type PrivateChatSendFailureEvent } from './privateChatSendFailureLog';
import type { PrivateChatPendingGuidanceClaim, PrivateChatStateStore } from './privateChatStateStore';
import type { ChatStrategyStore } from './chatStrategyStore';
import type { MetabotPaths } from '../state/paths';
import type { Signer } from '../signing/signer';
import type { PrivateChatInboundMessage, PrivateChatMessage, ChatReplyRunner, PrivateChatAutoReplyConfig } from './privateChatTypes';
export declare const DEFAULT_MAX_TURNS = 50;
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
    hasActiveOrderWithPeer?: (peerGlobalMetaId: string) => Promise<boolean>;
    chatSkillWaitNotice?: ChatSkillWaitNoticeGenerator | null;
    wakeStore?: PrivateChatWakeStore;
    episodeSummaryGenerator?: ChatEpisodeSummaryGenerator | null;
    now?: () => number;
}
export interface PrivateChatAutoReplyOrchestrator {
    handleInboundMessage(message: PrivateChatInboundMessage): Promise<void>;
    /**
     * Records an inbound message whose reply was handed to an external relay
     * (e.g. the Grok Bot routine webhook): the message joins the store (so
     * backfill dedupe covers it) and a local-only relay marker flips the
     * conversation tail to handled, so neither the sweep nor the
     * unanswered-tail recovery re-drives it. Returns false when the message was
     * already recorded (duplicate delivery).
     */
    recordExternallyRelayedInbound(message: PrivateChatInboundMessage, relay: string): Promise<boolean>;
    retryPendingInboundMessage(peerGlobalMetaId: string): Promise<boolean>;
    retryOutboundMessage(peerGlobalMetaId: string, message: PrivateChatMessage): Promise<boolean>;
    handleLocalGuidedTurn(peerGlobalMetaId: string, options?: {
        guidanceToConsume?: PrivateChatPendingGuidanceClaim | null;
    }): Promise<void>;
    fireDueWakes(): Promise<number>;
    startWakeLoop(): void;
    stopWakeLoop(): void;
}
export declare function unwrapPrivateChatContent(raw: string): {
    content: string;
    extensions: Record<string, unknown> | null;
};
export declare function createPrivateChatAutoReplyOrchestrator(deps: PrivateChatAutoReplyDependencies, config: PrivateChatAutoReplyConfig): PrivateChatAutoReplyOrchestrator;
