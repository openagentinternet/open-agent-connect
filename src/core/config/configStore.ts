import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';
import { createDefaultConfig, type MetabotConfig } from './configTypes';

async function ensureLayout(paths: MetabotPaths): Promise<void> {
  await fs.mkdir(path.dirname(paths.configPath), { recursive: true });
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

function normalizeConfig(input: unknown): MetabotConfig {
  const defaults = createDefaultConfig();
  if (!input || typeof input !== 'object') {
    return defaults;
  }

  const maybeNetwork = (input as Record<string, unknown>)['evolution_network'];
  if (!maybeNetwork || typeof maybeNetwork !== 'object') {
    return defaults;
  }

  const source = maybeNetwork as Record<string, unknown>;
  return {
    evolution_network: {
      enabled: normalizeBoolean(source.enabled, defaults.evolution_network.enabled),
      autoAdoptSameSkillSameScope: normalizeBoolean(
        source.autoAdoptSameSkillSameScope,
        defaults.evolution_network.autoAdoptSameSkillSameScope
      ),
      autoRecordExecutions: normalizeBoolean(
        source.autoRecordExecutions,
        defaults.evolution_network.autoRecordExecutions
      )
    }
  };
}

function cloneConfig(config: MetabotConfig): MetabotConfig {
  return {
    evolution_network: {
      enabled: config.evolution_network.enabled,
      autoAdoptSameSkillSameScope: config.evolution_network.autoAdoptSameSkillSameScope,
      autoRecordExecutions: config.evolution_network.autoRecordExecutions
    }
  };
}

function resolvePaths(homeDirOrPaths?: string | MetabotPaths): MetabotPaths {
  if (typeof homeDirOrPaths === 'string') {
    return resolveMetabotPaths(homeDirOrPaths);
  }

  if (homeDirOrPaths) {
    return homeDirOrPaths;
  }

  const homeDir = process.env.METABOT_HOME ?? os.homedir();
  return resolveMetabotPaths(homeDir);
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
      const normalized = cloneConfig(value);
      await fs.writeFile(paths.configPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    }
  };
}
