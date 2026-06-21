import { type MetabotCommandResult } from '../core/contracts/commandResult';
import type { CliRuntimeContext } from './types';
export interface CommandHelpFlag {
    flag: string;
    value?: string;
    description: string;
}
export interface CommandHelpSubcommand {
    name: string;
    summary: string;
}
export interface CommandHelpSpec {
    commandPath: string[];
    summary: string;
    usage: string;
    subcommands?: CommandHelpSubcommand[];
    requiredFlags?: CommandHelpFlag[];
    optionalFlags?: CommandHelpFlag[];
    requestShape?: Record<string, unknown>;
    successFields?: string[];
    failureSemantics?: string[];
    examples?: string[];
}
export declare function renderCommandHelp(spec: CommandHelpSpec): string;
export declare function helpRequested(args: string[]): boolean;
export declare function helpJsonRequested(args: string[]): boolean;
export declare function resolveCommandHelpSpec(args: string[]): CommandHelpSpec | null;
export declare function writeResolvedHelp(context: CliRuntimeContext, args: string[]): MetabotCommandResult<unknown> & {
    __rawStdoutHandled?: boolean;
};
export declare const ROOT_COMMAND_HELP: CommandHelpSpec;
