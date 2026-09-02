import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, readFlagValue, readFromFlag, readJsonFile } from './helpers';
import type { CliRuntimeContext } from '../types';

type DreamDeps = NonNullable<CliRuntimeContext['dependencies']['dream']>;

function requireDreamHandler<K extends keyof DreamDeps>(
  context: CliRuntimeContext,
  key: K,
): NonNullable<DreamDeps[K]> | MetabotCommandResult<never> {
  const handler = context.dependencies.dream?.[key];
  if (!handler) {
    return commandFailed('not_implemented', `Dream ${String(key)} handler is not configured.`);
  }
  return handler as NonNullable<DreamDeps[K]>;
}

function isFailure(value: unknown): value is MetabotCommandResult<never> {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === false);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function readDateFlag(args: string[]): string | 'invalid' | undefined {
  const raw = readFlagValue(args, '--date');
  if (raw === null) return undefined;
  return DATE_RE.test(raw.trim()) ? raw.trim() : 'invalid';
}

async function readPayload(
  context: CliRuntimeContext,
  args: string[],
  options: { required: boolean },
): Promise<Record<string, unknown> | MetabotCommandResult<never>> {
  const payloadFile = readFlagValue(args, '--payload-file');
  if (!payloadFile) {
    if (options.required) {
      return commandMissingFlag('--payload-file');
    }
    return {};
  }
  try {
    return await readJsonFile(context, payloadFile);
  } catch (error) {
    return commandFailed('invalid_payload', error instanceof Error ? error.message : String(error));
  }
}

export async function runDreamCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const [subcommand] = args;
  const from = readFromFlag(args);

  if (subcommand === 'due' || subcommand === 'status') {
    const handler = requireDreamHandler(context, subcommand);
    if (isFailure(handler)) return handler;
    return handler({ from });
  }

  if (subcommand === 'plan' || subcommand === 'run') {
    const handler = requireDreamHandler(context, subcommand);
    if (isFailure(handler)) return handler;
    const date = readDateFlag(args);
    if (date === 'invalid') {
      return commandFailed('invalid_flag', '--date must be YYYY-MM-DD.');
    }
    const payload = await readPayload(context, args, { required: false });
    if (isFailure(payload)) return payload;
    return handler({ from, ...(date ? { date } : {}), payload });
  }

  if (subcommand === 'synthesize' || subcommand === 'commit') {
    const handler = requireDreamHandler(context, subcommand);
    if (isFailure(handler)) return handler;
    const payload = await readPayload(context, args, { required: true });
    if (isFailure(payload)) return payload;
    if (typeof payload.date !== 'string' || !DATE_RE.test(payload.date)) {
      return commandFailed('invalid_payload', 'payload.date (YYYY-MM-DD) is required.');
    }
    if (subcommand === 'synthesize'
      && (!payload.fragmentOutputs || typeof payload.fragmentOutputs !== 'object' || Array.isArray(payload.fragmentOutputs))) {
      return commandFailed('invalid_payload', 'payload.fragmentOutputs (object keyed by fragmentKey) is required.');
    }
    if (subcommand === 'commit' && typeof payload.outputText !== 'string') {
      return commandFailed('invalid_payload', 'payload.outputText is required.');
    }
    return handler({ from, payload });
  }

  if (subcommand === 'fail') {
    const handler = requireDreamHandler(context, 'fail');
    if (isFailure(handler)) return handler;
    const payload = await readPayload(context, args, { required: true });
    if (isFailure(payload)) return payload;
    if (typeof payload.date !== 'string' || !DATE_RE.test(payload.date)) {
      return commandFailed('invalid_payload', 'payload.date (YYYY-MM-DD) is required.');
    }
    return handler({ from, payload });
  }

  if (subcommand === 'summaries') {
    const handler = requireDreamHandler(context, 'summaries');
    if (isFailure(handler)) return handler;
    const rawLimit = readFlagValue(args, '--limit');
    const limit = rawLimit === null ? undefined : Number(rawLimit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      return commandFailed('invalid_flag', '--limit must be a positive integer.');
    }
    return handler({
      from,
      ...(limit !== undefined ? { limit } : {}),
      before: readFlagValue(args, '--before') ?? undefined,
    });
  }

  if (subcommand === 'self-identity') {
    const handler = requireDreamHandler(context, 'selfIdentity');
    if (isFailure(handler)) return handler;
    return handler({ from });
  }

  return commandUnknownSubcommand(`dream ${String(subcommand ?? '')}`.trim());
}
