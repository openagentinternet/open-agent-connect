import { promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveMetabotHomeSelection } from '../state/homeSelection';
import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';
import {
  createDefaultConfig,
  isAskMasterConfirmationMode,
  isAskMasterContextMode,
  isAskMasterTriggerMode,
  normalizeAskMasterAutoPolicyConfig,
  type MetabotConfig,
} from './configTypes';

async function ensureLayout(paths: MetabotPaths): Promise<void> {
  await fs.mkdir(path.dirname(paths.configPath), { recursive: true });
  try {
    await fs.access(paths.configPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
    await fs.writeFile(paths.configPath, `${JSON.stringify(createDefaultConfig(), null, 2)}\n`, 'utf8');
  }
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of value) {
    const text = normalizeString(entry);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    normalized.push(text);
  }
  return normalized;
}

function allowInternalAskMasterAutoTriggerMode(): boolean {
  return process.env.METABOT_INTERNAL_ASK_MASTER_AUTO === '1';
}

function normalizeConfig(input: unknown): MetabotConfig {
  const defaults = createDefaultConfig();
  if (!input || typeof input !== 'object') {
    return defaults;
  }

  const root = input as Record<string, unknown>;
  const maybeNetwork = root['evolution_network'];
  const maybeAskMaster = root['askMaster'];
  const maybeA2A = root['a2a'];

  const networkSource = maybeNetwork && typeof maybeNetwork === 'object'
    ? maybeNetwork as Record<string, unknown>
    : {};
  const askMasterSource = maybeAskMaster && typeof maybeAskMaster === 'object'
    ? maybeAskMaster as Record<string, unknown>
    : {};
  const a2aSource = maybeA2A && typeof maybeA2A === 'object'
    ? maybeA2A as Record<string, unknown>
    : {};

  const triggerMode = normalizeString(askMasterSource.triggerMode);
  const confirmationMode = normalizeString(askMasterSource.confirmationMode);
  const contextMode = normalizeString(askMasterSource.contextMode);

  return {
    evolution_network: {
      enabled: normalizeBoolean(networkSource.enabled, defaults.evolution_network.enabled),
      autoAdoptSameSkillSameScope: normalizeBoolean(
        networkSource.autoAdoptSameSkillSameScope,
        defaults.evolution_network.autoAdoptSameSkillSameScope
      ),
      autoRecordExecutions: normalizeBoolean(
        networkSource.autoRecordExecutions,
        defaults.evolution_network.autoRecordExecutions
      )
    },
    askMaster: {
      enabled: normalizeBoolean(askMasterSource.enabled, defaults.askMaster.enabled),
      triggerMode: triggerMode === 'auto' && !allowInternalAskMasterAutoTriggerMode()
        ? defaults.askMaster.triggerMode
        : isAskMasterTriggerMode(triggerMode)
          ? triggerMode
          : defaults.askMaster.triggerMode,
      confirmationMode: isAskMasterConfirmationMode(confirmationMode)
        ? confirmationMode
        : defaults.askMaster.confirmationMode,
      contextMode: isAskMasterContextMode(contextMode)
        ? contextMode
        : defaults.askMaster.contextMode,
      trustedMasters: normalizeStringArray(askMasterSource.trustedMasters),
      autoPolicy: normalizeAskMasterAutoPolicyConfig(askMasterSource.autoPolicy),
    },
    a2a: {
      simplemsgListenerEnabled: normalizeBoolean(
        a2aSource.simplemsgListenerEnabled,
        defaults.a2a.simplemsgListenerEnabled,
      ),
    },
  };
}

function resolvePaths(homeDirOrPaths?: string | MetabotPaths): MetabotPaths {
  if (typeof homeDirOrPaths === 'string') {
    return resolveMetabotPaths(homeDirOrPaths);
  }

  if (homeDirOrPaths) {
    return homeDirOrPaths;
  }

  const selection = resolveMetabotHomeSelection({
    env: process.env,
    cwd: process.cwd(),
  });
  return selection.paths ?? resolveMetabotPaths(selection.homeDir);
}

export interface ConfigStore {
  paths: MetabotPaths;
  ensureLayout(): Promise<MetabotPaths>;
  read(): Promise<MetabotConfig>;
  set(value: MetabotConfig): Promise<void>;
}

export function createConfigStore(homeDirOrPaths?: string | MetabotPaths): ConfigStore {
  const paths = resolvePaths(homeDirOrPaths);

  return {
    paths,
    async ensureLayout() {
      await ensureLayout(paths);
      return paths;
    },
    async read() {
      await ensureLayout(paths);
      const data = await readJsonFile(paths.configPath);
      return normalizeConfig(data);
    },
    async set(value: MetabotConfig) {
      await ensureLayout(paths);
      const normalized = normalizeConfig(value);
      await fs.writeFile(paths.configPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    }
  };
}
