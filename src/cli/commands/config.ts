import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandUnknownSubcommand } from './helpers';
import type { CliRuntimeContext } from '../types';

export async function runConfigCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const subcommand = args[0];

  if (subcommand === 'get') {
    const handler = context.dependencies.config?.get;
    if (!handler) {
      return commandFailed('not_implemented', 'Config get handler is not configured.');
    }
    const key = args[1];
    if (!key) {
      return commandFailed('missing_argument', 'Missing required config key.');
    }
    return handler({ key });
  }

  if (subcommand === 'set') {
    const handler = context.dependencies.config?.set;
    if (!handler) {
      return commandFailed('not_implemented', 'Config set handler is not configured.');
    }
    const key = args[1];
    if (!key) {
      return commandFailed('missing_argument', 'Missing required config key.');
    }
    const rawValue = args[2];
    if (!rawValue) {
      return commandFailed('missing_argument', 'Missing required config value.');
    }
    if (rawValue !== 'true' && rawValue !== 'false') {
      return commandFailed('invalid_argument', 'Config value must be `true` or `false`.');
    }
    return handler({
      key,
      value: rawValue === 'true',
    });
  }

  return commandUnknownSubcommand(`config ${args.join(' ')}`.trim());
}
