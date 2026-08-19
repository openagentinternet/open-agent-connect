import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, readFlagValue, readFromFlag } from './helpers';
import type { CliRuntimeContext } from '../types';

function readLocalFlag(args: string[]): string | undefined {
  return readFlagValue(args, '--local')
    ?? readFromFlag(args)
    ?? undefined;
}

function readPositiveIntFlag(args: string[], flag: string): number | 'invalid' | undefined {
  const raw = readFlagValue(args, flag);
  if (raw === null) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 'invalid';
}

function readNumberFlag(args: string[], flag: string): number | 'invalid' | undefined {
  const raw = readFlagValue(args, flag);
  if (raw === null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 'invalid';
}

export async function runConversationsCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const [subcommand] = args;
  if (subcommand === 'list') {
    const handler = context.dependencies.conversations?.list;
    if (!handler) {
      return commandFailed('not_implemented', 'Conversations list handler is not configured.');
    }
    const local = readLocalFlag(args);
    if (!local) {
      return commandMissingFlag('--local');
    }
    const limit = readPositiveIntFlag(args, '--limit');
    if (limit === 'invalid') {
      return commandFailed('invalid_flag', '--limit must be a positive integer.');
    }
    return handler({ local, ...(limit !== undefined ? { limit } : {}) });
  }

  if (subcommand === 'messages') {
    const handler = context.dependencies.conversations?.messages;
    if (!handler) {
      return commandFailed('not_implemented', 'Conversations messages handler is not configured.');
    }
    const local = readLocalFlag(args);
    if (!local) {
      return commandMissingFlag('--local');
    }
    const peer = readFlagValue(args, '--peer') || undefined;
    if (!peer) {
      return commandMissingFlag('--peer');
    }
    const limit = readPositiveIntFlag(args, '--limit');
    if (limit === 'invalid') {
      return commandFailed('invalid_flag', '--limit must be a positive integer.');
    }
    const before = readNumberFlag(args, '--before');
    if (before === 'invalid') {
      return commandFailed('invalid_flag', '--before must be a number.');
    }
    const after = readNumberFlag(args, '--after');
    if (after === 'invalid') {
      return commandFailed('invalid_flag', '--after must be a number.');
    }
    return handler({
      local,
      peer,
      ...(limit !== undefined ? { limit } : {}),
      ...(before !== undefined ? { before } : {}),
      ...(after !== undefined ? { after } : {}),
    });
  }

  if (subcommand === 'guidance') {
    const handler = context.dependencies.conversations?.guidance;
    if (!handler) {
      return commandFailed('not_implemented', 'Conversations guidance handler is not configured.');
    }
    const local = readLocalFlag(args);
    if (!local) {
      return commandMissingFlag('--local');
    }
    const peer = readFlagValue(args, '--peer') || undefined;
    if (!peer) {
      return commandMissingFlag('--peer');
    }
    const guidance = readFlagValue(args, '--guidance') || undefined;
    if (!guidance) {
      return commandMissingFlag('--guidance');
    }
    return handler({ local, peer, guidance });
  }

  return commandUnknownSubcommand(`conversations ${String(subcommand ?? '')}`.trim());
}
