import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, readFlagValue, readFromFlag, readJsonFile } from './helpers';
import type { CliRuntimeContext } from '../types';

type TwinDeps = NonNullable<CliRuntimeContext['dependencies']['twin']>;

function requireTwinHandler<K extends keyof TwinDeps>(
  context: CliRuntimeContext,
  key: K,
): NonNullable<TwinDeps[K]> | MetabotCommandResult<never> {
  const handler = context.dependencies.twin?.[key];
  if (!handler) {
    return commandFailed('not_implemented', `Twin ${String(key)} handler is not configured.`);
  }
  return handler as NonNullable<TwinDeps[K]>;
}

function isFailure(value: unknown): value is MetabotCommandResult<never> {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === false);
}

export async function runTwinCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const [subcommand, nested] = args;
  const from = readFromFlag(args);

  if (subcommand === 'current') {
    const handler = requireTwinHandler(context, 'current');
    if (isFailure(handler)) return handler;
    return handler();
  }

  if (subcommand === 'workers') {
    const handler = requireTwinHandler(context, 'workers');
    if (isFailure(handler)) return handler;
    return handler({ from });
  }

  if (subcommand === 'tasks') {
    if (nested === 'create') {
      const handler = requireTwinHandler(context, 'tasksCreate');
      if (isFailure(handler)) return handler;
      const payloadFile = readFlagValue(args, '--payload-file');
      if (!payloadFile) return commandMissingFlag('--payload-file');
      let payload: Record<string, unknown>;
      try {
        payload = await readJsonFile(context, payloadFile);
      } catch (error) {
        return commandFailed('invalid_payload', error instanceof Error ? error.message : String(error));
      }
      if (typeof payload.title !== 'string' || !payload.title.trim()) {
        return commandFailed('invalid_payload', 'payload.title is required.');
      }
      return handler({ from, payload });
    }
    if (nested === 'list') {
      const handler = requireTwinHandler(context, 'tasksList');
      if (isFailure(handler)) return handler;
      const rawLimit = readFlagValue(args, '--limit');
      const limit = rawLimit === null ? undefined : Number(rawLimit);
      if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
        return commandFailed('invalid_flag', '--limit must be a positive integer.');
      }
      return handler({
        from,
        status: readFlagValue(args, '--status') ?? undefined,
        ...(limit !== undefined ? { limit } : {}),
      });
    }
    if (nested === 'show') {
      const handler = requireTwinHandler(context, 'tasksShow');
      if (isFailure(handler)) return handler;
      const taskId = readFlagValue(args, '--task-id');
      if (!taskId) return commandMissingFlag('--task-id');
      return handler({ from, taskId });
    }
    if (nested === 'update') {
      const handler = requireTwinHandler(context, 'tasksUpdate');
      if (isFailure(handler)) return handler;
      const payloadFile = readFlagValue(args, '--payload-file');
      if (!payloadFile) return commandMissingFlag('--payload-file');
      let payload: Record<string, unknown>;
      try {
        payload = await readJsonFile(context, payloadFile);
      } catch (error) {
        return commandFailed('invalid_payload', error instanceof Error ? error.message : String(error));
      }
      if (typeof payload.taskId !== 'string' || !payload.taskId.trim()) {
        return commandFailed('invalid_payload', 'payload.taskId is required.');
      }
      return handler({ from, payload });
    }
    if (nested === 'pending-notify') {
      const handler = requireTwinHandler(context, 'tasksPendingNotify');
      if (isFailure(handler)) return handler;
      return handler({ from });
    }
    return commandUnknownSubcommand(`twin tasks ${String(nested ?? '')}`.trim());
  }

  return commandUnknownSubcommand(`twin ${String(subcommand ?? '')}`.trim());
}
