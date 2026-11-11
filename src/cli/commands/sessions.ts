import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
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

  return commandUnknownSubcommand(`sessions ${redactSensitiveArgs(args).join(' ')}`.trim());
}
