import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, hasFlag, readFlagValue, readFromFlag, readJsonFile } from './helpers';
import type { CliRuntimeContext } from '../types';
import type { ScheduleChannel, ScheduleRunExecutor, ScheduleSpec } from '../../core/schedule/store';

type ScheduleDeps = NonNullable<CliRuntimeContext['dependencies']['schedule']>;

function requireScheduleHandler<K extends keyof ScheduleDeps>(
  context: CliRuntimeContext,
  key: K,
): NonNullable<ScheduleDeps[K]> | MetabotCommandResult<never> {
  const handler = context.dependencies.schedule?.[key];
  if (!handler) {
    return commandFailed('not_implemented', `Schedule ${String(key)} handler is not configured.`);
  }
  return handler as NonNullable<ScheduleDeps[K]>;
}

function isFailure(value: unknown): value is MetabotCommandResult<never> {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === false);
}

const SCHEDULE_CHANNELS: ReadonlySet<string> = new Set(['auto', 'host', 'daemon']);
const SCHEDULE_EXECUTORS: ReadonlySet<string> = new Set(['daemon', 'host', 'cli']);

function readRequiredFlagValue(args: string[], flag: string): string | null {
  const value = readFlagValue(args, flag);
  if (value === null) return null;
  return value.trim() || null;
}

/** Build the ScheduleSpec from the --at/--every/--cron selector flags. */
function readScheduleSpec(args: string[]): { spec: ScheduleSpec | null; error: MetabotCommandResult<never> | null } {
  const at = readRequiredFlagValue(args, '--at');
  const every = readRequiredFlagValue(args, '--every');
  const cron = readRequiredFlagValue(args, '--cron');
  const selectors = [at !== null, every !== null, cron !== null].filter(Boolean).length;
  if (selectors === 0) {
    return { spec: null, error: commandFailed('invalid_flag', 'One of --at, --every, or --cron is required to define the schedule.') };
  }
  if (selectors > 1) {
    return { spec: null, error: commandFailed('invalid_flag', 'Only one of --at, --every, or --cron may be given.') };
  }
  if (at !== null) {
    if (!Number.isFinite(Date.parse(at))) {
      return { spec: null, error: commandFailed('invalid_flag', '--at must be a local wall-clock ISO datetime (for example 2026-09-05T14:30:00).') };
    }
    return { spec: { type: 'at', datetime: at }, error: null };
  }
  if (every !== null) {
    const intervalMs = Number(every);
    if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
      return { spec: null, error: commandFailed('invalid_flag', '--every must be a positive integer number of milliseconds.') };
    }
    return { spec: { type: 'interval', intervalMs }, error: null };
  }
  if (cron === null) {
    return { spec: null, error: commandFailed('invalid_flag', '--cron requires an expression.') };
  }
  return { spec: { type: 'cron', expression: cron }, error: null };
}

async function readUpdatePayload(
  context: CliRuntimeContext,
  args: string[],
): Promise<Record<string, unknown> | MetabotCommandResult<never>> {
  const payloadFile = readFlagValue(args, '--payload-file');
  if (!payloadFile) return commandMissingFlag('--payload-file');
  try {
    return await readJsonFile(context, payloadFile);
  } catch (error) {
    return commandFailed('invalid_payload', error instanceof Error ? error.message : String(error));
  }
}

