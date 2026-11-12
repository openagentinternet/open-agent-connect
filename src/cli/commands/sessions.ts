import { commandFailed, commandSuccess, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { wireHostHooks } from '../../core/sessions/hostHooks';
import { wireSessionsMcp } from '../../core/sessions/hostWire';
import { commandUnknownSubcommand, redactSensitiveArgs } from './helpers';
import type { CliRuntimeContext } from '../types';

/**
 * The local session directory (local session adapters P1): passive presence
 * for this machine's agent sessions — Claude Code, Codex, and later other
 * hosts. `list` runs the discovery scans daemon-side and shows who is
 * working on what right now (name, agent, tier, repo@branch, busy/idle).
 * P1 is read-only; claim/bind and delivery land in P2+.
 */
export async function runSessionsCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const subcommand = args[0];

  if (subcommand === 'list') {
    const all = args.includes('--all');
    const handler = context.dependencies.sessions?.list;
    if (!handler) {
      return commandFailed('not_implemented', 'Sessions list handler is not configured. Is the daemon running a build that supports it?');
    }
    return handler({ all });
  }

  // P2b: bind/unbind a private-chat conversation to a local session. Mail
  // for a bound conversation is enqueued to the session's inbox (the bot
  // runtime no longer answers it) and the session replies via the daemon.
  if (subcommand === 'bind' || subcommand === 'unbind') {
    const dependencies = context.dependencies.sessions;
    if (!dependencies?.bind || !dependencies?.unbind) {
      return commandFailed('not_implemented', 'Sessions bind handlers are not configured. Is the daemon running a build that supports them?');
    }
    if (subcommand === 'bind') {
      const rest = args.slice(1);
      const fromIndex = rest.indexOf('--from');
      const profileSlug = fromIndex >= 0 ? rest[fromIndex + 1] : undefined;
      const positional = rest.filter((arg, index) => arg !== '--from' && index !== fromIndex + 1);
      const [sessionRef, conversationId] = positional;
      if (!sessionRef || !conversationId) {
        return commandFailed('invalid_session_bind', 'Usage: metabot sessions bind <sessionName|sessionKey> <conversationId> [--from <bot-slug>]');
      }
      return dependencies.bind({ sessionRef, conversationId, profileSlug });
    }
    const conversationId = args[1];
    if (!conversationId) {
      return commandFailed('invalid_session_bind', 'Usage: metabot sessions unbind <conversationId>');
    }
    return dependencies.unbind({ conversationId });
  }

  // P2b/P4b: wire the sessions MCP server (and, for hook-tier hosts, the
  // hook handler) into a host's config so its sessions can receive mail.
  if (subcommand === 'wire') {
    const hostIndex = args.indexOf('--host');
    const host = hostIndex >= 0 ? args[hostIndex + 1] : undefined;
    if (!host) {
      return commandFailed('invalid_sessions_wire', 'Usage: metabot sessions wire --host <zcode|cursor|gemini> [--remove]');
    }
    try {
      if (host === 'zcode') {
        const result = await wireSessionsMcp({ host, remove: args.includes('--remove') });
        return commandSuccess(result);
      }
      const result = await wireHostHooks({ host: host as 'cursor' | 'gemini', remove: args.includes('--remove') });
      return commandSuccess(result);
    } catch (error) {
      return commandFailed('sessions_wire_failed', error instanceof Error ? error.message : String(error));
    }
  }

  return commandUnknownSubcommand(`sessions ${redactSensitiveArgs(args).join(' ')}`.trim());
}
