import { type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { CliRuntimeContext } from '../types';
/**
 * The local session directory (local session adapters P1): passive presence
 * for this machine's agent sessions — Claude Code, Codex, and later other
 * hosts. `list` runs the discovery scans daemon-side and shows who is
 * working on what right now (name, agent, tier, repo@branch, busy/idle).
 * P1 is read-only; claim/bind and delivery land in P2+.
 */
export declare function runSessionsCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>>;
