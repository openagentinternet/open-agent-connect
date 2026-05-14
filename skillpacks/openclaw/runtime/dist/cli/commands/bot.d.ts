import { type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { CliRuntimeContext } from '../types';
export declare function runBotCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>>;
