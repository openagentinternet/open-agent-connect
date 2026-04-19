import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ensureHotLayout } from '../state/runtimeStateStore';
import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';

export interface ProviderPresenceState {
  enabled: boolean;
  lastHeartbeatAt: number | null;
  lastHeartbeatPinId: string | null;
  lastHeartbeatTxid: string | null;
}

export interface ProviderPresenceStateStore {
  paths: MetabotPaths;
  read(): Promise<ProviderPresenceState>;
  write(nextState: ProviderPresenceState): Promise<ProviderPresenceState>;
  update(
    updater: (
      currentState: ProviderPresenceState
    ) => ProviderPresenceState | Promise<ProviderPresenceState>
  ): Promise<ProviderPresenceState>;
}

let atomicWriteSequence = 0;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function createEmptyPresenceState(): ProviderPresenceState {
  return {
    enabled: false,
    lastHeartbeatAt: null,
    lastHeartbeatPinId: null,
    lastHeartbeatTxid: null,
  };
}

function normalizeProviderPresenceState(value: ProviderPresenceState | null | undefined): ProviderPresenceState {
  if (!value || typeof value !== 'object') {
    return createEmptyPresenceState();
  }

  return {
    enabled: value.enabled === true,
    lastHeartbeatAt: normalizeNumber(value.lastHeartbeatAt),
    lastHeartbeatPinId: normalizeText(value.lastHeartbeatPinId) || null,
    lastHeartbeatTxid: normalizeText(value.lastHeartbeatTxid) || null,
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

function nextAtomicWriteSuffix(): string {
  atomicWriteSequence += 1;
  return `${process.pid}.${Date.now()}.${atomicWriteSequence}`;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${nextAtomicWriteSuffix()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

export function createProviderPresenceStateStore(homeDirOrPaths: string | MetabotPaths): ProviderPresenceStateStore {
  const paths = typeof homeDirOrPaths === 'string' ? resolveMetabotPaths(homeDirOrPaths) : homeDirOrPaths;

  return {
    paths,
    async read() {
      await ensureHotLayout(paths);
      const current = await readJsonFile<ProviderPresenceState>(paths.providerPresenceStatePath);
      return normalizeProviderPresenceState(current);
    },
    async write(nextState) {
      await ensureHotLayout(paths);
      const normalized = normalizeProviderPresenceState(nextState);
      await writeJsonAtomic(paths.providerPresenceStatePath, normalized);
      return normalized;
    },
    async update(updater) {
      const current = await this.read();
      const next = await updater(current);
      return this.write(next);
    },
  };
}
