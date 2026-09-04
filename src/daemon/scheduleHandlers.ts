/**
 * Scheduled-task daemon handler group: the /api/schedule/* verbs. Business
 * rules live in core/schedule/store; this file is wiring + input
 * normalization only (the grouptask handler-group pattern). The host lease
 * lives in the daemon process and is shared with the daemon tick via the
 * injected `hostLeases` map; `createScheduleStore` is shared too so
 * claim/complete go through the same per-profile write queue the tick uses.
 */

import path from 'node:path';

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
  type ScheduleStore,
} from '../core/schedule/store';
import type { MetabotDaemonHttpHandlers } from './routes/types';

export interface ScheduleDaemonHandlersInput {
  systemHomeDir: string;
  createScheduleStore?: (homeDir: string) => ScheduleStore;
  hostLeases?: Map<string, { host: string; expiresAtMs: number }>;
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
  };
}