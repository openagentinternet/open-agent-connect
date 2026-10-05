/**
 * `metabot metatask …` — MetaTask read verbs (P1). Each subcommand parses
 * flags and delegates to context.dependencies.metatask, which the runtime
 * wires to the daemon's /api/metatask/* routes (the daemon is the single
 * writer of the shared projection cache). Write verbs (claim/submit/verify/
 * publish/amend) land with the P3 write path.
 */

import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, hasFlag, readFlagValue, readJsonFile } from './helpers';
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

  if (action === 'claim') {
    const handler = requireHandler(context, 'claim');
    if (!handler) return commandFailed('not_implemented', 'MetaTask claim handler is not configured.');
    const root = normalizeText(readFlagValue(args, '--root'));
    if (!root) return commandMissingFlag('--root');
    const node = normalizeText(readFlagValue(args, '--node'));
    if (!node) return commandMissingFlag('--node');
    return handler({ root, node, ...actorArg(args) });
  }

  if (action === 'release') {
    const handler = requireHandler(context, 'release');
    if (!handler) return commandFailed('not_implemented', 'MetaTask release handler is not configured.');
    const root = normalizeText(readFlagValue(args, '--root'));
    if (!root) return commandMissingFlag('--root');
    const node = normalizeText(readFlagValue(args, '--node'));
    if (!node) return commandMissingFlag('--node');
    const claimPinId = normalizeText(readFlagValue(args, '--claim'));
    if (!claimPinId) return commandMissingFlag('--claim');
    return handler({ root, node, claimPinId, ...actorArg(args) });
  }

  if (action === 'submit' || action === 'verify' || action === 'publish'
    || action === 'publish-spec' || action === 'amend') {
    const verb = action === 'publish-spec' ? 'publishSpec' : action;
    const handler = requireHandler(context, verb as 'submit');
    if (!handler) return commandFailed('not_implemented', `MetaTask ${action} handler is not configured.`);
    const requestFile = normalizeText(readFlagValue(args, '--request-file'));
    if (!requestFile) return commandMissingFlag('--request-file');
    let body: Record<string, unknown>;
    try {
      body = await readJsonFile(context, requestFile);
    } catch (error) {
      return commandFailed('invalid_request_file', error instanceof Error ? error.message : 'Cannot read the request file.');
    }
    // Canonical aliases: --root feeds rootPinId; publish accepts the
    // --allow-pre-activation escape hatch as a flag override.
    if (!body.root && (action === 'submit' || action === 'amend')) {
      const root = normalizeText(readFlagValue(args, '--root'));
      if (root) body.root = root;
    }
    if (action === 'publish' && hasFlag(args, '--allow-pre-activation')) {
      body.allowPreActivation = true;
    }
    return handler({ ...body, ...actorArg(args) });
  }

  return commandFailed(
    'unknown_subcommand',
    'Unknown metatask subcommand. Use: list | get | replay | refresh | claim | release | submit | verify | publish | publish-spec | amend.'
  );
}

/** `--from <bot-slug>` selects the acting MetaBot for write verbs. */
function actorArg(args: string[]): Record<string, unknown> {
  const from = normalizeText(readFlagValue(args, '--from'));
  return from ? { from } : {};
}