export async function runScheduleCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const [subcommand] = args;
  const from = readFromFlag(args);

  if (subcommand === 'list' || subcommand === 'due') {
    const handler = requireScheduleHandler(context, subcommand);
    if (isFailure(handler)) return handler;
    if (subcommand === 'due') {
      if (from !== undefined && hasFlag(args, '--all')) {
        return commandFailed('invalid_flag', '--from and --all cannot be combined; --all covers every local profile.');
      }
      return handler({ from, ...(hasFlag(args, '--all') ? { all: true } : {}) });
    }
    return handler({ from });
  }

  if (subcommand === 'show' || subcommand === 'delete' || subcommand === 'enable'
    || subcommand === 'disable' || subcommand === 'run' || subcommand === 'claim') {
    const handler = requireScheduleHandler(context, subcommand);
    if (isFailure(handler)) return handler;
    const id = readRequiredFlagValue(args, '--id');
    if (!id) return commandMissingFlag('--id');
    if (subcommand === 'delete' && !hasFlag(args, '--confirm')) {
      return commandMissingFlag('--confirm');
    }
    if (subcommand === 'claim') {
      const executor = readFlagValue(args, '--executor');
      if (executor !== null && !SCHEDULE_EXECUTORS.has(executor.trim())) {
        return commandFailed('invalid_flag', '--executor must be daemon, host, or cli.');
      }
      return handler({
        from,
        id,
        ...(executor !== null ? { executor: executor.trim() as ScheduleRunExecutor } : {}),
      });
    }
    return handler({ from, id });
  }

  if (subcommand === 'update') {
    const handler = requireScheduleHandler(context, 'update');
    if (isFailure(handler)) return handler;
    const id = readRequiredFlagValue(args, '--id');
    if (!id) return commandMissingFlag('--id');
    const payload = await readUpdatePayload(context, args);
    if (isFailure(payload)) return payload;
    return handler({ from, id, payload });
  }

  if (subcommand === 'create') {
    const handler = requireScheduleHandler(context, 'create');
    if (isFailure(handler)) return handler;
    const name = readRequiredFlagValue(args, '--name');
    if (!name) return commandMissingFlag('--name');
    const prompt = readRequiredFlagValue(args, '--prompt');
    if (!prompt) return commandMissingFlag('--prompt');
    const { spec, error } = readScheduleSpec(args);
    if (error) return error;
    const channel = readFlagValue(args, '--channel');
    if (channel !== null && !SCHEDULE_CHANNELS.has(channel.trim())) {
      return commandFailed('invalid_flag', '--channel must be auto, host, or daemon.');
    }
    const expiresAt = readRequiredFlagValue(args, '--expires-at');
    if (expiresAt !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
      return commandFailed('invalid_flag', '--expires-at must be a date-only YYYY-MM-DD string.');
    }
    return handler({
      from,
      name,
      prompt,
      schedule: spec as ScheduleSpec,
      ...(readRequiredFlagValue(args, '--working-directory') !== null
        ? { workingDirectory: readRequiredFlagValue(args, '--working-directory') as string }
        : {}),
      ...(channel !== null ? { channel: channel.trim() as ScheduleChannel } : {}),
      ...(expiresAt !== null ? { expiresAt } : {}),
      ...(hasFlag(args, '--disabled') ? { enabled: false } : {}),
    });
  }

  if (subcommand === 'runs') {
    const handler = requireScheduleHandler(context, 'runs');
    if (isFailure(handler)) return handler;
    const id = readRequiredFlagValue(args, '--id');
    const rawLimit = readFlagValue(args, '--limit');
    const limit = rawLimit === null ? undefined : Number(rawLimit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      return commandFailed('invalid_flag', '--limit must be a positive integer.');
    }
    return handler({
      from,
      ...(id !== null ? { id } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
  }

  if (subcommand === 'complete') {
    const handler = requireScheduleHandler(context, 'complete');
    if (isFailure(handler)) return handler;
    const runId = readRequiredFlagValue(args, '--run-id');
    if (!runId) return commandMissingFlag('--run-id');
    const error = readRequiredFlagValue(args, '--error');
    const rawDuration = readFlagValue(args, '--duration-ms');
    const durationMs = rawDuration === null ? undefined : Number(rawDuration);
    if (durationMs !== undefined && (!Number.isInteger(durationMs) || durationMs < 0)) {
      return commandFailed('invalid_flag', '--duration-ms must be a non-negative integer.');
    }
    return handler({
      from,
      runId,
      ...(error !== null ? { error } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
  }

  return commandUnknownSubcommand(`schedule ${String(subcommand ?? '')}`.trim());
}
