import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import {
  commandMissingFlag,
  commandUnknownSubcommand,
  readChainWriteFlag,
  readFlagValue,
  readFromFlag,
  readJsonFile,
} from './helpers';
import type { CliRuntimeContext } from '../types';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Parse a positive-integer flag: undefined when absent, 'invalid' when unparseable. */
function readPositiveIntFlag(args: string[], flag: string): number | 'invalid' | undefined {
  const raw = readFlagValue(args, flag);
  if (raw === null) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 'invalid';
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
    const from = readFromFlag(args);
    const chainFlag = readChainWriteFlag(args);
    if (chainFlag.error) {
      return chainFlag.error;
    }
    const request = await readJsonFile(context, requestFile);
    return handler({
      ...request,
      ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
      ...(from ? { from } : {}),
    });
  }

  if (args[0] === 'conversations') {
    const handler = context.dependencies.chat?.conversations;
    if (!handler) {
      return commandFailed('not_implemented', 'Chat conversations handler is not configured.');
    }
    const from = readFromFlag(args);
    return handler(from ? { from } : {});
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
    const from = readFromFlag(args);
    return handler({
      conversationId: normalizeText(conversationId),
      limit: Number.isFinite(limit) ? limit : undefined,
      ...(from ? { from } : {}),
    });
  }

  if (args[0] === 'auto-reply') {
    const subAction = args[1];
    if (subAction === 'status') {
      const handler = context.dependencies.chat?.autoReplyStatus;
      if (!handler) {
        return commandFailed('not_implemented', 'Auto-reply status handler is not configured.');
      }
      const from = readFromFlag(args);
      return handler(from ? { from } : {});
    }

    if (subAction === 'enable') {
      const handler = context.dependencies.chat?.setAutoReply;
      if (!handler) {
        return commandFailed('not_implemented', 'Auto-reply config handler is not configured.');
      }
      const strategyId = readFlagValue(args, '--strategy') || undefined;
      const from = readFromFlag(args);
      return handler({ enabled: true, defaultStrategyId: strategyId, ...(from ? { from } : {}) });
    }

    if (subAction === 'disable') {
      const handler = context.dependencies.chat?.setAutoReply;
      if (!handler) {
        return commandFailed('not_implemented', 'Auto-reply config handler is not configured.');
      }
      const from = readFromFlag(args);
      return handler({ enabled: false, ...(from ? { from } : {}) });
    }

    if (subAction === 'config') {
      const handler = context.dependencies.chat?.setAutoReply;
      if (!handler) {
        return commandFailed('not_implemented', 'Auto-reply config handler is not configured.');
      }
      const from = readFromFlag(args);
      const enabledRaw = readFlagValue(args, '--enabled');
      const maxTurnsRaw = readFlagValue(args, '--max-turns');
      const cooldownMsRaw = readFlagValue(args, '--cooldown-ms');
      const strategyId = readFlagValue(args, '--strategy') || undefined;
      if (enabledRaw === null && maxTurnsRaw === null && cooldownMsRaw === null && strategyId === undefined) {
        return commandFailed(
          'invalid_flag',
          'Auto-reply config requires at least one of --enabled, --max-turns, --cooldown-ms, --strategy.',
        );
      }
      let enabled: boolean | undefined;
      if (enabledRaw !== null) {
        if (enabledRaw === 'true') enabled = true;
        else if (enabledRaw === 'false') enabled = false;
        else return commandFailed('invalid_flag', '--enabled must be true or false.');
      }
      const maxTurns = readPositiveIntFlag(args, '--max-turns');
      if (maxTurns === 'invalid') return commandFailed('invalid_flag', '--max-turns must be a positive integer.');
      const cooldownMs = readPositiveIntFlag(args, '--cooldown-ms');
      if (cooldownMs === 'invalid') return commandFailed('invalid_flag', '--cooldown-ms must be a positive integer.');
      return handler({
        ...(enabled !== undefined ? { enabled } : {}),
        ...(maxTurns !== undefined ? { maxTurns } : {}),
        ...(cooldownMs !== undefined ? { cooldownMs } : {}),
        ...(strategyId !== undefined ? { defaultStrategyId: strategyId } : {}),
        ...(from ? { from } : {}),
      });
    }

    return commandUnknownSubcommand(`chat auto-reply ${normalizeText(subAction)}`);
  }

  return commandUnknownSubcommand(`chat ${args.join(' ')}`.trim());
}
