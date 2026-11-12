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

import { commandFailed, commandSuccess } from '../core/contracts/commandResult';
import { scanClaudeSessions } from '../core/sessions/discovery/claude';
import { scanCodexSessions } from '../core/sessions/discovery/codex';
import { createSessionMailQueue } from '../core/sessions/mailQueue';
import { createLocalSessionRegistry } from '../core/sessions/registry';
import { createLocalSessionRouter } from '../core/sessions/router';
import { resolveMetabotSessionPaths } from '../core/state/paths';
import type { LocalSessionRegistry, RegisterSessionInput } from '../core/sessions/registry';
import type { SessionMailQueue } from '../core/sessions/mailQueue';
import type { LocalSessionRouter } from '../core/sessions/router';
import type { MetabotDaemonHttpHandlers } from './routes/types';

export interface SessionLayer {
  registry: LocalSessionRegistry;
  mailQueue: SessionMailQueue;
  router: LocalSessionRouter;
}

/**
 * The machine-wide session layer (registry + mail queue + router), built
 once per daemon so the sessions handlers and every profile's private-chat
 orchestrator share the same single-writer instances.
 */
export function createSessionLayer(systemHomeDir: string): SessionLayer {
  const sessionPaths = resolveMetabotSessionPaths(systemHomeDir);
  const registry = createLocalSessionRegistry({ statePath: sessionPaths.localSessionsPath });
  const mailQueue = createSessionMailQueue({ statePath: sessionPaths.sessionMailPath });
  const router = createLocalSessionRouter({ registry, mailQueue });
  return { registry, mailQueue, router };
}

export interface SessionsDaemonHandlersInput {
  /** The machine-wide system home that owns `~/.metabot/sessions/`. */
  systemHomeDir: string;
  /** Shared session layer (the daemon passes one so instances stay single-writer). */
  sessionLayer?: SessionLayer;
  /** Overrides for tests: discovery roots (`<dir>/sessions`, `<dir>/session_index.jsonl`). */
  claudeDir?: string;
  codexDir?: string;
  now?: () => number;
  /**
   * Late-bound chat.private send (resolved after the handlers object is
   * assembled — the reply path for bound sessions, P2b). The returned
   * value is awaited, so handler results may be Awaitable. Absent (unit
   * tests) = sendMessage fails with chat_send_unavailable.
   */
  getChatPrivateSend?: () => ((rawInput: Record<string, unknown>) => unknown) | null;
}

