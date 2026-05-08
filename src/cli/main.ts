#!/usr/bin/env node

import { commandFailed, commandSuccess, type MetabotCommandResult } from '../core/contracts/commandResult';
import { CLI_VERSION } from './version';
import { runDaemonCommand } from './commands/daemon';
import { runDoctorCommand } from './commands/doctor';
import { runIdentityCommand } from './commands/identity';
import { runMasterCommand } from './commands/master';
import { runNetworkCommand } from './commands/network';
import { runProviderCommand } from './commands/provider';
import { runServicesCommand } from './commands/services';
import { runBuzzCommand } from './commands/buzz';
import { runChainCommand } from './commands/chain';
import { runChatCommand } from './commands/chat';
import { runFileCommand } from './commands/file';
import { runTraceCommand } from './commands/trace';
import { runUiCommand } from './commands/ui';
import { runConfigCommand } from './commands/config';
import { runSkillsCommand } from './commands/skills';
import { runHostCommand } from './commands/host';
import { runEvolutionCommand } from './commands/evolution';
import { runWalletCommand } from './commands/wallet';
import { runSystemCommand } from './commands/system';
import { runLlmCommand } from './commands/llm';
import { commandUnknownSubcommand } from './commands/helpers';
import { helpRequested, writeResolvedHelp } from './commandHelp';
import { createCliRuntimeContext, type CliContext } from './types';
import { mergeCliDependencies, serveCliDaemonProcess } from './runtime';

function resolveExitCode(result: MetabotCommandResult<unknown>): number {
  if (result.ok) return 0;
  if (result.state === 'waiting' || result.state === 'manual_action_required') return 2;
  return 1;
}

function writeJsonLine(context: ReturnType<typeof createCliRuntimeContext>, payload: unknown): void {
  context.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function versionRequested(args: string[]): boolean {
  return args.includes('--version') || args.includes('-v');
}

function writeResolvedVersion(
  context: ReturnType<typeof createCliRuntimeContext>,
  args: string[]
): MetabotCommandResult<unknown> & { __rawStdoutHandled?: boolean } {
  const output = args.includes('--json')
    ? `${JSON.stringify({ version: CLI_VERSION }, null, 2)}\n`
    : `metabot ${CLI_VERSION}\n`;
  context.stdout.write(output);
  const result = commandSuccess({ version: CLI_VERSION }) as MetabotCommandResult<unknown> & {
    __rawStdoutHandled?: boolean;
  };
  result.__rawStdoutHandled = true;
  return result;
}

export async function runCli(argv: string[], cliContext: CliContext = {}): Promise<number> {
  const context = createCliRuntimeContext(cliContext);
  context.dependencies = mergeCliDependencies(context);

  const [command, ...rest] = argv;
  let result: MetabotCommandResult<unknown>;

  try {
    if (versionRequested(argv)) {
      result = writeResolvedVersion(context, argv);
    } else if (helpRequested(argv)) {
      result = writeResolvedHelp(context, argv);
    } else {
      switch (command) {
        case 'buzz':
          result = await runBuzzCommand(rest, context);
          break;
        case 'chain':
          result = await runChainCommand(rest, context);
          break;
        case 'daemon':
          result = await runDaemonCommand(rest, context);
          break;
        case 'doctor':
          result = await runDoctorCommand(rest, context);
          break;
        case 'identity':
          result = await runIdentityCommand(rest, context);
          break;
        case 'master':
          result = await runMasterCommand(rest, context);
          break;
        case 'network':
          result = await runNetworkCommand(rest, context);
          break;
        case 'provider':
          result = await runProviderCommand(rest, context);
          break;
        case 'services':
          result = await runServicesCommand(rest, context);
          break;
        case 'chat':
          result = await runChatCommand(rest, context);
          break;
        case 'file':
          result = await runFileCommand(rest, context);
          break;
        case 'wallet':
          result = await runWalletCommand(rest, context);
          break;
        case 'trace':
          result = await runTraceCommand(rest, context);
          break;
        case 'ui':
          result = await runUiCommand(rest, context);
          break;
        case 'config':
          result = await runConfigCommand(rest, context);
          break;
        case 'skills':
          result = await runSkillsCommand(rest, context);
          break;
        case 'host':
          result = await runHostCommand(rest, context);
          break;
        case 'evolution':
          result = await runEvolutionCommand(rest, context);
          break;
        case 'system':
          result = await runSystemCommand(rest, context);
          break;
        case 'llm':
          result = await runLlmCommand(rest, context);
          break;
        case undefined:
          result = commandFailed('missing_command', 'No command provided.');
          break;
        default:
          result = commandUnknownSubcommand(command);
          break;
      }
    }
  } catch (error) {
    result = commandFailed(
      'cli_execution_failed',
      error instanceof Error ? error.message : String(error)
    );
  }

  if (!(result as { __rawStdoutHandled?: boolean }).__rawStdoutHandled) {
    writeJsonLine(context, result);
  }
  return resolveExitCode(result);
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] === 'daemon' && argv[1] === 'serve') {
    void serveCliDaemonProcess({
      env: process.env,
      cwd: process.cwd(),
    });
  } else {
    void runCli(argv).then((exitCode) => {
      process.exitCode = exitCode;
    });
  }
}
