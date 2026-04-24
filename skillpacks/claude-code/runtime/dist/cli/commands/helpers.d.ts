import { type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { CliRuntimeContext } from '../types';
export type CliChainValue = 'mvc' | 'btc';
export declare function readFlagValue(args: string[], flag: string): string | null;
export declare function readChainFlag(args: string[]): {
    chain: CliChainValue | null;
    error: MetabotCommandResult<never> | null;
};
export declare function hasFlag(args: string[], flag: string): boolean;
export declare function readJsonFile(context: CliRuntimeContext, filePath: string): Promise<Record<string, unknown>>;
export declare function commandMissingFlag(flag: string): MetabotCommandResult<never>;
export declare function commandUnknownSubcommand(command: string): MetabotCommandResult<never>;
