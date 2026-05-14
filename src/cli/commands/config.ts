import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandUnknownSubcommand, readFromFlag } from './helpers';
import type { CliRuntimeContext } from '../types';

function readConfigPositionals(args: string[]): string[] {
  const positionals: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--from') {
      index += 1;
      continue;
    }
    if (arg.startsWith('--from=')) {
      continue;
    }
    positionals.push(arg);
  }
  return positionals;
}

export async function runConfigCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const subcommand = args[0];
  const from = readFromFlag(args);
  const positionals = readConfigPositionals(args);

  if (subcommand === 'get') {
    const handler = context.dependencies.config?.get;
    if (!handler) {
      return commandFailed('not_implemented', 'Config get handler is not configured.');
    }
    const key = positionals[0];
    if (!key) {
      return commandFailed('missing_argument', 'Missing required config key.');
    }
    return handler({ ...(from ? { from } : {}), key });
  }

  if (subcommand === 'set') {
    const handler = context.dependencies.config?.set;
    if (!handler) {
      return commandFailed('not_implemented', 'Config set handler is not configured.');
    }
    const key = positionals[0];
    if (!key) {
      return commandFailed('missing_argument', 'Missing required config key.');
    }
    const rawValue = positionals[1];
    if (!rawValue) {
      return commandFailed('missing_argument', 'Missing required config value.');
    }
    return handler({
      ...(from ? { from } : {}),
      key,
      value: rawValue === 'true'
        ? true
        : rawValue === 'false'
          ? false
          : rawValue,
    });
  }

  return commandUnknownSubcommand(`config ${args.join(' ')}`.trim());
}
