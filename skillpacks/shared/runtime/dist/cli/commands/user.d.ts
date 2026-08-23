import { type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { CliRuntimeContext } from '../types';
export declare function runUserCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>>;