export function createSessionsDaemonHandlers(
  input: SessionsDaemonHandlersInput,
): NonNullable<MetabotDaemonHttpHandlers['sessions']> {
  const sessionPaths = resolveMetabotSessionPaths(input.systemHomeDir);
  const layer = input.sessionLayer ?? createSessionLayer(input.systemHomeDir);
  const { registry, mailQueue, router } = layer;

  function normalizeRegister(rawInput: Record<string, unknown>): RegisterSessionInput | null {
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
        scanClaudeSessions({ claudeDir: input.claudeDir, now: input.now }),
        scanCodexSessions({ codexDir: input.codexDir, now: input.now }),
      ]);
      await registry.applyDiscovery([...claudeSessions, ...codexSessions]);
      const sessions = await registry.list({ all: all === true });
      return commandSuccess({
        sessions,
        discovered: { 'claude-code': claudeSessions.length, codex: codexSessions.length },
      });
    },

    // MCP/CLI session registration: marks the calling session deliverable
    // (pull tier today). Registry name-keeping applies.
    register: async (rawInput) => {
      const registerInput = normalizeRegister(rawInput);
      if (!registerInput) {
        return commandFailed('invalid_session_agent', 'agent is required.');
      }
      try {
        const record = await registry.registerSession(registerInput);
        return commandSuccess({ record });
      } catch (error) {
        return commandFailed(
          'session_register_failed',
          error instanceof Error ? error.message : String(error),
        );
      }
    },

    // The pull-tier read: long-polls the session's inbox and hands over
    // unread mail (marking it delivered). Pending = what remains after the
    // handover (the unread-notice input for tool results).
    inboxCheck: async (rawInput) => {
      const sessionKey = typeof rawInput.sessionKey === 'string' ? rawInput.sessionKey.trim() : '';
      if (!sessionKey) {
        return commandFailed('invalid_session_key', 'sessionKey is required.');
      }
      const waitSecs = typeof rawInput.waitSecs === 'number' && Number.isFinite(rawInput.waitSecs)
        ? rawInput.waitSecs
        : 0;
      try {
        const messages = await mailQueue.checkInbox({ sessionKey, waitSecs });
        const pending = await mailQueue.pendingCount(sessionKey);
        return commandSuccess({ messages, pending });
      } catch (error) {
        return commandFailed(
          'session_inbox_check_failed',
          error instanceof Error ? error.message : String(error),
        );
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
        return commandFailed('invalid_session_mail', 'sessionKey, from and a non-empty body are required.');
      }
      try {
        const entry = await mailQueue.enqueue({
          sessionKey,
          from,
          body,
          fromName: typeof rawInput.fromName === 'string' ? rawInput.fromName : undefined,
        });
        return commandSuccess({ entry });
      } catch (error) {
        return commandFailed(
          'session_enqueue_failed',
          error instanceof Error ? error.message : String(error),
        );
      }
    },

    messageStatus: async (rawInput) => {
      const ids = Array.isArray(rawInput.ids)
        ? rawInput.ids.filter((id): id is string => typeof id === 'string')
        : [];
      const receipts = await mailQueue.status(ids);
      return commandSuccess({ receipts });
    },

    // Non-consuming pending count (P5c unread notices): the MCP server
    // appends it to other tool results so a pull-tier session learns mail
    // is waiting WITHOUT handing it over.
    inboxPending: async (rawInput) => {
      const sessionKey = typeof rawInput.sessionKey === 'string' ? rawInput.sessionKey.trim() : '';
      if (!sessionKey) {
        return commandFailed('invalid_session_key', 'sessionKey is required.');
      }
      const pending = await mailQueue.pendingCount(sessionKey);
      return commandSuccess({ pending });
    },

    // P2b: bind/unbind a private-chat conversation to a local session. Mail
    // for a bound conversation is enqueued to the session instead of
    // driving a bot runtime turn (routed by the orchestrator hook).
    bind: async (rawInput) => {
      const sessionRef = typeof rawInput.sessionRef === 'string' ? rawInput.sessionRef.trim() : '';
      const conversationId = typeof rawInput.conversationId === 'string' ? rawInput.conversationId.trim() : '';
      const profileSlug = typeof rawInput.profileSlug === 'string' ? rawInput.profileSlug.trim() : undefined;
      if (!sessionRef || !conversationId) {
        return commandFailed('invalid_session_bind', 'sessionRef (name or key) and conversationId are required.');
      }
      try {
        const record = await registry.bindConversation({ sessionRef, conversationId, profileSlug });
        return commandSuccess({ record });
      } catch (error) {
        return commandFailed(
          'session_bind_failed',
          error instanceof Error ? error.message : String(error),
        );
      }
    },

    unbind: async (rawInput) => {
      const conversationId = typeof rawInput.conversationId === 'string' ? rawInput.conversationId.trim() : '';
      if (!conversationId) {
        return commandFailed('invalid_session_bind', 'conversationId is required.');
      }
      const record = await registry.unbindConversation(conversationId);
      if (!record) {
        return commandFailed('session_binding_not_found', `No session is bound to ${conversationId}.`);
      }
      return commandSuccess({ record });
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
        return commandFailed('invalid_session_send', 'sessionKey, to and a non-empty message are required.');
      }
      const record = await registry.findByRef(sessionKey);
      if (!record) {
        return commandFailed('session_not_found', `No local session matches "${sessionKey}".`);
      }
      const binding = (record.boundConversations ?? [])
        .find((entry) => entry.peerGlobalMetaId === to);
      if (!binding) {
        return commandFailed(
          'session_not_bound_to_peer',
          `Session "${record.name}" is not bound to ${to}. Reply to a message it sent you first (check_inbox), using its sender as "to".`,
        );
      }
      const send = input.getChatPrivateSend?.() ?? null;
      if (!send) {
        return commandFailed('chat_send_unavailable', 'The private-chat send pipeline is not wired in this daemon.');
      }
      const sendResult = await send({
        from: binding.profileSlug,
        to,
        content: message,
      });
      const sent = Boolean(sendResult && typeof sendResult === 'object' && (sendResult as { ok?: unknown }).ok === true);
      if (!sent) {
        return commandFailed(
          'session_send_failed',
          `The chat send pipeline rejected the reply: ${JSON.stringify(sendResult).slice(0, 300)}`,
        );
      }
      return commandSuccess({
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
