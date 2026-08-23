/**
 * `metabot grouptask …` — Group Task verbs. Each subcommand parses flags and
 * delegates to context.dependencies.grouptask, which the runtime wires to the
 * daemon's /api/grouptask/* routes (the daemon is the single store writer).
 */
import { type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { CliRuntimeContext } from '../types';
export declare function runGroupTaskCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>>;
