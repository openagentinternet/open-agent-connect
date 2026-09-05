import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, readFlagValue, readFromFlag, readJsonFile } from './helpers';
import type { CliRuntimeContext } from '../types';

type MemoryDeps = NonNullable<CliRuntimeContext['dependencies']['memory']>;

function requireMemoryHandler<K extends keyof MemoryDeps>(
  context: CliRuntimeContext,
  key: K,
): NonNullable<MemoryDeps[K]> | MetabotCommandResult<never> {
  const handler = context.dependencies.memory?.[key];
  if (!handler) {
    return commandFailed('not_implemented', `Memory ${String(key)} handler is not configured.`);
  }
  return handler as NonNullable<MemoryDeps[K]>;
}

function isFailure(value: unknown): value is MetabotCommandResult<never> {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === false);
}

function readOptionalLimit(args: string[]): number | 'invalid' | undefined {
  const raw = readFlagValue(args, '--limit');
  if (raw === null) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 'invalid';
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

export async function runMemoryCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const [subcommand, nested] = args;
  const from = readFromFlag(args);

  if (subcommand === 'list') {
    const handler = requireMemoryHandler(context, 'list');
    if (isFailure(handler)) return handler;
    const limit = readOptionalLimit(args);
    if (limit === 'invalid') {
      return commandFailed('invalid_flag', '--limit must be a positive integer.');
    }
    return handler({
      from,
      scopeKind: readFlagValue(args, '--scope-kind') ?? undefined,
      scopeKey: readFlagValue(args, '--scope-key') ?? undefined,
      usageClass: readFlagValue(args, '--usage-class') ?? undefined,
      status: readFlagValue(args, '--status') ?? undefined,
      origin: readFlagValue(args, '--origin') ?? undefined,
      query: readFlagValue(args, '--query') ?? undefined,
      includeDeleted: args.includes('--include-deleted'),
      ...(limit !== undefined ? { limit } : {}),
    });
  }

  if (subcommand === 'add' || subcommand === 'update' || subcommand === 'delete') {
    const handler = requireMemoryHandler(context, subcommand);
    if (isFailure(handler)) return handler;
    const payload = await readPayload(context, args, { required: true });
    if (isFailure(payload)) return payload;
    if ((subcommand === 'update' || subcommand === 'delete')
      && typeof payload.id !== 'string') {
      return commandFailed('invalid_payload', 'payload.id is required.');
    }
    if (subcommand === 'add' && typeof payload.text !== 'string') {
      return commandFailed('invalid_payload', 'payload.text is required.');
    }
    return handler({ from, payload });
  }

  if (subcommand === 'blocks') {
    const handler = requireMemoryHandler(context, 'blocks');
    if (isFailure(handler)) return handler;
    const payload = await readPayload(context, args, { required: false });
    if (isFailure(payload)) return payload;
    return handler({ from, payload });
  }

  if (subcommand === 'extract') {
    const handler = requireMemoryHandler(context, 'extract');
    if (isFailure(handler)) return handler;
    const payload = await readPayload(context, args, { required: true });
    if (isFailure(payload)) return payload;
    if (typeof payload.userText !== 'string' || typeof payload.assistantText !== 'string') {
      return commandFailed('invalid_payload', 'payload.userText and payload.assistantText are required.');
    }
    return handler({ from, payload });
  }

  if (subcommand === 'policy') {
    if (nested === 'get') {
      const handler = requireMemoryHandler(context, 'policyGet');
      if (isFailure(handler)) return handler;
      return handler({ from });
    }
    if (nested === 'set') {
      const handler = requireMemoryHandler(context, 'policySet');
      if (isFailure(handler)) return handler;
      const payload = await readPayload(context, args, { required: true });
      if (isFailure(payload)) return payload;
      return handler({ from, payload });
    }
    if (nested === 'delete') {
      const handler = requireMemoryHandler(context, 'policyDelete');
      if (isFailure(handler)) return handler;
      return handler({ from });
    }
    return commandUnknownSubcommand(`memory policy ${String(nested ?? '')}`.trim());
  }

  if (subcommand === 'scopes') {
    const handler = requireMemoryHandler(context, 'scopes');
    if (isFailure(handler)) return handler;
    return handler({ from });
  }

  if (subcommand === 'stats') {
    const handler = requireMemoryHandler(context, 'stats');
    if (isFailure(handler)) return handler;
    return handler({
      from,
      scopeKind: readFlagValue(args, '--scope-kind') ?? undefined,
      scopeKey: readFlagValue(args, '--scope-key') ?? undefined,
    });
  }

  if (subcommand === 'transcript' && nested === 'append') {
    const handler = requireMemoryHandler(context, 'transcriptAppend');
    if (isFailure(handler)) return handler;
    const payload = await readPayload(context, args, { required: true });
    if (isFailure(payload)) return payload;
    if (typeof payload.sessionId !== 'string' || typeof payload.role !== 'string' || typeof payload.text !== 'string') {
      return commandFailed('invalid_payload', 'payload.sessionId, payload.role and payload.text are required.');
    }
    return handler({ from, payload });
  }

  if (subcommand === 'chats') {
    const handler = requireMemoryHandler(context, 'chats');
    if (isFailure(handler)) return handler;
    const limit = readOptionalLimit(args);
    if (limit === 'invalid') {
      return commandFailed('invalid_flag', '--limit must be a positive integer.');
    }
    const sortOrder = readFlagValue(args, '--sort-order') ?? undefined;
    if (sortOrder !== undefined && sortOrder !== 'asc' && sortOrder !== 'desc') {
      return commandFailed('invalid_flag', '--sort-order must be asc or desc.');
    }
    return handler({
      from,
      ...(limit !== undefined ? { limit } : {}),
      ...(sortOrder !== undefined ? { sortOrder: sortOrder as 'asc' | 'desc' } : {}),
    });
  }

  if (subcommand === 'search') {
    const handler = requireMemoryHandler(context, 'search');
    if (isFailure(handler)) return handler;
    const payload = await readPayload(context, args, { required: true });
    if (isFailure(payload)) return payload;
    if (typeof payload.query !== 'string') {
      return commandFailed('invalid_payload', 'payload.query is required.');
    }
    return handler({ from, payload });
  }

  if (subcommand === 'recall') {
    const handler = requireMemoryHandler(context, 'recall');
    if (isFailure(handler)) return handler;
    const payload = await readPayload(context, args, { required: false });
    if (isFailure(payload)) return payload;
    return handler({ from, payload });
  }

  if (subcommand === 'knowledge') {
    if (nested === 'list') {
      const handler = requireMemoryHandler(context, 'knowledgeList');
      if (isFailure(handler)) return handler;
      const limit = readOptionalLimit(args);
      if (limit === 'invalid') {
        return commandFailed('invalid_flag', '--limit must be a positive integer.');
      }
      return handler({
        from,
        kind: readFlagValue(args, '--kind') ?? undefined,
        category: readFlagValue(args, '--category') ?? undefined,
        status: readFlagValue(args, '--status') ?? undefined,
        query: readFlagValue(args, '--query') ?? undefined,
        ...(limit !== undefined ? { limit } : {}),
      });
    }
    if (nested === 'upsert') {
      const handler = requireMemoryHandler(context, 'knowledgeUpsert');
      if (isFailure(handler)) return handler;
      const payload = await readPayload(context, args, { required: true });
      if (isFailure(payload)) return payload;
      if (typeof payload.topic !== 'string' || typeof payload.summary !== 'string') {
        return commandFailed('invalid_payload', 'payload.topic and payload.summary are required.');
      }
      return handler({ from, payload });
    }
    if (nested === 'update' || nested === 'archive' || nested === 'delete') {
      const key = nested === 'update' ? 'knowledgeUpdate' : nested === 'archive' ? 'knowledgeArchive' : 'knowledgeDelete';
      const handler = requireMemoryHandler(context, key);
      if (isFailure(handler)) return handler;
      const payload = await readPayload(context, args, { required: true });
      if (isFailure(payload)) return payload;
      if (typeof payload.id !== 'string') {
        return commandFailed('invalid_payload', 'payload.id is required.');
      }
      return handler({ from, payload });
    }
    return commandUnknownSubcommand(`memory knowledge ${String(nested ?? '')}`.trim());
  }

  if (subcommand === 'impressions') {
    if (nested === 'list') {
      const handler = requireMemoryHandler(context, 'impressionsList');
      if (isFailure(handler)) return handler;
      return handler({ from });
    }
    if (nested === 'show') {
      const handler = requireMemoryHandler(context, 'impressionsShow');
      if (isFailure(handler)) return handler;
      const subject = readFlagValue(args, '--subject');
      if (!subject) {
        return commandMissingFlag('--subject');
      }
      return handler({ from, subject });
    }
    return commandUnknownSubcommand(`memory impressions ${String(nested ?? '')}`.trim());
  }

  if (subcommand === 'hygiene') {
    if (nested === 'status') {
      const handler = requireMemoryHandler(context, 'hygieneStatus');
      if (isFailure(handler)) return handler;
      return handler({ from });
    }
    if (nested === 'due') {
      const handler = requireMemoryHandler(context, 'hygieneDue');
      if (isFailure(handler)) return handler;
      return handler({ from });
    }
    if (nested === 'run') {
      const handler = requireMemoryHandler(context, 'hygieneRun');
      if (isFailure(handler)) return handler;
      return handler({ from, noDeep: args.includes('--no-deep') });
    }
    if (nested === 'config') {
      const verb = args[2];
      if (verb === 'get') {
        const handler = requireMemoryHandler(context, 'hygieneConfigGet');
        if (isFailure(handler)) return handler;
        return handler({ from });
      }
      if (verb === 'set') {
        const handler = requireMemoryHandler(context, 'hygieneConfigSet');
        if (isFailure(handler)) return handler;
        const payload = await readPayload(context, args, { required: true });
        if (isFailure(payload)) return payload;
        return handler({ from, payload });
      }
      return commandUnknownSubcommand(`memory hygiene config ${String(verb ?? '')}`.trim());
    }
    return commandUnknownSubcommand(`memory hygiene ${String(nested ?? '')}`.trim());
  }

  return commandUnknownSubcommand(`memory ${String(subcommand ?? '')}`.trim());
}
