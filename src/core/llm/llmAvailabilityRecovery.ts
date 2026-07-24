import { createLlmRuntimeStore } from './llmRuntimeStore';
import type { LlmRuntimeStore } from './llmRuntimeStore';
import { testLlmRuntimeReadiness } from './llmRuntimeDiscovery';
import type { LlmRuntime } from './llmTypes';

// Kill switch (spec R4.6): tests and constrained environments set this to '1'.
export const LLM_AVAILABILITY_RECOVERY_DISABLED_ENV = 'METABOT_LLM_AVAILABILITY_RECOVERY_DISABLED';

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_BASE_BACKOFF_MS = 60_000;
const DEFAULT_MAX_BACKOFF_MS = 30 * 60_000;
const DEFAULT_GLOBAL_CONCURRENCY = 2;
// One probe per store per cycle (spec R4.4): availability recovery is a
// background trickle, never a burst competing with interactive turns.
const PER_STORE_PROBE_LIMIT = 1;

interface BackoffRecord {
  failures: number;
  nextAttemptAt: number;
}

export interface LlmAvailabilityRecovery {
  /** Start the periodic loop. No-op when disabled or already running. */
  start: () => void;
  stop: () => void;
  /** Run one full cycle over all target stores. Primarily for tests. */
  runCycleOnce: () => Promise<void>;
  /**
   * Ask for an expedited cycle on one store (spec R5.3), e.g. after a chat
   * turn found no selectable runtime. Coalesced per store, fire-and-forget.
   */
  requestSoon: (homeDir: string) => void;
}

function parseIsoMs(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Recovery candidates (spec R4.2): detected/degraded runtimes, plus
// unavailable ones whose cooldown is missing or already expired.
function isRecoveryCandidate(runtime: LlmRuntime, nowMs: number): boolean {
  if (runtime.provider === 'custom') return false;
  if (runtime.health === 'detected' || runtime.health === 'degraded') return true;
  if (runtime.health === 'unavailable') {
    const until = parseIsoMs(runtime.unavailableUntil);
    return until === null || until <= nowMs;
  }
  return false;
}

export function createLlmAvailabilityRecovery(input: {
  listTargetHomes: () => Promise<string[]>;
  env?: NodeJS.ProcessEnv;
  storeForHome?: (homeDir: string) => LlmRuntimeStore;
  probe?: typeof testLlmRuntimeReadiness;
  /** Return true while a discovery sweep owns the store; the cycle skips it (spec R4.4). */
  isStoreBusy?: (homeDir: string) => boolean;
  now?: () => number;
  intervalMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  globalConcurrency?: number;
  logger?: (message: string, error?: unknown) => void;
}): LlmAvailabilityRecovery {
  const env = input.env ?? process.env;
  const storeForHome = input.storeForHome ?? ((homeDir: string) => createLlmRuntimeStore(homeDir));
  const probe = input.probe ?? testLlmRuntimeReadiness;
  const now = input.now ?? (() => Date.now());
  const intervalMs = input.intervalMs ?? DEFAULT_INTERVAL_MS;
  const baseBackoffMs = input.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
  const maxBackoffMs = input.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const globalConcurrency = Math.max(1, Math.floor(input.globalConcurrency ?? DEFAULT_GLOBAL_CONCURRENCY));
  const logger = input.logger ?? (() => undefined);

  // In-memory per-runtime backoff (spec R4.3): the persisted healthCheckedAt
  // stays the probe timestamp; only the failure counter lives here, so a
  // daemon restart simply re-probes on the next cycle.
  const backoffByRuntimeId = new Map<string, BackoffRecord>();
  const pendingSoonHomes = new Set<string>();
  const inFlightHomes = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let cycleRunning = false;

  const isDisabled = () => env[LLM_AVAILABILITY_RECOVERY_DISABLED_ENV] === '1';

  const backoffAllows = (runtimeId: string, nowMs: number): boolean => {
    const record = backoffByRuntimeId.get(runtimeId);
    return !record || nowMs >= record.nextAttemptAt;
  };

  const recordProbeOutcome = (runtime: LlmRuntime, healthy: boolean, failedAt: number): void => {
    if (healthy) {
      backoffByRuntimeId.delete(runtime.id);
      return;
    }
    const record = backoffByRuntimeId.get(runtime.id);
    const failures = (record?.failures ?? 0) + 1;
    const delay = Math.min(baseBackoffMs * 2 ** (failures - 1), maxBackoffMs);
    backoffByRuntimeId.set(runtime.id, { failures, nextAttemptAt: failedAt + delay });
  };

  const runCycleForHome = async (homeDir: string): Promise<void> => {
    if (input.isStoreBusy?.(homeDir)) return;
    if (inFlightHomes.has(homeDir)) return;
    inFlightHomes.add(homeDir);
    try {
      const store = storeForHome(homeDir);
      const state = await store.read();
      const nowMs = now();
      const candidates = state.runtimes
        .filter((runtime) => isRecoveryCandidate(runtime, nowMs) && backoffAllows(runtime.id, nowMs))
        .slice(0, PER_STORE_PROBE_LIMIT);
      for (const candidate of candidates) {
        try {
          const probed = await probe(candidate);
          await store.upsertRuntime(probed);
          recordProbeOutcome(candidate, probed.health === 'healthy', now());
        } catch (error) {
          logger(`[llm availability recovery] probe failed for ${candidate.id}`, error);
          recordProbeOutcome(candidate, false, now());
        }
      }
    } finally {
      inFlightHomes.delete(homeDir);
    }
  };

  const runCycleOnce = async (): Promise<void> => {
    if (isDisabled() || cycleRunning) return;
    cycleRunning = true;
    try {
      const homes = await input.listTargetHomes();
      // Small worker pool: at most `globalConcurrency` stores probed at once.
      let nextIndex = 0;
      const workers = Array.from({ length: Math.min(globalConcurrency, homes.length) }, async () => {
        while (nextIndex < homes.length) {
          const homeDir = homes[nextIndex];
          nextIndex += 1;
          await runCycleForHome(homeDir).catch((error) => {
            logger(`[llm availability recovery] cycle failed for ${homeDir}`, error);
          });
        }
      });
      await Promise.all(workers);
    } finally {
      cycleRunning = false;
    }
  };

  return {
    start() {
      if (isDisabled() || timer) return;
      timer = setInterval(() => {
        void runCycleOnce().catch((error) => {
          logger('[llm availability recovery] cycle failed', error);
        });
      }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    runCycleOnce,
    requestSoon(homeDir) {
      if (isDisabled() || !homeDir) return;
      if (pendingSoonHomes.has(homeDir)) return;
      pendingSoonHomes.add(homeDir);
      setImmediate(() => {
        pendingSoonHomes.delete(homeDir);
        void runCycleForHome(homeDir).catch((error) => {
          logger(`[llm availability recovery] requested cycle failed for ${homeDir}`, error);
        });
      });
    },
  };
}
