"use strict";
/**
 * Daemon-side sessions handler group: the /api/sessions/* verbs backing the
 * `metabot sessions *` CLI surface and the `metabot mcp` server (local
 * session adapters P1/P2a/P2b). `list` runs the passive discovery scans
 * (Claude Code registry files, Codex session index), merges presence into
 * the machine-wide registry, and returns the directory. The P2a verbs add
 * session registration and the per-session mail queue. P2b adds the
 * conversation binding (bind/unbind), the inbound routing layer shared with
 * the private-chat orchestrators (createSessionLayer), and the session
 * reply path (sendMessage anchors to the binding's observed peer and sends
 * as the bound Bot profile through the normal chat.private pipeline).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSessionLayer = createSessionLayer;
exports.createSessionsDaemonHandlers = createSessionsDaemonHandlers;
const commandResult_1 = require("../core/contracts/commandResult");
const claude_1 = require("../core/sessions/discovery/claude");
const codex_1 = require("../core/sessions/discovery/codex");
const mailQueue_1 = require("../core/sessions/mailQueue");
const registry_1 = require("../core/sessions/registry");
const router_1 = require("../core/sessions/router");
const paths_1 = require("../core/state/paths");
/**
 * The machine-wide session layer (registry + mail queue + router), built
 once per daemon so the sessions handlers and every profile's private-chat
 orchestrator share the same single-writer instances.
 */
