import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandUnknownSubcommand } from './helpers';
import type { CliRuntimeContext } from '../types';

function parseBrowserOpenArgs(args: string[]): {
  uri?: string;
  error?: MetabotCommandResult<never>;
} {
  let uri: string | undefined;

  for (let index = 1; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--uri') {
      const rawValue = args[index + 1];
      if (typeof rawValue !== 'string' || rawValue.startsWith('--') || !rawValue.trim()) {
        return {
          error: commandFailed('invalid_flag', 'Missing value for --uri.'),
        };
      }
      uri = rawValue;
      index += 1;
      continue;
    }
    if (token.startsWith('--')) {
      return {
        error: commandFailed('invalid_flag', `Unsupported flag: ${token}.`),
      };
    }
    return {
      error: commandFailed('invalid_flag', `Unexpected argument: ${token}.`),
    };
  }

  return { uri };
}

export async function runBrowserCommand(
  args: string[],
  context: CliRuntimeContext
): Promise<MetabotCommandResult<unknown>> {
  if (args[0] !== 'open') {
    return commandUnknownSubcommand(`browser ${args.join(' ')}`.trim());
  }

  const parsed = parseBrowserOpenArgs(args);
  if (parsed.error) {
    return parsed.error;
  }

  const handler = context.dependencies.browser?.open;
  if (!handler) {
    return commandFailed('not_implemented', 'Browser open handler is not configured.');
  }

  return handler(parsed.uri ? { uri: parsed.uri } : {});
}
