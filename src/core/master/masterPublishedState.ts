import { promises as fs } from 'node:fs';
import { ensureHotLayout } from '../state/runtimeStateStore';
import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';
import type { PublishedMasterRecord } from './masterTypes';

export interface PublishedMasterState {
  masters: PublishedMasterRecord[];
}

export interface PublishedMasterStateStore {
  paths: MetabotPaths;
  statePath: string;
  read(): Promise<PublishedMasterState>;
  write(nextState: PublishedMasterState): Promise<PublishedMasterState>;
  update(
    updater: (currentState: PublishedMasterState) => PublishedMasterState | Promise<PublishedMasterState>
  ): Promise<PublishedMasterState>;
}

function createEmptyState(): PublishedMasterState {
  return {
    masters: [],
  };
}

function normalizePublishedMasterState(value: PublishedMasterState | null): PublishedMasterState {
  if (!value || typeof value !== 'object') {
    return createEmptyState();
  }

  return {
    masters: Array.isArray(value.masters) ? value.masters : [],
  };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function createPublishedMasterStateStore(homeDirOrPaths: string | MetabotPaths): PublishedMasterStateStore {
  const paths = typeof homeDirOrPaths === 'string' ? resolveMetabotPaths(homeDirOrPaths) : homeDirOrPaths;
  const statePath = paths.masterPublishedStatePath;

  return {
    paths,
    statePath,
    async read() {
      await ensureHotLayout(paths);
      return normalizePublishedMasterState(await readJsonFile<PublishedMasterState>(statePath));
    },
    async write(nextState) {
      await ensureHotLayout(paths);
      const normalized = normalizePublishedMasterState(nextState);
      await fs.writeFile(statePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
      return normalized;
    },
    async update(updater) {
      const currentState = await this.read();
      const nextState = await updater(currentState);
      return this.write(nextState);
    },
  };
}
