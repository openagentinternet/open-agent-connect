import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandUnknownSubcommand } from './helpers';
import type { CliRuntimeContext } from '../types';

function readBrowserUri(args: string[]): string | MetabotCommandResult<never> | undefined {
  const uriIndex = args.indexOf('--uri');
  if (uriIndex === -1) {
    return undefined;
  }

  const rawValue = args[uriIndex + 1];
  if (typeof rawValue !== 'string' || rawValue.startsWith('--') || !rawValue.trim()) {
    return commandFailed('invalid_flag', 'Missing value for --uri.');
  }

  return rawValue.trim();
}

export async function runBrowserCommand(
  args: string[],
  context: CliRuntimeContext
): Promise<MetabotCommandResult<unknown>> {
  if (args[0] !== 'open') {
    return commandUnknownSubcommand(`browser ${args.join(' ')}`.trim());
  }

  const uri = readBrowserUri(args);
  if (uri && typeof uri !== 'string') {
    return uri;
  }

  const handler = context.dependencies.browser?.open;
  if (!handler) {
    return commandFailed('not_implemented', 'Browser open handler is not configured.');
  }

  return handler(uri ? { uri } : {});
}
