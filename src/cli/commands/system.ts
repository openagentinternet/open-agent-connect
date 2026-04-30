import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { SystemHost } from '../../core/system/types';
import { commandUnknownSubcommand, hasFlag, readFlagValue } from './helpers';
import type { CliRuntimeContext } from '../types';

const SUPPORTED_HOSTS: SystemHost[] = ['codex', 'claude-code', 'openclaw'];

function isSupportedHost(value: string): value is SystemHost {
  return SUPPORTED_HOSTS.includes(value as SystemHost);
}

function parseKnownFlags(args: string[], valueFlags: string[], booleanFlags: string[]): { error?: MetabotCommandResult<never> } {
  const valueFlagSet = new Set(valueFlags);
  const booleanFlagSet = new Set(booleanFlags);
  for (let index = 1; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      continue;
    }
    if (booleanFlagSet.has(token)) {
      continue;
    }
    if (valueFlagSet.has(token)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        return {
          error: commandFailed('invalid_flag', `Missing value for ${token}.`),
        };
      }
      index += 1;
      continue;
    }
    return {
      error: commandFailed('invalid_flag', `Unsupported flag: ${token}.`),
    };
  }
  return {};
}

export async function runSystemCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const subcommand = args[0];
  if (subcommand === 'update') {
    const parsed = parseKnownFlags(args, ['--host', '--target-version'], ['--dry-run', '--json']);
    if (parsed.error) {
      return parsed.error;
    }
    const handler = context.dependencies.system?.update;
    if (!handler) {
      return commandFailed('not_implemented', 'System update handler is not configured.');
    }
    const host = readFlagValue(args, '--host');
    if (host && !isSupportedHost(host)) {
      return commandFailed(
        'invalid_argument',
        `Unsupported --host value: ${host}. Supported values: ${SUPPORTED_HOSTS.join(', ')}.`,
      );
    }
    const version = readFlagValue(args, '--target-version') || undefined;
    return handler({
      host: host as SystemHost | undefined,
      version,
      dryRun: hasFlag(args, '--dry-run'),
    });
  }

  if (subcommand === 'uninstall') {
    const parsed = parseKnownFlags(args, ['--confirm-token'], ['--all', '--yes', '--json']);
    if (parsed.error) {
      return parsed.error;
    }
    const handler = context.dependencies.system?.uninstall;
    if (!handler) {
      return commandFailed('not_implemented', 'System uninstall handler is not configured.');
    }
    const all = hasFlag(args, '--all');
    const confirmToken = readFlagValue(args, '--confirm-token') || undefined;
    if (confirmToken && !all) {
      return commandFailed(
        'invalid_argument',
        '--confirm-token can only be used together with --all.',
      );
    }
    return handler({
      all,
      confirmToken,
      yes: hasFlag(args, '--yes'),
    });
  }

  return commandUnknownSubcommand(`system ${args.join(' ')}`.trim());
}

