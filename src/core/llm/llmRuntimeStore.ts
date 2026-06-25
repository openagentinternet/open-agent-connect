import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveMetabotPaths } from '../state/paths';
import {
  normalizeLlmRuntimesState,
  normalizeLlmRuntime,
} from './llmTypes';
import type {
  LlmRuntime,
  LlmRuntimesState,
} from './llmTypes';

function resolveRuntimesPath(homeDirOrPaths: string | { llmRuntimesPath: string }): string {
  if (typeof homeDirOrPaths === 'object' && 'llmRuntimesPath' in homeDirOrPaths) {
    return homeDirOrPaths.llmRuntimesPath;
  }
  return resolveMetabotPaths(homeDirOrPaths as string).llmRuntimesPath;
}

async function readJsonFile(filePath: string): Promise<LlmRuntimesState> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { version: 1, runtimes: [] };
    }
    throw error;
  }

  try {
    return normalizeLlmRuntimesState(JSON.parse(raw));
  } catch {
    return { version: 1, runtimes: [] };
  }
}

async function writeJsonFile(filePath: string, state: LlmRuntimesState): Promise<void> {
  // Ensure parent directory exists.
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // Atomic write: temp file then rename.
  const tmpPath = filePath + '.tmp.' + Math.random().toString(36).slice(2, 8);
  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2) + '\n', 'utf8');
  await fs.rename(tmpPath, filePath);
}

export interface LlmRuntimeStore {
  read(): Promise<LlmRuntimesState>;
  write(state: LlmRuntimesState): Promise<LlmRuntimesState>;
  upsertRuntime(runtime: LlmRuntime, options?: UpsertRuntimeOptions): Promise<LlmRuntimesState>;
  removeRuntime(runtimeId: string): Promise<LlmRuntimesState>;
  markSeen(runtimeId: string, now: string): Promise<LlmRuntimesState>;
  updateHealth(runtimeId: string, health: string, options?: {
    reason?: string;
    healthCheckedAt?: string;
    unavailableUntil?: string;
  }): Promise<LlmRuntimesState>;
}

export interface UpsertRuntimeOptions {
  preserveRecentHealthyOnDetected?: boolean;
  preserveRecentHealthyWindowMs?: number;
}

const DEFAULT_RECENT_HEALTHY_WINDOW_MS = 30 * 60 * 1000;

function isFutureIso(value: string | undefined, nowMs = Date.now()): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > nowMs;
}

function parseIsoMs(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function shouldPreserveRecentHealthyRuntime(
  existing: LlmRuntime,
  incoming: LlmRuntime,
  windowMs: number,
): boolean {
  if (existing.health !== 'healthy' || incoming.health !== 'detected') return false;
  const existingCheckedAt = parseIsoMs(existing.healthCheckedAt ?? existing.updatedAt);
  const incomingCheckedAt = parseIsoMs(incoming.healthCheckedAt ?? incoming.updatedAt);
  if (existingCheckedAt === null || incomingCheckedAt === null) return false;
  if (incomingCheckedAt < existingCheckedAt) return false;
  return incomingCheckedAt - existingCheckedAt <= windowMs;
}

function mergeRuntimeForUpsert(
  existing: LlmRuntime | undefined,
  incoming: LlmRuntime,
  options?: UpsertRuntimeOptions,
): LlmRuntime {
  if (!existing) return incoming;
  if (
    existing.health === 'unavailable'
    && incoming.health === 'detected'
    && isFutureIso(existing.unavailableUntil)
  ) {
    return {
      ...incoming,
      health: 'unavailable',
      healthReason: existing.healthReason,
      unavailableUntil: existing.unavailableUntil,
      healthCheckedAt: incoming.healthCheckedAt ?? existing.healthCheckedAt,
    };
  }
  if (
    options?.preserveRecentHealthyOnDetected
    && shouldPreserveRecentHealthyRuntime(
      existing,
      incoming,
      options.preserveRecentHealthyWindowMs ?? DEFAULT_RECENT_HEALTHY_WINDOW_MS,
    )
  ) {
    return {
      ...incoming,
      health: 'healthy',
      healthReason: undefined,
      unavailableUntil: undefined,
      healthCheckedAt: incoming.healthCheckedAt ?? existing.healthCheckedAt,
      updatedAt: incoming.updatedAt ?? existing.updatedAt,
      lastSeenAt: incoming.lastSeenAt ?? existing.lastSeenAt,
    };
  }
  if (incoming.health === 'healthy') {
    const { healthReason: _healthReason, unavailableUntil: _unavailableUntil, ...rest } = incoming;
    return rest;
  }
  return incoming;
}

export function createLlmRuntimeStore(homeDirOrPaths: string | { llmRuntimesPath: string }): LlmRuntimeStore {
  const filePath = resolveRuntimesPath(homeDirOrPaths);

  const store: LlmRuntimeStore = {
    async read() {
      return readJsonFile(filePath);
    },

    async write(state) {
      const normalized = normalizeLlmRuntimesState(state);
      await writeJsonFile(filePath, normalized);
      return normalized;
    },

    async upsertRuntime(runtime, options) {
      const normalized = normalizeLlmRuntime(runtime);
      if (!normalized) {
        throw new Error('Invalid LlmRuntime: missing id or provider.');
      }

      const state = await readJsonFile(filePath);
      const existingIndex = state.runtimes.findIndex((r) => r.id === normalized.id);

      if (existingIndex >= 0) {
        state.runtimes[existingIndex] = mergeRuntimeForUpsert(state.runtimes[existingIndex], normalized, options);
      } else {
        state.runtimes.push(normalized);
      }

      state.version += 1;
      await writeJsonFile(filePath, state);
      return state;
    },

    async removeRuntime(runtimeId) {
      const state = await readJsonFile(filePath);
      state.runtimes = state.runtimes.filter((r) => r.id !== runtimeId);
      state.version += 1;
      await writeJsonFile(filePath, state);
      return state;
    },

    async markSeen(runtimeId, now) {
      const state = await readJsonFile(filePath);
      const rt = state.runtimes.find((r) => r.id === runtimeId);
      if (rt) {
        rt.lastSeenAt = now;
        rt.updatedAt = now;
        state.version += 1;
      }
      await writeJsonFile(filePath, state);
      return state;
    },

    async updateHealth(runtimeId, health, options = {}) {
      const state = await readJsonFile(filePath);
      const rt = state.runtimes.find((r) => r.id === runtimeId);
      if (rt) {
        rt.health = health as LlmRuntime['health'];
        rt.healthReason = options.reason;
        rt.healthCheckedAt = options.healthCheckedAt ?? new Date().toISOString();
        rt.unavailableUntil = options.unavailableUntil;
        if (rt.health === 'healthy') {
          rt.healthReason = undefined;
          rt.unavailableUntil = undefined;
        }
        rt.updatedAt = rt.healthCheckedAt;
        state.version += 1;
      }
      await writeJsonFile(filePath, state);
      return state;
    },
  };

  return store;
}
