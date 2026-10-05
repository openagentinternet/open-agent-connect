/**
 * `metabot metatask …` — MetaTask read verbs (P1). Each subcommand parses
 * flags and delegates to context.dependencies.metatask, which the runtime
 * wires to the daemon's /api/metatask/* routes (the daemon is the single
 * writer of the shared projection cache). Write verbs (claim/submit/verify/
 * publish/amend) land with the P3 write path.
 */
import { type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { CliRuntimeContext } from '../types';
export declare function runMetaTaskCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>>;
