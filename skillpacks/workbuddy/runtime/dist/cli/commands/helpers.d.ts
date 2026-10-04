import type { Readable } from 'node:stream';
import { type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { CliRuntimeContext } from '../types';
export type CliWriteChainValue = 'mvc' | 'btc' | 'doge' | 'opcat';
export type CliFileUploadChainValue = 'mvc' | 'btc' | 'opcat';
export declare function readFlagValue(args: string[], flag: string): string | null;
export declare function readFromFlag(args: string[], options?: {
    allowSlugAlias?: boolean;
}): string | undefined;
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
/**
 * Drain a stdin stream to EOF and return its content as UTF-8 text. Commands
 * that receive secrets (e.g. the owner mnemonic) read them through this
 * instead of argv, so the value never lands in shell history or process
 * listings.
 */
export declare function readStdinText(stream?: Readable): Promise<string>;
export declare function commandMissingFlag(flag: string): MetabotCommandResult<never>;
/**
 * Replace the values of secret-bearing flags with '***' before raw argv is
 * echoed back in error output: a typo like `user improt --mnemonic "<words>"`
 * must not leak the mnemonic into stdout, logs, or agent session records.
 * Handles both the `--flag value` and inline `--flag=value` forms; exact flag
 * names only, so `--mnemonic-stdin` is never treated as a value flag.
 */
export declare function redactSensitiveArgs(args: string[]): string[];
export declare function commandUnknownSubcommand(command: string): MetabotCommandResult<never>;
