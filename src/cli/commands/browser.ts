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

/**
 * Parse `browser tab open --uri <uri>`. The `tab open` form requires a URI:
 * opening an empty tab is a page-only affordance, not a CLI one (the CLI has no
 * way to target a specific open page, so an empty open would be a no-op).
 * `args` starts at `open` (i.e. everything after `browser tab`).
 */
function parseBrowserTabOpenArgs(args: string[]): {
  uri?: string;
  error?: MetabotCommandResult<never>;
} {
  if (args[0] !== 'open') {
    return { error: commandUnknownSubcommand(`browser tab ${args.join(' ')}`.trim()) };
  }

  const parsed = parseBrowserOpenArgs(args);
  if (parsed.error) {
    return parsed;
  }
  if (!parsed.uri) {
    return {
      error: commandFailed('invalid_flag', 'Missing value for --uri. Use "browser open" to open the Browser itself.'),
    };
  }
  return { uri: parsed.uri };
}

export async function runBrowserCommand(
  args: string[],
  context: CliRuntimeContext
): Promise<MetabotCommandResult<unknown>> {
  if (args[0] === 'tab') {
    const parsed = parseBrowserTabOpenArgs(args.slice(1));
    if (parsed.error) {
      return parsed.error;
    }
    const handler = context.dependencies.browser?.tabOpen;
    if (!handler) {
      return commandFailed('not_implemented', 'Browser tab open handler is not configured.');
    }
    return handler({ uri: parsed.uri! });
  }

  if (args[0] === 'link') {
    const parsed = parseBrowserOpenArgs(args);
    if (parsed.error) {
      return parsed.error;
    }
    if (!parsed.uri) {
      return commandFailed('invalid_flag', 'Missing value for --uri. "browser link" requires a URI to resolve.');
    }
    const handler = context.dependencies.browser?.link;
    if (!handler) {
      return commandFailed('not_implemented', 'Browser link handler is not configured.');
    }
    return handler({ uri: parsed.uri });
  }

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
