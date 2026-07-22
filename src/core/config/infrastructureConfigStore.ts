import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  applyBrowserSettingsUpdate,
  createDefaultBrowserConfig,
} from '@openagentinternet/agent-browser-core';

import {
  resolveMetabotDaemonPaths,
  type MetabotDaemonPaths,
} from '../state/paths';

export interface InfrastructureConfig {
  metasoP2PBaseUrl: string;
  metafileContentBaseUrl: string;
  manApiBaseUrl: string;
}

export interface InfrastructureConfigStore {
  paths: MetabotDaemonPaths;
  ensureLayout(): Promise<MetabotDaemonPaths>;
  read(): Promise<InfrastructureConfig>;
  set(value: InfrastructureConfig): Promise<void>;
}

export function createDefaultInfrastructureConfig(): InfrastructureConfig {
  const defaults = createDefaultBrowserConfig();
  return {
    metasoP2PBaseUrl: defaults.metasoP2PBaseUrl,
    metafileContentBaseUrl: defaults.metafileContentBaseUrl,
    manApiBaseUrl: defaults.manApiBaseUrl,
  };
}

function normalizeInfrastructureConfig(input: unknown): InfrastructureConfig {
  const defaults = createDefaultInfrastructureConfig();
  const browser = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const normalized = applyBrowserSettingsUpdate(
    { browser: defaults },
    {
      metasoP2PBaseUrl: browser.metasoP2PBaseUrl,
      metafileContentBaseUrl: browser.metafileContentBaseUrl,
      manApiBaseUrl: browser.manApiBaseUrl,
    },
  ).browser;

  return {
    metasoP2PBaseUrl: normalized.metasoP2PBaseUrl ?? defaults.metasoP2PBaseUrl,
    metafileContentBaseUrl: normalized.metafileContentBaseUrl ?? defaults.metafileContentBaseUrl,
    manApiBaseUrl: normalized.manApiBaseUrl ?? defaults.manApiBaseUrl,
  };
}

async function writeAtomic(filePath: string, value: InfrastructureConfig): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, filePath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

async function ensureLayout(paths: MetabotDaemonPaths): Promise<void> {
  await fs.mkdir(paths.managerRoot, { recursive: true });
  try {
    await fs.writeFile(
      paths.infrastructureConfigPath,
      `${JSON.stringify(createDefaultInfrastructureConfig(), null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}

function resolvePaths(systemHomeDirOrPaths: string | MetabotDaemonPaths): MetabotDaemonPaths {
  return typeof systemHomeDirOrPaths === 'string'
    ? resolveMetabotDaemonPaths(systemHomeDirOrPaths)
    : systemHomeDirOrPaths;
}

export function createInfrastructureConfigStore(
  systemHomeDirOrPaths: string | MetabotDaemonPaths,
): InfrastructureConfigStore {
  const paths = resolvePaths(systemHomeDirOrPaths);
  return {
    paths,
    async ensureLayout() {
      await ensureLayout(paths);
      return paths;
    },
    async read() {
      await ensureLayout(paths);
      const raw = await fs.readFile(paths.infrastructureConfigPath, 'utf8');
      return normalizeInfrastructureConfig(JSON.parse(raw));
    },
    async set(value) {
      await ensureLayout(paths);
      await writeAtomic(paths.infrastructureConfigPath, normalizeInfrastructureConfig(value));
    },
  };
}
