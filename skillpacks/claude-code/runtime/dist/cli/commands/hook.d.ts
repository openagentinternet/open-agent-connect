import { type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { CliRuntimeContext } from '../types';
/**
 * `metabot hook <event>` — the turn-tier hook handler (local session
 * adapters P4a), installed into host hook configs by `metabot sessions
 * wire`. Registers/refreshes the session from the hook payload and, on a
 * mail-taking event, prints the framed inbox mail as the host's
 * additionalContext dialect. Hooks must NEVER break their host: every
 * failure exits 0 silently, and the whole run is bounded.
 */
export declare function runHookCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>>;