function createSessionLayer(systemHomeDir) {
    const sessionPaths = (0, paths_1.resolveMetabotSessionPaths)(systemHomeDir);
    const registry = (0, registry_1.createLocalSessionRegistry)({ statePath: sessionPaths.localSessionsPath });
    const mailQueue = (0, mailQueue_1.createSessionMailQueue)({ statePath: sessionPaths.sessionMailPath });
    const router = (0, router_1.createLocalSessionRouter)({ registry, mailQueue });
    return { registry, mailQueue, router };
}
function createSessionsDaemonHandlers(input) {
    const sessionPaths = (0, paths_1.resolveMetabotSessionPaths)(input.systemHomeDir);
    const layer = input.sessionLayer ?? createSessionLayer(input.systemHomeDir);
    const { registry, mailQueue, router } = layer;
    function normalizeRegister(rawInput) {
        const agent = typeof rawInput.agent === 'string' ? rawInput.agent.trim() : '';
        if (!agent) {
            return null;
        }
        return {
            agent,
            sessionId: typeof rawInput.sessionId === 'string' ? rawInput.sessionId : undefined,
            pid: typeof rawInput.pid === 'number' && Number.isInteger(rawInput.pid) ? rawInput.pid : undefined,
            name: typeof rawInput.name === 'string' ? rawInput.name : undefined,
            cwd: typeof rawInput.cwd === 'string' ? rawInput.cwd : undefined,
            status: rawInput.status === 'busy' || rawInput.status === 'idle' ? rawInput.status : undefined,
            inboxSocketPath: typeof rawInput.inboxSocketPath === 'string' ? rawInput.inboxSocketPath : undefined,
            source: 'mcp',
            deliverable: true,
        };
    }
    return {
        list: async ({ all }) => {
            const [claudeSessions, codexSessions] = await Promise.all([
                (0, claude_1.scanClaudeSessions)({ claudeDir: input.claudeDir, now: input.now }),
                (0, codex_1.scanCodexSessions)({ codexDir: input.codexDir, now: input.now }),
            ]);
            await registry.applyDiscovery([...claudeSessions, ...codexSessions]);
            const sessions = await registry.list({ all: all === true });
            return (0, commandResult_1.commandSuccess)({
                sessions,
                discovered: { 'claude-code': claudeSessions.length, codex: codexSessions.length },
            });
        },
        // MCP/CLI session registration: marks the calling session deliverable
        // (pull tier today). Registry name-keeping applies.
        register: async (rawInput) => {
            const registerInput = normalizeRegister(rawInput);
            if (!registerInput) {
                return (0, commandResult_1.commandFailed)('invalid_session_agent', 'agent is required.');
            }
            try {
                const record = await registry.registerSession(registerInput);
                return (0, commandResult_1.commandSuccess)({ record });
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('session_register_failed', error instanceof Error ? error.message : String(error));
            }
        },
        // The pull-tier read: long-polls the session's inbox and hands over
        // unread mail (marking it delivered). Pending = what remains after the
        // handover (the unread-notice input for tool results).
        inboxCheck: async (rawInput) => {
            const sessionKey = typeof rawInput.sessionKey === 'string' ? rawInput.sessionKey.trim() : '';
            if (!sessionKey) {
                return (0, commandResult_1.commandFailed)('invalid_session_key', 'sessionKey is required.');
            }
            const waitSecs = typeof rawInput.waitSecs === 'number' && Number.isFinite(rawInput.waitSecs)
                ? rawInput.waitSecs
                : 0;
            try {
                const messages = await mailQueue.checkInbox({ sessionKey, waitSecs });
                const pending = await mailQueue.pendingCount(sessionKey);
                return (0, commandResult_1.commandSuccess)({ messages, pending });
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('session_inbox_check_failed', error instanceof Error ? error.message : String(error));
            }
        },
        // Localhost-only handoff into a session's inbox. P2a: exercised by tests
        // and tooling; P2b wires the inbound flow (handleInboundMessage router)
        // through the same core queue.
        inboxEnqueue: async (rawInput) => {
            const sessionKey = typeof rawInput.sessionKey === 'string' ? rawInput.sessionKey.trim() : '';
            const from = typeof rawInput.from === 'string' ? rawInput.from.trim() : '';
            const body = typeof rawInput.body === 'string' ? rawInput.body : '';
            if (!sessionKey || !from || !body.trim()) {
                return (0, commandResult_1.commandFailed)('invalid_session_mail', 'sessionKey, from and a non-empty body are required.');
            }
            try {
                const entry = await mailQueue.enqueue({
                    sessionKey,
                    from,
                    body,
                    fromName: typeof rawInput.fromName === 'string' ? rawInput.fromName : undefined,
                });
                return (0, commandResult_1.commandSuccess)({ entry });
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('session_enqueue_failed', error instanceof Error ? error.message : String(error));
            }
        },
        messageStatus: async (rawInput) => {
            const ids = Array.isArray(rawInput.ids)
                ? rawInput.ids.filter((id) => typeof id === 'string')
                : [];
            const receipts = await mailQueue.status(ids);
            return (0, commandResult_1.commandSuccess)({ receipts });
        },
        // Non-consuming pending count (P5c unread notices): the MCP server
        // appends it to other tool results so a pull-tier session learns mail
        // is waiting WITHOUT handing it over.
        inboxPending: async (rawInput) => {
            const sessionKey = typeof rawInput.sessionKey === 'string' ? rawInput.sessionKey.trim() : '';
            if (!sessionKey) {
                return (0, commandResult_1.commandFailed)('invalid_session_key', 'sessionKey is required.');
            }
            const pending = await mailQueue.pendingCount(sessionKey);
            return (0, commandResult_1.commandSuccess)({ pending });
        },
        // P2b: bind/unbind a private-chat conversation to a local session. Mail
        // for a bound conversation is enqueued to the session instead of
        // driving a bot runtime turn (routed by the orchestrator hook).
        bind: async (rawInput) => {
            const sessionRef = typeof rawInput.sessionRef === 'string' ? rawInput.sessionRef.trim() : '';
            const conversationId = typeof rawInput.conversationId === 'string' ? rawInput.conversationId.trim() : '';
            const profileSlug = typeof rawInput.profileSlug === 'string' ? rawInput.profileSlug.trim() : undefined;
            if (!sessionRef || !conversationId) {
                return (0, commandResult_1.commandFailed)('invalid_session_bind', 'sessionRef (name or key) and conversationId are required.');
            }
            try {
                const record = await registry.bindConversation({ sessionRef, conversationId, profileSlug });
                return (0, commandResult_1.commandSuccess)({ record });
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('session_bind_failed', error instanceof Error ? error.message : String(error));
            }
        },
        unbind: async (rawInput) => {
            const conversationId = typeof rawInput.conversationId === 'string' ? rawInput.conversationId.trim() : '';
            if (!conversationId) {
                return (0, commandResult_1.commandFailed)('invalid_session_bind', 'conversationId is required.');
            }
            const record = await registry.unbindConversation(conversationId);
            if (!record) {
                return (0, commandResult_1.commandFailed)('session_binding_not_found', `No session is bound to ${conversationId}.`);
            }
            return (0, commandResult_1.commandSuccess)({ record });
        },
        // P2b: a bound session's reply. Anchored to the binding's observed peer
        // (no conversation-id parsing) and sent AS the bound Bot profile through
        // the normal chat.private pipeline — the remote side sees the bot, the
        // conversation record notes the session origin in the result.
        sendMessage: async (rawInput) => {
            const sessionKey = typeof rawInput.sessionKey === 'string' ? rawInput.sessionKey.trim() : '';
            const to = typeof rawInput.to === 'string' ? rawInput.to.trim() : '';
            const message = typeof rawInput.message === 'string' ? rawInput.message : '';
            if (!sessionKey || !to || !message.trim()) {
                return (0, commandResult_1.commandFailed)('invalid_session_send', 'sessionKey, to and a non-empty message are required.');
            }
            const record = await registry.findByRef(sessionKey);
            if (!record) {
                return (0, commandResult_1.commandFailed)('session_not_found', `No local session matches "${sessionKey}".`);
            }
            const binding = (record.boundConversations ?? [])
                .find((entry) => entry.peerGlobalMetaId === to);
            if (!binding) {
                return (0, commandResult_1.commandFailed)('session_not_bound_to_peer', `Session "${record.name}" is not bound to ${to}. Reply to a message it sent you first (check_inbox), using its sender as "to".`);
            }
            const send = input.getChatPrivateSend?.() ?? null;
            if (!send) {
                return (0, commandResult_1.commandFailed)('chat_send_unavailable', 'The private-chat send pipeline is not wired in this daemon.');
            }
            const sendResult = await send({
                from: binding.profileSlug,
                to,
                content: message,
            });
            const sent = Boolean(sendResult && typeof sendResult === 'object' && sendResult.ok === true);
            if (!sent) {
                return (0, commandResult_1.commandFailed)('session_send_failed', `The chat send pipeline rejected the reply: ${JSON.stringify(sendResult).slice(0, 300)}`);
            }
            return (0, commandResult_1.commandSuccess)({
                sent: true,
                sessionKey: record.sessionKey,
                sessionName: record.name,
                peer: to,
                profileSlug: binding.profileSlug ?? null,
                result: sendResult,
            });
        },
    };
}
