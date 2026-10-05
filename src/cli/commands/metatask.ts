/**
 * `metabot metatask …` — MetaTask read verbs (P1). Each subcommand parses
 * flags and delegates to context.dependencies.metatask, which the runtime
 * wires to the daemon's /api/metatask/* routes (the daemon is the single
 * writer of the shared projection cache). Write verbs (claim/submit/verify/
 * publish/amend) land with the P3 write path.
 */

import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, hasFlag, readFlagValue } from './helpers';
import type { CliRuntimeContext } from '../types';

type MetaTaskDeps = NonNullable<CliRuntimeContext['dependencies']['metatask']>;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireHandler<K extends keyof MetaTaskDeps>(
  context: CliRuntimeContext,
  key: K,
): NonNullable<MetaTaskDeps[K]> | null {
  const handler = context.dependencies.metatask?.[key];
  return (handler ?? null) as NonNullable<MetaTaskDeps[K]> | null;
}

export async function runMetaTaskCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const action = normalizeText(args[0]);

  if (action === 'list' || action === 'board') {
    const handler = requireHandler(context, 'list');
    if (!handler) return commandFailed('not_implemented', 'MetaTask list handler is not configured.');
    return handler({ ...(hasFlag(args, '--refresh') ? { refresh: true } : {}) });
  }

  if (action === 'get' || action === 'detail') {
    const handler = requireHandler(context, 'get');
    if (!handler) return commandFailed('not_implemented', 'MetaTask get handler is not configured.');
    const root = normalizeText(readFlagValue(args, '--root'));
    if (!root) return commandMissingFlag('--root');
    return handler({ root, ...(hasFlag(args, '--refresh') ? { refresh: true } : {}) });
  }

  if (action === 'replay') {
    const handler = requireHandler(context, 'replay');
    if (!handler) return commandFailed('not_implemented', 'MetaTask replay handler is not configured.');
    const root = normalizeText(readFlagValue(args, '--root'));
    if (!root) return commandMissingFlag('--root');
    return handler({ root });
  }

  if (action === 'refresh') {
    const handler = requireHandler(context, 'refresh');
    if (!handler) return commandFailed('not_implemented', 'MetaTask refresh handler is not configured.');
    return handler({ reason: 'cli-refresh' });
  }

  return commandFailed(
    'unknown_subcommand',
    'Unknown metatask subcommand. Use: list | get | replay | refresh.'
  );
}
