import { promises as fs } from 'node:fs';
import type { PublishedServiceRecord } from '../services/publishService';
import type { SessionTraceRecord } from '../chat/sessionTrace';
import { resolveMetabotPaths, type MetabotPaths } from './paths';

export type RuntimeIdentitySubsidyState = 'pending' | 'claimed' | 'failed';
export type RuntimeIdentitySyncState = 'pending' | 'synced' | 'partial' | 'failed';

export interface RuntimeIdentityRecord {
  metabotId: number;
  name: string;
  createdAt: number;
  path: string;
  publicKey: string;
  chatPublicKey: string;
  /** Chain addresses keyed by network name. E.g. { mvc: "1...", btc: "1...", doge: "D..." } */
  addresses: Record<string, string>;
  /** Convenience: same as addresses['mvc']. Preserved for backward compatibility. */
  mvcAddress: string;
  metaId: string;
  globalMetaId: string;
  subsidyState?: RuntimeIdentitySubsidyState;
  subsidyError?: string | null;
  syncState?: RuntimeIdentitySyncState;
  syncError?: string | null;
  namePinId?: string | null;
  chatPublicKeyPinId?: string | null;
}

export interface RuntimeDaemonRecord {
  ownerId: string;
  pid: number;
  host: string;
  port: number;
  baseUrl: string;
  startedAt: number;
  configHash?: string | null;
}

export interface RuntimeState {
  identity: RuntimeIdentityRecord | null;
  services: PublishedServiceRecord[];
  traces: SessionTraceRecord[];
}

export interface RuntimeStateStore {
  paths: MetabotPaths;
  ensureLayout(): Promise<MetabotPaths>;
  readState(): Promise<RuntimeState>;
  writeState(nextState: RuntimeState): Promise<RuntimeState>;
  updateState(
    updater: (currentState: RuntimeState) => RuntimeState | Promise<RuntimeState>
  ): Promise<RuntimeState>;
  readDaemon(): Promise<RuntimeDaemonRecord | null>;
  writeDaemon(record: RuntimeDaemonRecord): Promise<RuntimeDaemonRecord>;
  clearDaemon(pid?: number): Promise<void>;
}

function cloneEmptyState(): RuntimeState {
  return {
    identity: null,
    services: [],
    traces: [],
  };
}

export async function ensureRuntimeLayout(paths: MetabotPaths): Promise<void> {
  await Promise.all([
    fs.mkdir(paths.runtimeRoot, { recursive: true }),
    fs.mkdir(paths.a2aRoot, { recursive: true }),
    fs.mkdir(paths.stateRoot, { recursive: true }),
    fs.mkdir(paths.sessionsRoot, { recursive: true }),
    fs.mkdir(paths.exportsRoot, { recursive: true }),
    fs.mkdir(paths.locksRoot, { recursive: true }),
  ]);
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

interface LegacyIdentityRecord {
  mvcAddress?: string;
  btcAddress?: string;
  dogeAddress?: string;
  [key: string]: unknown;
}

function normalizeRuntimeIdentity(identity: Record<string, unknown> | null): RuntimeIdentityRecord | null {
  if (!identity || typeof identity !== 'object') return null;

  const legacy = identity as LegacyIdentityRecord;

  // Build addresses map from legacy flat fields if missing
  if (!identity['addresses'] || typeof identity['addresses'] !== 'object') {
    const addresses: Record<string, string> = {};
    const mvcAddr = typeof identity['mvcAddress'] === 'string' ? identity['mvcAddress'] : undefined;
    const btcAddr = typeof legacy.btcAddress === 'string' ? legacy.btcAddress : undefined;
    const dogeAddr = typeof legacy.dogeAddress === 'string' ? legacy.dogeAddress : undefined;
    if (mvcAddr) addresses.mvc = mvcAddr;
    if (btcAddr) addresses.btc = btcAddr;
    if (dogeAddr) addresses.doge = dogeAddr;
    identity = { ...identity, addresses };
  }

  return {
    metabotId: typeof identity['metabotId'] === 'number' ? identity['metabotId'] : 0,
    name: typeof identity['name'] === 'string' ? identity['name'] : '',
    createdAt: typeof identity['createdAt'] === 'number' ? identity['createdAt'] : 0,
    path: typeof identity['path'] === 'string' ? identity['path'] : '',
    publicKey: typeof identity['publicKey'] === 'string' ? identity['publicKey'] : '',
    chatPublicKey: typeof identity['chatPublicKey'] === 'string' ? identity['chatPublicKey'] : '',
    addresses: (identity['addresses'] as Record<string, string>) ?? {},
    mvcAddress: typeof identity['mvcAddress'] === 'string' ? identity['mvcAddress'] : '',
    metaId: typeof identity['metaId'] === 'string' ? identity['metaId'] : '',
    globalMetaId: typeof identity['globalMetaId'] === 'string' ? identity['globalMetaId'] : '',
    subsidyState: identity['subsidyState'] as RuntimeIdentitySubsidyState | undefined,
    subsidyError: typeof identity['subsidyError'] === 'string' ? identity['subsidyError'] : null,
    syncState: identity['syncState'] as RuntimeIdentitySyncState | undefined,
    syncError: typeof identity['syncError'] === 'string' ? identity['syncError'] : null,
    namePinId: typeof identity['namePinId'] === 'string' ? identity['namePinId'] : null,
    chatPublicKeyPinId: typeof identity['chatPublicKeyPinId'] === 'string' ? identity['chatPublicKeyPinId'] : null,
  };
}

function normalizeRuntimeState(value: RuntimeState | null): RuntimeState {
  if (!value || typeof value !== 'object') {
    return cloneEmptyState();
  }

  return {
    identity: normalizeRuntimeIdentity(value.identity as Record<string, unknown> | null),
    services: Array.isArray(value.services) ? value.services : [],
    traces: Array.isArray(value.traces) ? value.traces : [],
  };
}

export function createRuntimeStateStore(homeDirOrPaths: string | MetabotPaths): RuntimeStateStore {
  const paths = typeof homeDirOrPaths === 'string' ? resolveMetabotPaths(homeDirOrPaths) : homeDirOrPaths;

  return {
    paths,
    async ensureLayout() {
      await ensureRuntimeLayout(paths);
      return paths;
    },
    async readState() {
      await ensureRuntimeLayout(paths);
      return normalizeRuntimeState(await readJsonFile<RuntimeState>(paths.runtimeStatePath));
    },
    async writeState(nextState) {
      await ensureRuntimeLayout(paths);
      const normalized = normalizeRuntimeState(nextState);
      await fs.writeFile(paths.runtimeStatePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
      return normalized;
    },
    async updateState(updater) {
      const currentState = await this.readState();
      const nextState = await updater(currentState);
      return this.writeState(nextState);
    },
    async readDaemon() {
      await ensureRuntimeLayout(paths);
      return readJsonFile<RuntimeDaemonRecord>(paths.daemonStatePath);
    },
    async writeDaemon(record) {
      await ensureRuntimeLayout(paths);
      await fs.writeFile(paths.daemonStatePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
      return record;
    },
    async clearDaemon(pid) {
      await ensureRuntimeLayout(paths);
      const current = await readJsonFile<RuntimeDaemonRecord>(paths.daemonStatePath);
      if (pid && current && current.pid !== pid) {
        return;
      }
      try {
        await fs.rm(paths.daemonStatePath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          throw error;
        }
      }
    },
  };
}
