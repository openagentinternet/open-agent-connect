/**
 * Scheduled-task daemon handler group: the /api/schedule/* verbs. Business
 * rules live in core/schedule/store; this file is wiring + input
 * normalization only (the grouptask handler-group pattern). The host lease
 * lives in the daemon process and is shared with the daemon tick via the
 * injected `hostLeases` map; `createScheduleStore` is shared too so
 * claim/complete go through the same per-profile write queue the tick uses.
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';

import {
  commandFailed,
  commandSuccess,
  type MetabotCommandResult,
} from '../core/contracts/commandResult';
import {
  getMetabotProfile,
  listMetabotProfiles,
  type MetabotProfileFull,
} from '../core/bot/metabotProfileManager';
import { resolveMetabotPaths } from '../core/state/paths';
import {
  createScheduleStore,
  SCHEDULE_HOST_LEASE_MS,
  type ScheduleRunExecutor,
  type ScheduleSpec,
  type ScheduleStore,
} from '../core/schedule/store';
import { runScheduledTask } from '../core/schedule/service';
import { createHostFirstCompletion } from '../core/llm/hostLlmExecutorBridge';
import { createLlmBindingStore } from '../core/llm/llmBindingStore';
import { createLlmRuntimeResolver } from '../core/llm/llmRuntimeResolver';
import { createLlmRuntimeStore } from '../core/llm/llmRuntimeStore';
import type { LlmExecutor } from '../core/llm/executor';
import { runLlmPromptWithRuntimeFallback } from '../core/llm/llmRuntimeExecution';
import type { MetabotDaemonHttpHandlers } from './routes/types';

const SCHEDULE_RUN_LLM_TIMEOUT_MS = 30 * 60_000;

export interface ScheduleDaemonHandlersInput {
  systemHomeDir: string;
  createScheduleStore?: (homeDir: string) => ScheduleStore;
  hostLeases?: Map<string, { host: string; expiresAtMs: number }>;
  /**
   * The daemon's shared LLM executor (local-runtime chain) for the run-now
   * verb. Absent → run-now fails with a clear error when an LLM call is
   * actually needed, same contract as the dream run handler.
   */
  llmExecutor?: Pick<LlmExecutor, 'execute' | 'getSession'> | null;
  log?: (message: string) => void;
}

