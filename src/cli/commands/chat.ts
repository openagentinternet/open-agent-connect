import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, readFlagValue, readJsonFile } from './helpers';
import type { CliRuntimeContext } from '../types';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function runChatCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  if (args[0] === 'private') {
    const requestFile = readFlagValue(args, '--request-file');
    if (!requestFile) {
      return commandMissingFlag('--request-file');
    }
    const handler = context.dependencies.chat?.private;
    if (!handler) {
      return commandFailed('not_implemented', 'Chat private handler is not configured.');
    }
    const request = await readJsonFile(context, requestFile);
    return handler(request);
  }

  if (args[0] === 'conversations') {
    const handler = context.dependencies.chat?.conversations;
    if (!handler) {
      return commandFailed('not_implemented', 'Chat conversations handler is not configured.');
    }
    return handler();
  }

  if (args[0] === 'messages') {
    const conversationId = readFlagValue(args, '--conversation-id');
    if (!conversationId) {
      return commandMissingFlag('--conversation-id');
    }
    const limitStr = readFlagValue(args, '--limit');
    const limit = limitStr ? Number(limitStr) : undefined;
    const handler = context.dependencies.chat?.messages;
    if (!handler) {
      return commandFailed('not_implemented', 'Chat messages handler is not configured.');
    }
    return handler({
      conversationId: normalizeText(conversationId),
      limit: Number.isFinite(limit) ? limit : undefined,
    });
  }

  if (args[0] === 'auto-reply') {
    const subAction = args[1];
    if (subAction === 'status') {
      const handler = context.dependencies.chat?.autoReplyStatus;
      if (!handler) {
        return commandFailed('not_implemented', 'Auto-reply status handler is not configured.');
      }
      return handler();
    }

    if (subAction === 'enable') {
      const handler = context.dependencies.chat?.setAutoReply;
      if (!handler) {
        return commandFailed('not_implemented', 'Auto-reply config handler is not configured.');
      }
      const strategyId = readFlagValue(args, '--strategy') || undefined;
      return handler({ enabled: true, defaultStrategyId: strategyId });
    }

    if (subAction === 'disable') {
      const handler = context.dependencies.chat?.setAutoReply;
      if (!handler) {
        return commandFailed('not_implemented', 'Auto-reply config handler is not configured.');
      }
      return handler({ enabled: false });
    }

    return commandUnknownSubcommand(`chat auto-reply ${normalizeText(subAction)}`);
  }

  return commandUnknownSubcommand(`chat ${args.join(' ')}`.trim());
}
