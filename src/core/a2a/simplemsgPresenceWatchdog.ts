import {
  readOnlineMetaBotsFromSocketPresence,
  type ReadOnlineMetaBotsFromSocketPresenceResult,
} from '../discovery/socketPresenceDirectory';
import type {
  A2ASimplemsgListenerManager,
  A2ASimplemsgListenerStartReport,
  A2ASimplemsgStartedProfile,
} from './simplemsgListener';

const DEFAULT_WATCHDOG_INTERVAL_MS = 30_000;
const DEFAULT_WATCHDOG_GRACE_PERIOD_MS = 60_000;
const DEFAULT_WATCHDOG_RESTART_COOLDOWN_MS = 180_000;
const DEFAULT_SOCKET_PRESENCE_LIMIT = 100;

export type A2ASimplemsgPresenceWatchdogStatus =
  | 'healthy'
  | 'started'
  | 'no_profiles'
  | 'presence_unavailable'
  | 'missing_grace'
  | 'restart_cooling_down'
  | 'restarted';

export interface A2ASimplemsgPresenceWatchdogCheckResult {
  status: A2ASimplemsgPresenceWatchdogStatus;
  report: A2ASimplemsgListenerStartReport;
  missing: A2ASimplemsgStartedProfile[];
  error?: Error;
}

export interface A2ASimplemsgPresenceWatchdogRestartEvent {
  missing: A2ASimplemsgStartedProfile[];
  previousReport: A2ASimplemsgListenerStartReport;
  restartReport: A2ASimplemsgListenerStartReport;
  missingSinceMs: number;
  restartedAtMs: number;
}

export interface A2ASimplemsgPresenceWatchdog {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  checkOnce(): Promise<A2ASimplemsgPresenceWatchdogCheckResult>;
}

export interface A2ASimplemsgPresenceWatchdogOptions {
  manager: A2ASimplemsgListenerManager;
  intervalMs?: number;
  gracePeriodMs?: number;
  restartCooldownMs?: number;
  socketPresenceLimit?: number;
  now?: () => number;
  readOnlineMetaBots?: () => Promise<Pick<ReadOnlineMetaBotsFromSocketPresenceResult, 'bots'>>;
  onRestart?: (event: A2ASimplemsgPresenceWatchdogRestartEvent) => void;
  onError?: (error: Error) => void;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDurationMs(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value as number));
}

function cloneReport(report: A2ASimplemsgListenerStartReport): A2ASimplemsgListenerStartReport {
  return {
    started: report.started.map((profile) => ({ ...profile })),
    skipped: report.skipped.map((profile) => ({ ...profile })),
  };
}

function buildMissingKey(missing: A2ASimplemsgStartedProfile[]): string {
  return missing
    .map((profile) => normalizeText(profile.globalMetaId))
    .filter(Boolean)
    .sort()
    .join('\n');
}

function findMissingPresenceProfiles(
  report: A2ASimplemsgListenerStartReport,
  presence: Pick<ReadOnlineMetaBotsFromSocketPresenceResult, 'bots'>,
): A2ASimplemsgStartedProfile[] {
  const onlineGlobalMetaIds = new Set(
    presence.bots
      .map((bot) => normalizeText(bot.globalMetaId))
      .filter(Boolean),
  );
  return report.started.filter((profile) => {
    const globalMetaId = normalizeText(profile.globalMetaId);
    return Boolean(globalMetaId) && !onlineGlobalMetaIds.has(globalMetaId);
  });
}

export function createA2ASimplemsgPresenceWatchdog(
  input: A2ASimplemsgPresenceWatchdogOptions,
): A2ASimplemsgPresenceWatchdog {
  const intervalMs = normalizeDurationMs(input.intervalMs, DEFAULT_WATCHDOG_INTERVAL_MS);
  const gracePeriodMs = normalizeDurationMs(input.gracePeriodMs, DEFAULT_WATCHDOG_GRACE_PERIOD_MS);
  const restartCooldownMs = normalizeDurationMs(input.restartCooldownMs, DEFAULT_WATCHDOG_RESTART_COOLDOWN_MS);
  const socketPresenceLimit = Math.max(1, Math.floor(input.socketPresenceLimit ?? DEFAULT_SOCKET_PRESENCE_LIMIT));
  const now = input.now ?? Date.now;
  const readOnlineMetaBots = input.readOnlineMetaBots ?? (() => readOnlineMetaBotsFromSocketPresence({
    limit: socketPresenceLimit,
  }));
  let timer: ReturnType<typeof setInterval> | null = null;
  let checking = false;
  let missingSinceMs: number | null = null;
  let missingKey = '';
  let lastRestartAtMs: number | null = null;

  const resetMissingState = (): void => {
    missingSinceMs = null;
    missingKey = '';
  };

  const checkOnce = async (): Promise<A2ASimplemsgPresenceWatchdogCheckResult> => {
    if (!input.manager.isRunning()) {
      const startedReport = cloneReport(await input.manager.start());
      resetMissingState();
      return {
        status: 'started',
        report: startedReport,
        missing: [],
      };
    }

    const report = cloneReport(input.manager.getLastReport());
    if (report.started.length === 0) {
      resetMissingState();
      return {
        status: 'no_profiles',
        report,
        missing: [],
      };
    }

    let presence: Pick<ReadOnlineMetaBotsFromSocketPresenceResult, 'bots'>;
    try {
      presence = await readOnlineMetaBots();
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      input.onError?.(normalizedError);
      return {
        status: 'presence_unavailable',
        report,
        missing: [],
        error: normalizedError,
      };
    }

    const missing = findMissingPresenceProfiles(report, presence);
    if (missing.length === 0) {
      resetMissingState();
      return {
        status: 'healthy',
        report,
        missing: [],
      };
    }

    const currentMissingKey = buildMissingKey(missing);
    const currentTimeMs = now();
    if (missingSinceMs === null || currentMissingKey !== missingKey) {
      missingSinceMs = currentTimeMs;
      missingKey = currentMissingKey;
    }

    const missingDurationMs = Math.max(0, currentTimeMs - missingSinceMs);
    if (missingDurationMs < gracePeriodMs) {
      return {
        status: 'missing_grace',
        report,
        missing,
      };
    }

    if (lastRestartAtMs !== null && currentTimeMs - lastRestartAtMs < restartCooldownMs) {
      return {
        status: 'restart_cooling_down',
        report,
        missing,
      };
    }

    const previousReport = cloneReport(report);
    const missingStartedAtMs = missingSinceMs;
    input.manager.stop();
    const restartReport = cloneReport(await input.manager.start());
    lastRestartAtMs = currentTimeMs;
    resetMissingState();
    input.onRestart?.({
      missing,
      previousReport,
      restartReport,
      missingSinceMs: missingStartedAtMs,
      restartedAtMs: currentTimeMs,
    });
    return {
      status: 'restarted',
      report: restartReport,
      missing,
    };
  };

  const runTimerCheck = (): void => {
    if (checking) return;
    checking = true;
    void checkOnce()
      .catch((error) => {
        input.onError?.(error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => {
        checking = false;
      });
  };

  return {
    start() {
      if (timer) return;
      timer = setInterval(runTimerCheck, intervalMs);
      timer.unref?.();
    },

    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      checking = false;
      resetMissingState();
    },

    isRunning() {
      return Boolean(timer);
    },

    checkOnce,
  };
}
