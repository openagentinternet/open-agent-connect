// Memory hygiene run ledger (`.runtime/memory/hygiene.json`). One file per
// profile holding the single latest run record plus the deep-consolidation
// cadence stamp — the file-port counterpart of IDBots' cowork_config rows
// (memoryHygieneLastRun / memoryHygieneDeepConsolidation). One bot per
// profile, so the deep-consolidation stamp is a single timestamp, not a
// per-bot map. Writes follow the store conventions: atomic write-then-rename,
// serialized through the per-store write queue.
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { MetabotPaths } from '../state/paths';
import type { HygieneRunStats } from './memoryHygienePolicy';

export interface HygieneLedger {
  version: 1;
  lastRun: HygieneRunStats | null;
  /** ISO 8601 of the last clean deep-consolidation apply. */
  deepConsolidationLastRunAt: string | null;
}

let atomicWriteSequence = 0;

function normalizeRunStats(value: unknown): HygieneRunStats | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.dateKey !== 'string' || !record.dateKey) return null;
  if (typeof record.ranAt !== 'number' || !Number.isFinite(record.ranAt)) return null;
  const counts: Record<string, number> = {};
  if (record.counts && typeof record.counts === 'object' && !Array.isArray(record.counts)) {
    for (const [key, count] of Object.entries(record.counts as Record<string, unknown>)) {
      if (typeof count === 'number' && Number.isFinite(count)) counts[key] = count;
    }
  }
  return {
    dateKey: record.dateKey,
    ranAt: record.ranAt,
    trigger: record.trigger === 'manual' ? 'manual' : 'scheduled',
    counts,
    errors: Array.isArray(record.errors)
      ? record.errors.filter((error): error is string => typeof error === 'string')
      : [],
  };
}

function normalizeLedger(value: unknown): HygieneLedger {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { version: 1, lastRun: null, deepConsolidationLastRunAt: null };
  }
  const record = value as Record<string, unknown>;
  const deepConsolidationLastRunAt = typeof record.deepConsolidationLastRunAt === 'string'
    && Number.isFinite(Date.parse(record.deepConsolidationLastRunAt))
    ? record.deepConsolidationLastRunAt
    : null;
  return {
    version: 1,
    lastRun: normalizeRunStats(record.lastRun),
    deepConsolidationLastRunAt,
  };
}

export interface HygieneStore {
  getLedger(): Promise<HygieneLedger>;
  getLastRun(): Promise<HygieneRunStats | null>;
  setLastRun(stats: HygieneRunStats): Promise<void>;
  getDeepConsolidationLastRunAt(): Promise<number | null>;
  setDeepConsolidationLastRunAt(ranAtMs: number): Promise<void>;
}

export function createHygieneStore(paths: MetabotPaths): HygieneStore {
  const filePath = paths.memoryHygienePath;
  let writeQueue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = writeQueue.then(task, task);
    writeQueue = run.catch(() => undefined);
    return run;
  }

  async function readFile(): Promise<HygieneLedger> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return normalizeLedger(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: 1, lastRun: null, deepConsolidationLastRunAt: null };
      }
      throw error;
    }
  }

  async function writeFile(next: HygieneLedger): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    atomicWriteSequence += 1;
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${atomicWriteSequence}.tmp`;
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  return {
    async getLedger() {
      return readFile();
    },

    async getLastRun() {
      return (await readFile()).lastRun;
    },

    async setLastRun(stats) {
      await enqueue(async () => {
        const file = await readFile();
        file.lastRun = stats;
        await writeFile(file);
      });
    },

    async getDeepConsolidationLastRunAt() {
      const stamp = (await readFile()).deepConsolidationLastRunAt;
      return stamp ? Date.parse(stamp) : null;
    },

    async setDeepConsolidationLastRunAt(ranAtMs) {
      await enqueue(async () => {
        const file = await readFile();
        file.deepConsolidationLastRunAt = new Date(ranAtMs).toISOString();
        await writeFile(file);
      });
    },
  };
}
