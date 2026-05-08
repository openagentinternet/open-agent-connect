import { type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { CliRuntimeContext } from '../types';
export type CliWriteChainValue = 'mvc' | 'btc' | 'doge' | 'opcat';
export type CliFileUploadChainValue = 'mvc' | 'btc' | 'opcat';
export declare function readFlagValue(args: string[], flag: string): string | null;
export declare function readChainWriteFlag(args: string[]): {
    chain: CliWriteChainValue | null;
    error: MetabotCommandResult<never> | null;
};
export declare function readFileUploadChainFlag(args: string[]): {
    chain: CliFileUploadChainValue | null;
    error: MetabotCommandResult<never> | null;
};
export declare function hasFlag(args: string[], flag: string): boolean;
export declare function readJsonFile(context: CliRuntimeContext, filePath: string): Promise<Record<string, unknown>>;
export declare function commandMissingFlag(flag: string): MetabotCommandResult<never>;
export declare function commandUnknownSubcommand(command: string): MetabotCommandResult<never>;
