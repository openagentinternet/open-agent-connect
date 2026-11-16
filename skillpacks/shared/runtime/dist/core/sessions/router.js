"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLocalSessionRouter = createLocalSessionRouter;
const node_fs_1 = require("node:fs");
const claudeCode_1 = require("./adapters/claudeCode");
const codex_1 = require("./adapters/codex");
const framing_1 = require("./framing");
function createLocalSessionRouter(input) {
    const { registry, mailQueue } = input;
    const pushClaude = input.pushToClaudeInbox ?? claudeCode_1.pushToClaudeInbox;
    const pushCodex = input.pushToCodexQueue ?? codex_1.pushToCodexQueue;
    const socketExists = input.socketExists ?? (async (socketPath) => {
        try {
            await node_fs_1.promises.access(socketPath);
            return true;
        }
        catch {
            return false;
        }
    });
    const now = input.now ?? Date.now;
    async function tryPush(record, routeInput, mailId) {
        if (routeInput.canWake !== true || !record.deliverable || record.tier !== 'push') {
            return false;
        }
        const framedText = (0, framing_1.buildPeerMessageFrame)({
            from: routeInput.peerGlobalMetaId,
            fromName: routeInput.fromName,
            mailId,
            body: routeInput.body,
        });
        try {
            if (record.agent === 'claude-code') {
                if (!record.inboxSocketPath || !(await socketExists(record.inboxSocketPath))) {
                    return false;
                }
                await pushClaude({ socketPath: record.inboxSocketPath, framedText });
                return true;
            }
            if (record.agent === 'codex' && record.sessionId) {
                await pushCodex({ threadId: record.sessionId, framedText });
                return true;
            }
            return false;
        }
        catch {
            // Push failure degrades to the queue — never loses mail, never throws.
            return false;
        }
    }
    return {
        async routeInbound(routeInput) {
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
            const pushed = await tryPush(record, routeInput, entry.id);
            if (pushed) {
                await mailQueue.markDelivered(entry.id);
            }
            return {
                delivered: true,
                sessionKey: record.sessionKey,
                sessionName: record.name,
                mailId: entry.id,
                pushed,
            };
        },
    };
}