export function normalizeScheduleStoreInput(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Resolve one local profile by slug (exact) then globalMetaId. */
async function resolveProfileBySelector(
  systemHomeDir: string,
  selector: string,
): Promise<MetabotProfileFull | null> {
  if (!selector) return null;
  const bySlug = await getMetabotProfile(systemHomeDir, selector).catch(() => null);
  if (bySlug) return bySlug;
  const profiles = await listMetabotProfiles(systemHomeDir).catch(() => [] as MetabotProfileFull[]);
  return profiles.find((profile) => profile.globalMetaId === selector) ?? null;
}

export function createScheduleDaemonHandlers(input: ScheduleDaemonHandlersInput): NonNullable<MetabotDaemonHttpHandlers['schedule']> {
  const { systemHomeDir } = input;
  const storeFor = (homeDir: string): ScheduleStore => (
    input.createScheduleStore
      ? input.createScheduleStore(homeDir)
      : createScheduleStore(resolveMetabotPaths(homeDir))
  );
  const hostLeases = input.hostLeases ?? new Map<string, { host: string; expiresAtMs: number }>();
  const log = input.log ?? (() => undefined);
  // Run-now in-flight guard: one background run per profile+task, dream
  // `startRun` parity; the store claim underneath is the durable guard.
  const runInFlight = new Set<string>();

  async function readPreferredRuntimeId(paths: ReturnType<typeof resolveMetabotPaths>): Promise<string | null> {
    try {
      const raw = await fs.readFile(paths.preferredLlmRuntimePath, 'utf8');
      const data = JSON.parse(raw) as { runtimeId?: string | null };
      return typeof data.runtimeId === 'string' ? data.runtimeId : null;
    } catch {
      return null;
    }
  }

  /** The daemon-side scheduled-task LLM turn: DSH pair first, local chain fallback. */
  function buildRunLlm(paths: ReturnType<typeof resolveMetabotPaths>, slug: string) {
    const llmExecutor = input.llmExecutor ?? null;
    const runtimeResolver = createLlmRuntimeResolver({
      runtimeStore: createLlmRuntimeStore(paths),
      bindingStore: createLlmBindingStore(paths),
      getPreferredRuntimeId: () => readPreferredRuntimeId(paths),
    });
    return async (turn: { prompt: string; systemPrompt: string }) => {
      if (!llmExecutor) {
        return {
          ok: false as const,
          error: 'No LLM executor is configured on this daemon for scheduled task runs.',
        };
      }
      const hostText = await createHostFirstCompletion({
        dshLlmPath: paths.dshLlmPath,
        timeoutMs: SCHEDULE_RUN_LLM_TIMEOUT_MS,
      })({ botSlug: slug, system: turn.systemPrompt, user: turn.prompt });
      if (hostText !== null) return { ok: true as const, output: hostText };
      const outcome = await runLlmPromptWithRuntimeFallback({
        runtimeResolver,
        llmExecutor,
        metaBotSlug: slug,
        prompt: turn.prompt,
        systemPrompt: turn.systemPrompt,
        timeoutMs: SCHEDULE_RUN_LLM_TIMEOUT_MS,
        pollIntervalMs: 5_000,
      });
      if (outcome.status !== 'completed') {
        return {
          ok: false as const,
          error: outcome.error || `Scheduled task execution ended with status ${outcome.status}.`,
        };
      }
      return { ok: true as const, output: outcome.output };
    };
  }

  async function resolveProfileHomeDir(from: unknown): Promise<
    { homeDir: string; slug: string; failure: MetabotCommandResult<never> | null }
  > {
    const selector = normalizeScheduleStoreInput(from);
    if (!selector) {
      return {
        homeDir: '',
        slug: '',
        failure: commandFailed('missing_from', 'A bot selector is required (--from or heartbeat slug).'),
      };
    }
    const profile = await resolveProfileBySelector(systemHomeDir, selector);
    if (!profile || typeof profile.homeDir !== 'string' || !profile.homeDir) {
      return {
        homeDir: '',
        slug: selector,
        failure: commandFailed('profile_not_found', `MetaBot profile not found: ${selector}`),
      };
    }
    return { homeDir: path.resolve(profile.homeDir), slug: profile.slug, failure: null };
  }

  return {
    heartbeat: async (rawInput) => {
      const slug = normalizeScheduleStoreInput(rawInput?.slug);
      const host = normalizeScheduleStoreInput(rawInput?.host);
      if (!slug) return commandFailed('missing_slug', 'heartbeat slug is required.');
      if (!host) return commandFailed('missing_host', 'heartbeat host is required.');
      const profile = await resolveProfileBySelector(systemHomeDir, slug);
      if (!profile) return commandFailed('profile_not_found', `MetaBot profile not found: ${slug}`);
      const expiresAtMs = Date.now() + SCHEDULE_HOST_LEASE_MS;
      hostLeases.set(profile.slug, { host, expiresAtMs });
      return commandSuccess({ slug: profile.slug, host, expiresAtMs });
    },

    due: async (rawInput) => {
      const all = rawInput?.all === true || rawInput?.all === 'true';
      if (all) {
        const profiles = await listMetabotProfiles(systemHomeDir).catch(() => [] as MetabotProfileFull[]);
        const due = [];
        for (const profile of profiles) {
          if (typeof profile.homeDir !== 'string' || !profile.homeDir) continue;
          const tasks = await storeFor(path.resolve(profile.homeDir)).listDue();
          if (tasks.length > 0) due.push({ slug: profile.slug, tasks });
        }
        return commandSuccess({ due });
      }
      const resolved = await resolveProfileHomeDir(rawInput?.from);
      if (resolved.failure) return resolved.failure;
      const tasks = await storeFor(resolved.homeDir).listDue();
      return commandSuccess({ due: [{ slug: resolved.slug, tasks }] });
    },

    list: async (rawInput) => {
      const resolved = await resolveProfileHomeDir(rawInput?.from);
      if (resolved.failure) return resolved.failure;
      const tasks = await storeFor(resolved.homeDir).listTasks();
      return commandSuccess({ tasks });
    },

    show: async (rawInput) => {
      const resolved = await resolveProfileHomeDir(rawInput?.from);
      if (resolved.failure) return resolved.failure;
      const id = normalizeScheduleStoreInput(rawInput?.id);
      if (!id) return commandFailed('missing_id', 'task id is required.');
      const task = await storeFor(resolved.homeDir).getTask(id);
      if (!task) return commandFailed('task_not_found', `Scheduled task not found: ${id}`);
      return commandSuccess({ task });
    },

    runs: async (rawInput) => {
      const resolved = await resolveProfileHomeDir(rawInput?.from);
      if (resolved.failure) return resolved.failure;
      const id = normalizeScheduleStoreInput(rawInput?.id);
      const rawLimit = rawInput?.limit;
      const numericLimit = typeof rawLimit === 'number' && Number.isFinite(rawLimit)
        ? rawLimit
        : typeof rawLimit === 'string' && rawLimit.trim() !== '' && Number.isFinite(Number(rawLimit))
          ? Number(rawLimit)
          : NaN;
      const limit = Number.isFinite(numericLimit) ? Math.floor(numericLimit) : undefined;
      const runs = await storeFor(resolved.homeDir).listRuns({
        ...(id ? { taskId: id } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
      return commandSuccess({ runs });
    },

    claim: async (rawInput) => {
      const resolved = await resolveProfileHomeDir(rawInput?.from);
      if (resolved.failure) return resolved.failure;
      const id = normalizeScheduleStoreInput(rawInput?.id);
      if (!id) return commandFailed('missing_id', 'task id is required.');
      const executorValue = normalizeScheduleStoreInput(rawInput?.executor) || 'host';
      const executor: ScheduleRunExecutor = executorValue === 'daemon' || executorValue === 'cli'
        ? executorValue
        : 'host';
      log(`[Schedule] host claim: task ${id} for ${resolved.slug}`);
      const result = await storeFor(resolved.homeDir).claim(id, { trigger: 'scheduled', executor });
      if (!result.ok) {
        if (result.code === 'task_not_found') {
          return commandFailed('task_not_found', `Scheduled task not found: ${id}`);
        }
        if (result.code === 'task_expired') {
          return commandFailed('task_expired', `Scheduled task has expired: ${id}`);
        }
        return commandFailed('already_running', `Scheduled task is already running: ${id}`);
      }
      return commandSuccess({ run: result.run, task: result.task });
    },

    complete: async (rawInput) => {
      const resolved = await resolveProfileHomeDir(rawInput?.from);
      if (resolved.failure) return resolved.failure;
      const runId = normalizeScheduleStoreInput(rawInput?.runId);
      if (!runId) return commandFailed('missing_run_id', 'run id is required.');
      const error = rawInput?.error === undefined || rawInput.error === null
        ? undefined
        : String(rawInput.error);
      const rawDuration = rawInput?.durationMs;
      const durationMs = typeof rawDuration === 'number' && Number.isFinite(rawDuration)
        ? Math.max(0, Math.floor(rawDuration))
        : undefined;
      const result = await storeFor(resolved.homeDir).complete(runId, {
        ...(error !== undefined ? { error } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
      });
      if ('notFound' in result) {
        return commandFailed('task_run_not_found', `Scheduled task run not found: ${runId}`);
      }
      return commandSuccess({ settled: result.settled, run: result.run, task: result.task });
    },

    // ---- Management verbs (the /api/schedule UI surface). Same actor rule
    // as the lease protocol above: an explicit `from` bot selector. ---------

    create: async (rawInput) => {
      const resolved = await resolveProfileHomeDir(rawInput?.from);
      if (resolved.failure) return resolved.failure;
      const name = normalizeScheduleStoreInput(rawInput?.name);
      if (!name) return commandFailed('missing_name', 'task name is required.');
      const prompt = normalizeScheduleStoreInput(rawInput?.prompt);
      if (!prompt) return commandFailed('missing_prompt', 'task prompt is required.');
      const schedule = rawInput?.schedule;
      if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
        return commandFailed('invalid_argument', 'schedule ({type: at|interval|cron, ...}) is required.');
      }
      try {
        const task = await storeFor(resolved.homeDir).createTask({
          name,
          prompt,
          schedule: schedule as ScheduleSpec,
          ...(typeof rawInput?.workingDirectory === 'string' && rawInput.workingDirectory.trim()
            ? { workingDirectory: rawInput.workingDirectory.trim() }
            : {}),
          ...(normalizeScheduleStoreInput(rawInput?.channel)
            ? { channel: normalizeScheduleStoreInput(rawInput.channel) as 'auto' | 'host' | 'daemon' }
            : {}),
          ...(typeof rawInput?.expiresAt === 'string' && rawInput.expiresAt.trim()
            ? { expiresAt: rawInput.expiresAt.trim() }
            : {}),
          ...(typeof rawInput?.enabled === 'boolean' ? { enabled: rawInput.enabled } : {}),
        });
        return commandSuccess({ task });
      } catch (error) {
        return commandFailed('invalid_argument', error instanceof Error ? error.message : String(error));
      }
    },

    update: async (rawInput) => {
      const resolved = await resolveProfileHomeDir(rawInput?.from);
      if (resolved.failure) return resolved.failure;
      const id = normalizeScheduleStoreInput(rawInput?.id);
      if (!id) return commandFailed('missing_id', 'task id is required.');
      const payload = rawInput?.payload;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return commandFailed('invalid_payload', 'payload (partial task fields) is required.');
      }
      try {
        const result = await storeFor(resolved.homeDir).updateTask(id, payload as Record<string, unknown>);
        if ('notFound' in result) {
          return commandFailed('task_not_found', `Scheduled task not found: ${id}`);
        }
        return commandSuccess({ task: result.task, warnings: result.warnings });
      } catch (error) {
        return commandFailed('invalid_argument', error instanceof Error ? error.message : String(error));
      }
    },

    delete: async (rawInput) => {
      const resolved = await resolveProfileHomeDir(rawInput?.from);
      if (resolved.failure) return resolved.failure;
      const id = normalizeScheduleStoreInput(rawInput?.id);
      if (!id) return commandFailed('missing_id', 'task id is required.');
      const result = await storeFor(resolved.homeDir).deleteTask(id);
      if (!result.deleted) {
        return commandFailed('task_not_found', `Scheduled task not found: ${id}`);
      }
      return commandSuccess({ deleted: true });
    },

    enable: async (rawInput) => {
      const resolved = await resolveProfileHomeDir(rawInput?.from);
      if (resolved.failure) return resolved.failure;
      const id = normalizeScheduleStoreInput(rawInput?.id);
      if (!id) return commandFailed('missing_id', 'task id is required.');
      const result = await storeFor(resolved.homeDir).setEnabled(id, true);
      if ('notFound' in result) {
        return commandFailed('task_not_found', `Scheduled task not found: ${id}`);
      }
      return commandSuccess({ task: result.task, warnings: result.warnings });
    },

    disable: async (rawInput) => {
      const resolved = await resolveProfileHomeDir(rawInput?.from);
      if (resolved.failure) return resolved.failure;
      const id = normalizeScheduleStoreInput(rawInput?.id);
      if (!id) return commandFailed('missing_id', 'task id is required.');
      const result = await storeFor(resolved.homeDir).setEnabled(id, false);
      if ('notFound' in result) {
        return commandFailed('task_not_found', `Scheduled task not found: ${id}`);
      }
      return commandSuccess({ task: result.task, warnings: result.warnings });
    },

    // ---- Run-now verb (the standalone schedule UI "Run now" action; the CLI
    // `metabot schedule run` twin runs in-process on the caller). Mirrors
    // /api/dream/run: `wait: true` holds the request until the run settles;
    // the default starts the run inside the daemon process and returns
    // { taskId, status: 'running' } immediately — progress is observable via
    // /api/schedule/runs. Same from-required actor rule as the verbs above;
    // the store claim is the durable single-run guard. ----------------------

    run: async (rawInput) => {
      const resolved = await resolveProfileHomeDir(rawInput?.from);
      if (resolved.failure) return resolved.failure;
      const id = normalizeScheduleStoreInput(rawInput?.id);
      if (!id) return commandFailed('missing_id', 'task id is required.');
      const paths = resolveMetabotPaths(resolved.homeDir);
      const key = `${paths.profileRoot}:${id}`;
      if (runInFlight.has(key)) {
        return commandFailed('already_running', `Scheduled task is already running: ${id}`);
      }
      const execute = async (): Promise<MetabotCommandResult<unknown>> => {
        const result = await runScheduledTask(paths, {
          taskId: id,
          trigger: 'manual',
          executor: 'daemon',
        }, { runLlm: buildRunLlm(paths, resolved.slug) });
        if (result.kind === 'already_running') {
          return commandFailed('already_running', `Scheduled task is already running: ${id}`);
        }
        if (result.kind === 'failed') {
          return commandFailed('schedule_run_failed', result.error);
        }
        return commandSuccess({ taskId: id, output: result.output });
      };

      if (rawInput?.wait === true) {
        const outcome = await execute();
        return outcome.ok ? commandSuccess({ ...outcome.data as Record<string, unknown>, wait: true }) : outcome;
      }

      runInFlight.add(key);
      void (async () => {
        try {
          const outcome = await execute();
          log(`[Schedule] run-now ${resolved.slug} task ${id} → ${outcome.ok
            ? 'completed'
            : `failed (${outcome.code ?? 'error'}: ${outcome.message ?? 'unknown'})`}`);
        } catch (error) {
          log(`[Schedule] run-now ${resolved.slug} task ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          runInFlight.delete(key);
        }
      })();
      return commandSuccess({ taskId: id, status: 'running', wait: false });
    },
  };
}