/**
 * Inbound routing to local sessions (local session adapters P2b/P3).
 *
 * The decision layer between the private-chat ingress and the mail queue:
 * a conversation BOUND to a local session takes the mail (it is enqueued
 * and handed over whenever the session next checks its inbox — the queue is
 * also the offline waiting room); an unbound conversation returns null and
 * the bot runtime answers as before. The trust-tier gate has already run
 * upstream — this router never sees refused mail.
 *
 * P3 push tier: for a deliverable session whose platform is push-capable
 * (Claude Code inbox socket, Codex queue) and whose wake policy allows the
 * sender, the router attempts a direct push after enqueueing; success marks
 * the mail delivered (the queue entry becomes the receipt), failure leaves
 * it queued. Push is opt-in twice over: the session must be deliverable
 * (registered via MCP/hooks/claim) AND the sender must pass the wake tier —
 * presence-only discovery entries never receive anything.
 *
 * Each routed mail enriches the binding with the observed peer and owning
 * profile, which anchors the session's replies (send path) without any
 * conversation-id parsing.
 */
import { pushToClaudeInbox } from './adapters/claudeCode';
import { pushToCodexQueue } from './adapters/codex';
import type { SessionMailQueue } from './mailQueue';
import type { LocalSessionRegistry } from './registry';
export interface RouteInboundInput {
    conversationId: string;
    peerGlobalMetaId: string;
    body: string;
    fromName?: string;
    /** The Bot profile whose orchestrator is routing (recorded on the binding). */
    profileSlug?: string;
    /**
     * Whether the sender may WAKE a push-capable session (wake policy, resolved
     * upstream from the trust tier). False = queue-only delivery (the session
     * sees the mail at its next check_inbox / natural pause).
     */
    canWake?: boolean;
}
export interface RouteInboundResult {
    delivered: true;
    sessionKey: string;
    sessionName: string;
    mailId: string;
    /** True when the mail was pushed straight into the live session. */
    pushed: boolean;
}
export interface LocalSessionRouterInput {
    registry: LocalSessionRegistry;
    mailQueue: SessionMailQueue;
    /** Injectable push adapters (tests); defaults are the real ones. */
    pushToClaudeInbox?: typeof pushToClaudeInbox;
    pushToCodexQueue?: typeof pushToCodexQueue;
    /** Injectable socket-exists probe (tests); default fs access. */
    socketExists?: (socketPath: string) => Promise<boolean>;
    now?: () => number;
}
export interface LocalSessionRouter {
    routeInbound(input: RouteInboundInput): Promise<RouteInboundResult | null>;
}
export declare function createLocalSessionRouter(input: LocalSessionRouterInput): LocalSessionRouter;
