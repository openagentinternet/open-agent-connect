import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, readFlagValue } from './helpers';
import type { CliRuntimeContext } from '../types';

export async function runIdentityCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const subcommand = args[0];

  if (subcommand === 'create') {
    const name = readFlagValue(args, '--name');
    if (!name) {
      return commandMissingFlag('--name');
    }

    const host = readFlagValue(args, '--host') ?? '';

    const handler = context.dependencies.identity?.create;
    if (!handler) {
      return commandFailed('not_implemented', 'Identity create handler is not configured.');
    }
    const input: { name: string; host?: string } = { name };
    if (host) input.host = host;
    return handler(input);
  }

  if (subcommand === 'who') {
    const handler = context.dependencies.identity?.who;
    if (!handler) {
      return commandFailed('not_implemented', 'Identity who handler is not configured.');
    }
    return handler();
  }

  if (subcommand === 'list') {
    const handler = context.dependencies.identity?.list;
    if (!handler) {
      return commandFailed('not_implemented', 'Identity list handler is not configured.');
    }
    return handler();
  }

  if (subcommand === 'assign') {
    const name = readFlagValue(args, '--name');
    if (!name) {
      return commandMissingFlag('--name');
    }

    const handler = context.dependencies.identity?.assign;
    if (!handler) {
      return commandFailed('not_implemented', 'Identity assign handler is not configured.');
    }
    return handler({ name });
  }

  return commandUnknownSubcommand(`identity ${args.join(' ')}`.trim());
}
