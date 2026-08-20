// Per-profile memory policy store (`.runtime/memory/policy.json`) and
// effective-policy resolution. Defaults mirror IDBots
// (coworkStore.ts:80-86); the per-profile file overrides them wholesale per
// field. A missing file means "all defaults".
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { MetabotPaths } from '../state/paths';
import type { MemoryGuardLevel } from './memoryExtractor';
import { clampMemoryPromptMaxChars } from './memoryPromptBlocks';
import type { MemoryEffectivePolicy, MemoryPolicy, MemoryPolicyUpdates } from './memoryTypes';

const DEFAULT_MEMORY_ENABLED = true;
const DEFAULT_MEMORY_IMPLICIT_UPDATE_ENABLED = true;
const DEFAULT_MEMORY_LLM_JUDGE_ENABLED = true;
const DEFAULT_MEMORY_GUARD_LEVEL: MemoryGuardLevel = 'strict';
const DEFAULT_MEMORY_USER_MEMORIES_MAX_ITEMS = 20;
const MIN_MEMORY_USER_MEMORIES_MAX_ITEMS = 1;
const MAX_MEMORY_USER_MEMORIES_MAX_ITEMS = 60;

let atomicWriteSequence = 0;

export function clampMemoryUserMemoriesMaxItems(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MEMORY_USER_MEMORIES_MAX_ITEMS;
  return Math.max(
    MIN_MEMORY_USER_MEMORIES_MAX_ITEMS,
    Math.min(MAX_MEMORY_USER_MEMORIES_MAX_ITEMS, Math.floor(value))
  );
}

export function normalizeMemoryGuardLevel(value: unknown): MemoryGuardLevel {
  return value === 'strict' || value === 'standard' || value === 'relaxed'
    ? value
    : DEFAULT_MEMORY_GUARD_LEVEL;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function defaultPolicy(): Omit<MemoryPolicy, 'updatedAt'> {
  return {
    memoryEnabled: DEFAULT_MEMORY_ENABLED,
    memoryImplicitUpdateEnabled: DEFAULT_MEMORY_IMPLICIT_UPDATE_ENABLED,
    memoryLlmJudgeEnabled: DEFAULT_MEMORY_LLM_JUDGE_ENABLED,
    memoryGuardLevel: DEFAULT_MEMORY_GUARD_LEVEL,
    memoryUserMemoriesMaxItems: DEFAULT_MEMORY_USER_MEMORIES_MAX_ITEMS,
    dreamEnabled: true,
  };
}

function normalizePolicyFile(value: unknown): (Partial<MemoryPolicyUpdates> & { updatedAt?: number }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const out: Partial<MemoryPolicyUpdates> & { updatedAt?: number } = {};
  if (typeof record.memoryEnabled === 'boolean') out.memoryEnabled = record.memoryEnabled;
  if (typeof record.memoryImplicitUpdateEnabled === 'boolean') {
    out.memoryImplicitUpdateEnabled = record.memoryImplicitUpdateEnabled;
  }
  if (typeof record.memoryLlmJudgeEnabled === 'boolean') out.memoryLlmJudgeEnabled = record.memoryLlmJudgeEnabled;
  if (record.memoryGuardLevel !== undefined) out.memoryGuardLevel = normalizeMemoryGuardLevel(record.memoryGuardLevel);
  if (typeof record.memoryUserMemoriesMaxItems === 'number') {
    out.memoryUserMemoriesMaxItems = clampMemoryUserMemoriesMaxItems(record.memoryUserMemoriesMaxItems);
  }
  if (typeof record.memoryPromptMaxChars === 'number') {
    out.memoryPromptMaxChars = clampMemoryPromptMaxChars(record.memoryPromptMaxChars);
  }
  if (typeof record.dreamEnabled === 'boolean') out.dreamEnabled = record.dreamEnabled;
  if (typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)) {
    out.updatedAt = record.updatedAt;
  }
  return out;
}

export interface MemoryPolicyStore {
  /** Raw per-profile override file content (empty object when absent). */
  readOverride(): Promise<(Partial<MemoryPolicyUpdates> & { updatedAt?: number })>;
  setOverride(updates: MemoryPolicyUpdates): Promise<MemoryPolicy>;
  deleteOverride(): Promise<boolean>;
  effectivePolicy(): Promise<MemoryEffectivePolicy>;
}

export function createMemoryPolicyStore(paths: MetabotPaths): MemoryPolicyStore {
  const filePath = paths.memoryPolicyPath;

  async function readOverride(): Promise<(Partial<MemoryPolicyUpdates> & { updatedAt?: number })> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return normalizePolicyFile(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }

  async function writeOverride(override: Partial<MemoryPolicyUpdates> & { updatedAt?: number }): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    atomicWriteSequence += 1;
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${atomicWriteSequence}.tmp`;
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(override, null, 2)}\n`, 'utf8');
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  return {
    readOverride,

    async setOverride(updates) {
      const current = await readOverride();
      const next: Record<string, unknown> = { ...current };
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined) continue;
        next[key] = value;
      }
      const normalized = normalizePolicyFile(next);
      normalized.updatedAt = Date.now();
      await writeOverride(normalized);
      const defaults = defaultPolicy();
      return {
        memoryEnabled: normalizeBoolean(normalized.memoryEnabled, defaults.memoryEnabled),
        memoryImplicitUpdateEnabled: normalizeBoolean(
          normalized.memoryImplicitUpdateEnabled,
          defaults.memoryImplicitUpdateEnabled,
        ),
        memoryLlmJudgeEnabled: normalizeBoolean(normalized.memoryLlmJudgeEnabled, defaults.memoryLlmJudgeEnabled),
        memoryGuardLevel: normalizeMemoryGuardLevel(normalized.memoryGuardLevel),
        memoryUserMemoriesMaxItems: clampMemoryUserMemoriesMaxItems(
          normalized.memoryUserMemoriesMaxItems ?? Number.NaN,
        ),
        dreamEnabled: normalizeBoolean(normalized.dreamEnabled, defaults.dreamEnabled),
        updatedAt: normalized.updatedAt,
      };
    },

    async deleteOverride() {
      try {
        await fs.unlink(filePath);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    },

    async effectivePolicy() {
      const override = await readOverride();
      const defaults = defaultPolicy();
      const hasOverride = Object.keys(override).some((key) => key !== 'updatedAt');
      return {
        memoryEnabled: normalizeBoolean(override.memoryEnabled, defaults.memoryEnabled),
        memoryImplicitUpdateEnabled: normalizeBoolean(
          override.memoryImplicitUpdateEnabled,
          defaults.memoryImplicitUpdateEnabled,
        ),
        memoryLlmJudgeEnabled: normalizeBoolean(override.memoryLlmJudgeEnabled, defaults.memoryLlmJudgeEnabled),
        memoryGuardLevel: normalizeMemoryGuardLevel(override.memoryGuardLevel),
        memoryUserMemoriesMaxItems: clampMemoryUserMemoriesMaxItems(
          override.memoryUserMemoriesMaxItems ?? Number.NaN,
        ),
        memoryPromptMaxChars: clampMemoryPromptMaxChars(override.memoryPromptMaxChars ?? Number.NaN),
        dreamEnabled: normalizeBoolean(override.dreamEnabled, defaults.dreamEnabled),
        source: hasOverride ? 'profile' : 'default',
      };
    },
  };
}
