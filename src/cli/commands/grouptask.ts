/**
 * `metabot grouptask …` — Group Task verbs. Each subcommand parses flags and
 * delegates to context.dependencies.grouptask, which the runtime wires to the
 * daemon's /api/grouptask/* routes (the daemon is the single store writer).
 */

import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import {
  commandMissingFlag,
  commandUnknownSubcommand,
  hasFlag,
  readFlagValue,
} from './helpers';
import type { CliRuntimeContext } from '../types';

type GroupTaskDeps = NonNullable<CliRuntimeContext['dependencies']['grouptask']>;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readCsvFlag(args: string[], flag: string): string[] {
  const raw = readFlagValue(args, flag);
  if (!raw) return [];
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function readIntFlag(args: string[], flag: string): number | 'invalid' | undefined {
  const raw = readFlagValue(args, flag);
  if (raw === null) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : 'invalid';
}

function requireHandler<K extends keyof GroupTaskDeps>(
  context: CliRuntimeContext,
  key: K,
): NonNullable<GroupTaskDeps[K]> | null {
  const handler = context.dependencies.grouptask?.[key];
  return (handler ?? null) as NonNullable<GroupTaskDeps[K]> | null;
}

/** Common `--chair <slug> --task <id>` pair used by most verbs. */
function readTaskRefFlags(args: string[]): { chair: string; taskId: number } | MetabotCommandResult<never> {
  const chair = normalizeText(readFlagValue(args, '--chair'));
  if (!chair) return commandMissingFlag('--chair');
  const taskId = readIntFlag(args, '--task');
  if (taskId === undefined) return commandMissingFlag('--task');
  if (taskId === 'invalid' || taskId <= 0) {
    return commandFailed('invalid_flag', '--task must be a positive integer task id.');
  }
  return { chair, taskId };
}

function isFailure(value: { chair: string; taskId: number } | MetabotCommandResult<never>): value is MetabotCommandResult<never> {
  return 'ok' in value;
}

export async function runGroupTaskCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const action = normalizeText(args[0]);

  if (action === 'create') {
    const handler = requireHandler(context, 'create');
    if (!handler) return commandFailed('not_implemented', 'Group task create handler is not configured.');
    const title = normalizeText(readFlagValue(args, '--title'));
    if (!title) return commandMissingFlag('--title');
    const goal = normalizeText(readFlagValue(args, '--goal'));
    if (!goal) return commandMissingFlag('--goal');
    return handler({
      title,
      goal,
      acceptanceCriteria: normalizeText(readFlagValue(args, '--acceptance')) || undefined,
      workerSlugs: readCsvFlag(args, '--workers'),
      chairSlug: normalizeText(readFlagValue(args, '--chair')) || undefined,
    });
  }

  if (action === 'list') {
    const handler = requireHandler(context, 'list');
    if (!handler) return commandFailed('not_implemented', 'Group task list handler is not configured.');
    const tab = normalizeText(readFlagValue(args, '--tab')) || 'all';
    if (!['active', 'done', 'cancelled', 'all'].includes(tab)) {
      return commandFailed('invalid_flag', '--tab must be one of: active, done, cancelled, all.');
    }
    return handler({
      tab,
      includeArchived: hasFlag(args, '--include-archived'),
    });
  }

  if (action === 'detail') {
    const handler = requireHandler(context, 'detail');
    if (!handler) return commandFailed('not_implemented', 'Group task detail handler is not configured.');
    const ref = readTaskRefFlags(args);
    if (isFailure(ref)) return ref;
    return handler({
      ...ref,
      view: normalizeText(readFlagValue(args, '--view')) || undefined,
      sync: hasFlag(args, '--no-sync') ? false : undefined,
    });
  }

  if (action === 'messages') {
    const handler = requireHandler(context, 'messages');
    if (!handler) return commandFailed('not_implemented', 'Group task messages handler is not configured.');
    const ref = readTaskRefFlags(args);
    if (isFailure(ref)) return ref;
    const limit = readIntFlag(args, '--limit');
    if (limit === 'invalid') return commandFailed('invalid_flag', '--limit must be an integer.');
    const beforeIndex = readIntFlag(args, '--before-index');
    if (beforeIndex === 'invalid') return commandFailed('invalid_flag', '--before-index must be an integer.');
    return handler({
      ...ref,
      limit,
      beforeIndex,
      sync: hasFlag(args, '--no-sync') ? false : undefined,
    });
  }

  if (action === 'post') {
    const handler = requireHandler(context, 'postMessage');
    if (!handler) return commandFailed('not_implemented', 'Group task post handler is not configured.');
    const ref = readTaskRefFlags(args);
    if (isFailure(ref)) return ref;
    const content = normalizeText(readFlagValue(args, '--content'));
    if (!content) return commandMissingFlag('--content');
    const asSlug = normalizeText(readFlagValue(args, '--as'));
    const asOwner = hasFlag(args, '--as-owner');
    if (asSlug && asOwner) {
      return commandFailed('invalid_flag', '--as and --as-owner are mutually exclusive.');
    }
    return handler({
      ...ref,
      content,
      asSlug: asSlug || undefined,
      asOwner: asOwner || undefined,
      replyPin: normalizeText(readFlagValue(args, '--reply-pin')) || undefined,
      mention: readCsvFlag(args, '--mention'),
    });
  }

  if (action === 'close') {
    const handler = requireHandler(context, 'close');
    if (!handler) return commandFailed('not_implemented', 'Group task close handler is not configured.');
    const ref = readTaskRefFlags(args);
    if (isFailure(ref)) return ref;
    const outcome = normalizeText(readFlagValue(args, '--outcome'));
    if (outcome !== 'done' && outcome !== 'cancelled') {
      return commandFailed('invalid_flag', "--outcome must be 'done' or 'cancelled'.");
    }
    const rating = readIntFlag(args, '--rating');
    if (rating === 'invalid') return commandFailed('invalid_flag', '--rating must be an integer between 1 and 5.');
    return handler({
      ...ref,
      outcome,
      rating,
      ratingComment: normalizeText(readFlagValue(args, '--comment')) || undefined,
      reason: normalizeText(readFlagValue(args, '--reason')) || undefined,
    });
  }

  if (action === 'reopen') {
    const handler = requireHandler(context, 'reopen');
    if (!handler) return commandFailed('not_implemented', 'Group task reopen handler is not configured.');
    const ref = readTaskRefFlags(args);
    if (isFailure(ref)) return ref;
    return handler({
      ...ref,
      reason: normalizeText(readFlagValue(args, '--reason')) || undefined,
    });
  }

  if (action === 'kick') {
    const handler = requireHandler(context, 'kickMember');
    if (!handler) return commandFailed('not_implemented', 'Group task kick handler is not configured.');
    const ref = readTaskRefFlags(args);
    if (isFailure(ref)) return ref;
    const slug = normalizeText(readFlagValue(args, '--member'));
    const globalMetaId = normalizeText(readFlagValue(args, '--global-metaid'));
    if (!slug && !globalMetaId) {
      return commandFailed('invalid_flag', 'kick requires --member <slug> or --global-metaid <id>.');
    }
    return handler({
      ...ref,
      slug: slug || undefined,
      globalMetaId: globalMetaId || undefined,
      reason: normalizeText(readFlagValue(args, '--reason')) || undefined,
    });
  }

  if (action === 'member-status') {
    const handler = requireHandler(context, 'setMemberStatus');
    if (!handler) return commandFailed('not_implemented', 'Group task member-status handler is not configured.');
    const ref = readTaskRefFlags(args);
    if (isFailure(ref)) return ref;
    const status = normalizeText(readFlagValue(args, '--status'));
    if (!status) return commandMissingFlag('--status');
    const slug = normalizeText(readFlagValue(args, '--member'));
    const globalMetaId = normalizeText(readFlagValue(args, '--global-metaid'));
    if (!slug && !globalMetaId) {
      return commandFailed('invalid_flag', 'member-status requires --member <slug> or --global-metaid <id>.');
    }
    return handler({
      ...ref,
      status,
      slug: slug || undefined,
      globalMetaId: globalMetaId || undefined,
    });
  }

  if (action === 'rename') {
    const handler = requireHandler(context, 'rename');
    if (!handler) return commandFailed('not_implemented', 'Group task rename handler is not configured.');
    const ref = readTaskRefFlags(args);
    if (isFailure(ref)) return ref;
    const name = readFlagValue(args, '--name');
    if (name === null) return commandMissingFlag('--name');
    return handler({ ...ref, displayName: name });
  }

  if (action === 'pin' || action === 'unpin') {
    const handler = requireHandler(context, 'setPinned');
    if (!handler) return commandFailed('not_implemented', 'Group task pin handler is not configured.');
    const ref = readTaskRefFlags(args);
    if (isFailure(ref)) return ref;
    return handler({ ...ref, pinned: action === 'pin' });
  }

  if (action === 'archive' || action === 'unarchive') {
    const handler = requireHandler(context, 'setArchived');
    if (!handler) return commandFailed('not_implemented', 'Group task archive handler is not configured.');
    const ref = readTaskRefFlags(args);
    if (isFailure(ref)) return ref;
    return handler({ ...ref, archived: action === 'archive' });
  }

  return commandUnknownSubcommand(`grouptask ${args.join(' ')}`.trim());
}
