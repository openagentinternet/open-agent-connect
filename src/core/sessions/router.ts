/**
 * Inbound routing to local sessions (local session adapters P2b).
 *
 * The decision layer between the private-chat ingress and the mail queue:
 * a conversation BOUND to a local session takes the mail (it is enqueued
 * and handed over whenever the session next checks its inbox — the queue is
 * also the offline waiting room); an unbound conversation returns null and
 * the bot runtime answers as before. The trust-tier gate has already run
 * upstream — this router never sees refused mail.
 *
 * Each routed mail enriches the binding with the observed peer and owning
 * profile, which anchors the session's replies (send path) without any
 * conversation-id parsing.
 */

import type { SessionMailQueue } from './mailQueue';
import type { LocalSessionRegistry } from './registry';

export interface RouteInboundInput {
  conversationId: string;
  peerGlobalMetaId: string;
  body: string;
  fromName?: string;
  /** The Bot profile whose orchestrator is routing (recorded on the binding). */
  profileSlug?: string;
}

export interface RouteInboundResult {
  delivered: true;
  sessionKey: string;
  sessionName: string;
  mailId: string;
}

export interface LocalSessionRouter {
  routeInbound(input: RouteInboundInput): Promise<RouteInboundResult | null>;
}

export interface LocalSessionRouterInput {
  registry: LocalSessionRegistry;
  mailQueue: SessionMailQueue;
}

export function createLocalSessionRouter(input: LocalSessionRouterInput): LocalSessionRouter {
  const { registry, mailQueue } = input;
  return {
    async routeInbound(routeInput): Promise<RouteInboundResult | null> {
      const record = await registry.findByConversation(routeInput.conversationId);
      if (!record) {
        return null;
      }
      const binding = (record.boundConversations ?? [])
        .find((entry) => entry.conversationId === routeInput.conversationId);
      if (binding) {
        // Enrich: the send path anchors to the observed peer + profile.
        binding.peerGlobalMetaId = routeInput.peerGlobalMetaId;
        if (routeInput.profileSlug) {
          binding.profileSlug = routeInput.profileSlug;
        }
        // Persist the enrichment through a rebind (idempotent upsert).
        await registry.bindConversation({
          sessionRef: record.sessionKey,
          conversationId: routeInput.conversationId,
          profileSlug: routeInput.profileSlug,
          peerGlobalMetaId: routeInput.peerGlobalMetaId,
        });
      }
      const entry = await mailQueue.enqueue({
        sessionKey: record.sessionKey,
        from: routeInput.peerGlobalMetaId,
        fromName: routeInput.fromName,
        body: routeInput.body,
      });
      return {
        delivered: true,
        sessionKey: record.sessionKey,
        sessionName: record.name,
        mailId: entry.id,
      };
    },
  };
}
