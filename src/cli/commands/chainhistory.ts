import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { ChainHistoryKind, RecordChainReadInput } from '../../core/chainhistory/types';
import { commandMissingFlag, commandUnknownSubcommand, readFromFlag, readJsonFile, readFlagValue } from './helpers';
import type { CliRuntimeContext } from '../types';

type ChainhistoryDeps = NonNullable<CliRuntimeContext['dependencies']['chainhistory']>;

function requireChainhistoryHandler<K extends keyof ChainhistoryDeps>(
  context: CliRuntimeContext,
  key: K,
): NonNullable<ChainhistoryDeps[K]> | MetabotCommandResult<never> {
  const handler = context.dependencies.chainhistory?.[key];
  if (!handler) {
    return commandFailed('not_implemented', `Chain history ${String(key)} handler is not configured.`);
  }
  return handler as NonNullable<ChainhistoryDeps[K]>;
}

function isFailure(value: unknown): value is MetabotCommandResult<never> {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === false);
}

function readOptionalString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function runChainhistoryCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const [subcommand, nested] = args;
  const from = readFromFlag(args);

  if (subcommand === 'read' && nested === 'record') {
    const handler = requireChainhistoryHandler(context, 'recordRead');
    if (isFailure(handler)) return handler;
    const payloadFile = readFlagValue(args, '--payload-file');
    if (!payloadFile) {
      return commandMissingFlag('--payload-file');
    }
    let payload: Record<string, unknown>;
    try {
      payload = await readJsonFile(context, payloadFile);
    } catch (error) {
      return commandFailed('invalid_payload', error instanceof Error ? error.message : String(error));
    }
    const pinId = readOptionalString(payload, 'pinId');
    if (!pinId) {
      return commandFailed('invalid_payload', 'payload.pinId is required.');
    }
    const input: RecordChainReadInput = {
      pinId,
      ...(readOptionalString(payload, 'path') ? { path: readOptionalString(payload, 'path') } : {}),
      ...(readOptionalString(payload, 'protocol') ? { protocol: readOptionalString(payload, 'protocol') } : {}),
      ...(readOptionalString(payload, 'title') ? { title: readOptionalString(payload, 'title') } : {}),
      ...(readOptionalString(payload, 'authorGlobalMetaId')
        ? { authorGlobalMetaId: readOptionalString(payload, 'authorGlobalMetaId') }
        : {}),
      ...(typeof payload.contentText === 'string' ? { contentText: payload.contentText } : {}),
      ...(readOptionalString(payload, 'source') ? { source: readOptionalString(payload, 'source') } : {}),
    };
    return handler({ from, input });
  }

  if (subcommand === 'read') {
    return commandUnknownSubcommand(`chainhistory read ${String(nested ?? '')}`.trim());
  }

  if (subcommand === 'summary' && nested === 'pending') {
    const handler = requireChainhistoryHandler(context, 'summaryPending');
    if (isFailure(handler)) return handler;
    const rawLimit = readFlagValue(args, '--limit');
    const limit = rawLimit === null ? undefined : Number(rawLimit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      return commandFailed('invalid_flag', '--limit must be a positive integer.');
    }
    return handler({ from, ...(limit !== undefined ? { limit } : {}) });
  }

  if (subcommand === 'summary' && nested === 'apply') {
    const handler = requireChainhistoryHandler(context, 'summaryApply');
    if (isFailure(handler)) return handler;
    const payloadFile = readFlagValue(args, '--payload-file');
    if (!payloadFile) {
      return commandMissingFlag('--payload-file');
    }
    let payload: Record<string, unknown>;
    try {
      payload = await readJsonFile(context, payloadFile);
    } catch (error) {
      return commandFailed('invalid_payload', error instanceof Error ? error.message : String(error));
    }
    const kind = readOptionalString(payload, 'kind');
    if (kind !== 'write' && kind !== 'read') {
      return commandFailed('invalid_payload', 'payload.kind must be "write" or "read".');
    }
    const pinId = readOptionalString(payload, 'pinId');
    if (!pinId) {
      return commandFailed('invalid_payload', 'payload.pinId is required.');
    }
    const outcome = readOptionalString(payload, 'outcome');
    if (outcome !== 'done' && outcome !== 'failed') {
      return commandFailed('invalid_payload', 'payload.outcome must be "done" or "failed".');
    }
    const summary = typeof payload.summary === 'string' ? payload.summary : undefined;
    if (outcome === 'done' && !(summary && summary.trim())) {
      return commandFailed('invalid_payload', 'payload.summary is required when outcome is "done".');
    }
    return handler({
      from,
      kind: kind as ChainHistoryKind,
      pinId,
      outcome,
      ...(summary !== undefined ? { summary } : {}),
    });
  }

  if (subcommand === 'summary') {
    return commandUnknownSubcommand(`chainhistory summary ${String(nested ?? '')}`.trim());
  }
  return commandUnknownSubcommand(`chainhistory ${String(subcommand ?? '')}`.trim());
}
