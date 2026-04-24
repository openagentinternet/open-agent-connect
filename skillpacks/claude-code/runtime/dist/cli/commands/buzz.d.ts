import { type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { CliRuntimeContext } from '../types';
export declare function runBuzzCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>>;
