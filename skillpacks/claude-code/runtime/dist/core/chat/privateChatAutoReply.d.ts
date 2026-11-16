import type { ChatSkillWaitNoticeGenerator } from './chatSkillWaitNotice';
import type { ChatEpisodeSummaryGenerator } from './chatEpisodeSummary';
import { type PrivateChatWakeStore } from './privateChatWake';
import { type A2AConversationMessagePersister } from '../a2a/conversationPersistence';
import { type PrivateChatSendFailureEvent } from './privateChatSendFailureLog';
import type { PrivateChatPendingGuidanceClaim, PrivateChatStateStore } from './privateChatStateStore';
import type { ChatStrategyStore } from './chatStrategyStore';
import type { MetabotPaths } from '../state/paths';
import type { Signer } from '../signing/signer';
import type { PeerPolicyEvaluation } from '../trust/trustPolicy';
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
    /**
     * Trust-tier policy evaluation for peer-initiated turns (trust tiers P4a):
     * resolves the sender's tier + accept behavior + class-filtered skill set
     * BEFORE the auto-reply turn. Absent = policy engine not wired — legacy
     * behavior (auto-reply with the full allowChatSkills scope). The
     * orchestrator fails safe on a throwing evaluator: stranger tier, auto
     * reply, NO skills, and a `trust_policy_failed` send-failure event.
     */
    evaluatePeerTrustPolicy?: (peerGlobalMetaId: string) => Promise<PeerPolicyEvaluation>;
    /**
     * Local session adapters (P2b/P3): route inbound mail for a private-chat
     * conversation that is BOUND to a local agent session (Claude Code, Codex,
     * …). Consulted AFTER the trust gate, only for `auto` behavior. A non-null
     * result means the mail was enqueued into the session's inbox — no bot
     * runtime turn runs for it (no silent fallback: bound conversations wait
     * for their session). `canWake` carries the wake-policy decision (sender
     * tier may push into a live push-capable session); false = queue-only.
     * Absent or null = behavior unchanged.
     */
    routeInboundToLocalSession?: (input: {
        conversationId: string;
        peerGlobalMetaId: string;
        body: string;
        fromName?: string | null;
        canWake: boolean;
    }) => Promise<{
        delivered: true;
        sessionKey: string;
        sessionName: string;
        mailId: string;
        pushed?: boolean;
    } | null>;
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
     *
     * Trust tiers P4a: relayed profiles delegate judgment to the bound
     * assistant (its own model decides how to answer), so the local trust-tier
     * policy gate does NOT apply on this path — the policy gates the local
     * auto-reply path (handleInboundMessage) only.
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
