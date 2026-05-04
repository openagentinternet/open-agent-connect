#!/usr/bin/env node

import { commandFailed, commandSuccess, type MetabotCommandResult } from '../core/contracts/commandResult';
import { runNpmDoctor, runNpmInstall } from '../core/system/npmInstall';
import { CLI_VERSION } from '../cli/version';

export interface OacContext {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

interface ResolvedOacContext {
  stdout: Pick<NodeJS.WriteStream, 'write'>;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
  env: NodeJS.ProcessEnv;
  cwd: string;
}

function resolveContext(context: OacContext = {}): ResolvedOacContext {
  return {
    stdout: context.stdout ?? process.stdout,
    stderr: context.stderr ?? process.stderr,
    env: context.env ?? process.env,
    cwd: context.cwd ?? process.cwd(),
  };
}

function resolveExitCode(result: MetabotCommandResult<unknown>): number {
  if (result.ok) return 0;
  if (result.state === 'waiting' || result.state === 'manual_action_required') return 2;
  return 1;
}

function writeJsonLine(context: ResolvedOacContext, payload: unknown): void {
  context.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function readFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  return value && !value.startsWith('-') ? value : undefined;
}

function versionRequested(args: string[]): boolean {
  return args.includes('--version') || args.includes('-v');
}

function helpRequested(args: string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}

function renderHelp(): string {
  return [
    'Usage: oac <command>',
    'Summary: Open Agent Connect installer and local maintenance CLI.',
    'Commands:',
    '  install  Install shared MetaBot runtime assets and bind host skills.',
    '  doctor   Verify the npm-installed Open Agent Connect runtime state.',
    'Optional flags:',
    '  --host <codex|claude-code|openclaw>  Target host for install or doctor.',
    '  --version, -v  Print the oac CLI version.',
    '  --help, -h  Print this help text.',
    '',
  ].join('\n');
}

function rawStdoutHandledResult(): MetabotCommandResult<unknown> & {
  __rawStdoutHandled?: boolean;
} {
  const result = commandSuccess({ handled: true }) as MetabotCommandResult<unknown> & {
    __rawStdoutHandled?: boolean;
  };
  result.__rawStdoutHandled = true;
  return result;
}

export async function runOac(argv: string[], contextInput: OacContext = {}): Promise<number> {
  const context = resolveContext(contextInput);
  const [command, ...rest] = argv;
  let result: MetabotCommandResult<unknown> & { __rawStdoutHandled?: boolean };

  try {
    if (versionRequested(argv)) {
      context.stdout.write(`oac ${CLI_VERSION}\n`);
      result = rawStdoutHandledResult();
    } else if (helpRequested(argv)) {
      context.stdout.write(renderHelp());
      result = rawStdoutHandledResult();
    } else {
      const host = readFlagValue(rest, '--host');
      switch (command) {
        case 'install':
          result = await runNpmInstall({ host }, context);
          break;
        case 'doctor':
          result = await runNpmDoctor({ host }, context);
          break;
        case undefined:
          result = commandFailed('missing_command', 'No command provided.');
          break;
        default:
          result = commandFailed('unknown_command', `Unknown command: ${command}`);
          break;
      }
    }
  } catch (error) {
    result = commandFailed(
      'oac_execution_failed',
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!result.__rawStdoutHandled) {
    writeJsonLine(context, result);
  }
  return resolveExitCode(result);
}

if (require.main === module) {
  void runOac(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
