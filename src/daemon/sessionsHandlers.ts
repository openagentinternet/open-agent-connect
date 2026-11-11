/**
 * Daemon-side sessions handler group: the /api/sessions/* verbs backing the
 * `metabot sessions *` CLI surface and the `metabot mcp` server (local
 * session adapters P1/P2a). `list` runs the passive discovery scans (Claude
 * Code registry files, Codex session index), merges presence into the
 * machine-wide registry, and returns the directory. The P2a verbs add
 * session registration and the per-session mail queue (check_inbox /
 * enqueue / message_status) — the data plane behind the MCP pull tier.
 * Nothing is delivered into a session by this group alone; routing the real
 * inbound flow lands in P2b.
 */

import { commandFailed, commandSuccess } from '../core/contracts/commandResult';
import { scanClaudeSessions } from '../core/sessions/discovery/claude';
import { scanCodexSessions } from '../core/sessions/discovery/codex';
import { createSessionMailQueue } from '../core/sessions/mailQueue';
import { createLocalSessionRegistry } from '../core/sessions/registry';
import { resolveMetabotSessionPaths } from '../core/state/paths';
import type { MetabotDaemonHttpHandlers } from './routes/types';

export interface SessionsDaemonHandlersInput {
  /** The machine-wide system home that owns `~/.metabot/sessions/`. */
  systemHomeDir: string;
  /** Overrides for tests: discovery roots (`<dir>/sessions`, `<dir>/session_index.jsonl`). */
  claudeDir?: string;
  codexDir?: string;
  now?: () => number;
}

export function createSessionsDaemonHandlers(
  input: SessionsDaemonHandlersInput,
): NonNullable<MetabotDaemonHttpHandlers['sessions']> {
  const sessionPaths = resolveMetabotSessionPaths(input.systemHomeDir);
  const registry = createLocalSessionRegistry({
    statePath: sessionPaths.localSessionsPath,
    now: input.now,
  });
  const mailQueue = createSessionMailQueue({
    statePath: sessionPaths.sessionMailPath,
    now: input.now,
  });

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
      const agent = typeof rawInput.agent === 'string' ? rawInput.agent.trim() : '';
      if (!agent) {
        return commandFailed('invalid_session_agent', 'agent is required.');
      }
      try {
        const record = await registry.registerSession({
          agent,
          sessionId: typeof rawInput.sessionId === 'string' ? rawInput.sessionId : undefined,
          pid: typeof rawInput.pid === 'number' && Number.isInteger(rawInput.pid) ? rawInput.pid : undefined,
          name: typeof rawInput.name === 'string' ? rawInput.name : undefined,
          cwd: typeof rawInput.cwd === 'string' ? rawInput.cwd : undefined,
          status: rawInput.status === 'busy' || rawInput.status === 'idle' ? rawInput.status : undefined,
          inboxSocketPath: typeof rawInput.inboxSocketPath === 'string' ? rawInput.inboxSocketPath : undefined,
          source: 'mcp',
          deliverable: true,
        });
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
  };
}
