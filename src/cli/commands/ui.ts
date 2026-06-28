import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, readFlagValue } from './helpers';
import type { CliRuntimeContext } from '../types';

const SUPPORTED_UI_PAGES = new Set([
  'hub',
  'bot',
  'conversations',
  'services',
  'apps',
  'settings',
  'buzz',
  'chat',
  'publish',
  'my-services',
  'trace',
  'refund',
  'loom',
  'metaapps',
]);

export async function runUiCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  if (args[0] !== 'open') {
    return commandUnknownSubcommand(`ui ${args.join(' ')}`.trim());
  }

  const page = readFlagValue(args, '--page')?.trim();
  if (!page) {
    return commandMissingFlag('--page');
  }
  if (!SUPPORTED_UI_PAGES.has(page)) {
    return commandFailed('unknown_ui_page', `Unknown UI page: ${page}`);
  }
  const from = readFlagValue(args, '--from') || undefined;
  const traceId = readFlagValue(args, '--trace-id') || undefined;
  const sessionId = readFlagValue(args, '--session-id') || undefined;
  const serviceId = readFlagValue(args, '--service-id') || undefined;

  const handler = context.dependencies.ui?.open;
  if (!handler) {
    return commandFailed('not_implemented', 'UI open handler is not configured.');
  }
  return handler({
    page,
    ...(from ? { from } : {}),
    ...(traceId ? { traceId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(serviceId ? { serviceId } : {}),
  });
}
