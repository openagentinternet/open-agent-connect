/**
 * Per-bot MetaWeb surf settings, ported from IDBots surfSettings.ts onto the
 * file layout: `.runtime/surf/settings.json` (storage layout v2 amendment
 * 2026-09-15). Read helpers centralize the defaults so a bot that never
 * touched the settings gets the product defaults (surf-before-dream OFF —
 * opt-in, interaction budget 20).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { MetabotPaths } from '../state/paths.js';

export const DEFAULT_SURF_INTERACTION_BUDGET = 20;
export const MAX_SURF_INTERACTION_BUDGET = 100;

export interface MetawebSurfSettings {
  /**
   * Default OFF (opt-in): only an explicit true enables pre-dream surfing.
   * Every nightly surf spends LLM tokens and gas, so a bot that never
   * touched the toggle stays off (owner decision, IDBots 2026-09-14).
   */
  surfBeforeDreamEnabled: boolean;
  /** Chain-writing interactions allowed per surf run. */
  interactionBudget: number;
}

interface SurfSettingsFile {
  version: number;
  surfBeforeDreamEnabled: boolean;
  interactionBudget: number;
}

const SETTINGS_FILE_VERSION = 1;

export const normalizeSurfBudgetValue = (value: unknown): number | null => {
  const num = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isFinite(num)) return null;
  const int = Math.round(num);
  if (int < 0 || int > MAX_SURF_INTERACTION_BUDGET) return null;
  return int;
};

export const defaultSurfSettings = (): MetawebSurfSettings => ({
  surfBeforeDreamEnabled: false,
  interactionBudget: DEFAULT_SURF_INTERACTION_BUDGET,
});

export interface MetawebSurfSettingsStore {
  read(): Promise<MetawebSurfSettings>;
  /** Partial update; returns the merged settings actually persisted. */
  update(patch: Partial<Omit<MetawebSurfSettings, 'interactionBudget'>> & {
    interactionBudget?: unknown;
  }): Promise<MetawebSurfSettings>;
}

async function readSettingsFile(filePath: string): Promise<SurfSettingsFile | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const budget = normalizeSurfBudgetValue(record.interactionBudget);
    return {
      version: SETTINGS_FILE_VERSION,
      surfBeforeDreamEnabled: record.surfBeforeDreamEnabled === true,
      interactionBudget: budget === null ? DEFAULT_SURF_INTERACTION_BUDGET : budget,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeSettingsAtomic(filePath: string, file: SurfSettingsFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Create the per-bot surf settings store bound to `paths.surfSettingsPath`. */
export function createSurfSettingsStore(paths: MetabotPaths): MetawebSurfSettingsStore {
  const filePath = paths.surfSettingsPath;
  let writeQueue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = writeQueue.then(task, task);
    writeQueue = run.catch(() => undefined);
    return run;
  }

  return {
    async read() {
      const file = await readSettingsFile(filePath);
      if (!file) return defaultSurfSettings();
      return {
        surfBeforeDreamEnabled: file.surfBeforeDreamEnabled,
        interactionBudget: file.interactionBudget,
      };
    },

    async update(patch) {
      return enqueue(async () => {
        const file = (await readSettingsFile(filePath)) ?? {
          version: SETTINGS_FILE_VERSION,
          surfBeforeDreamEnabled: false,
          interactionBudget: DEFAULT_SURF_INTERACTION_BUDGET,
        };
        if (patch.surfBeforeDreamEnabled !== undefined) {
          file.surfBeforeDreamEnabled = patch.surfBeforeDreamEnabled === true;
        }
        if (patch.interactionBudget !== undefined) {
          const budget = normalizeSurfBudgetValue(patch.interactionBudget);
          if (budget === null) {
            throw new Error(
              `interactionBudget must be an integer between 0 and ${MAX_SURF_INTERACTION_BUDGET}.`,
            );
          }
          file.interactionBudget = budget;
        }
        await writeSettingsAtomic(filePath, file);
        return {
          surfBeforeDreamEnabled: file.surfBeforeDreamEnabled,
          interactionBudget: file.interactionBudget,
        };
      });
    },
  };
}
