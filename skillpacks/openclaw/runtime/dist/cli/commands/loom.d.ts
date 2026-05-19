import { type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { CliRuntimeContext } from '../types';
export declare function runLoomCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>>;
