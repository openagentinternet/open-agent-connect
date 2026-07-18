import { promises as fs } from 'node:fs';
import {
  resolveMetabotDaemonPaths,
  type MetabotDaemonPaths,
} from './paths';
import type { RuntimeDaemonRecord } from './runtimeStateStore';

const TRANSIENT_JSON_READ_RETRIES = 5;
const TRANSIENT_JSON_READ_DELAY_MS = 10;

let atomicWriteSequence = 0;

export type DaemonPortSelectionOrigin = 'default' | 'fallback' | 'explicit_migration';

export interface DaemonInstallationRecord {
  schemaVersion: 1;
  host: string;
  port: number;
  selectionOrigin: DaemonPortSelectionOrigin;
  updatedAt: number;
}

export interface GlobalDaemonRecord extends RuntimeDaemonRecord {
  schemaVersion: 1;
  instanceId: string;
  oacVersion: string;
  runtimeFingerprint: string;
  supervisor: {
    kind: 'none' | 'launchagent';
    serviceId: string | null;
  };
}

export interface DaemonStateStore {
  paths: MetabotDaemonPaths;
  ensureLayout(): Promise<MetabotDaemonPaths>;
  readInstallation(): Promise<DaemonInstallationRecord | null>;
  writeInstallation(record: DaemonInstallationRecord): Promise<DaemonInstallationRecord>;
  readDaemon(): Promise<GlobalDaemonRecord | null>;
  writeDaemon(record: GlobalDaemonRecord): Promise<GlobalDaemonRecord>;
  clearDaemon(pid?: number): Promise<void>;
}

export async function ensureDaemonRuntimeLayout(paths: MetabotDaemonPaths): Promise<void> {
  await Promise.all([
    fs.mkdir(paths.runtimeRoot, { recursive: true }),
    fs.mkdir(paths.locksRoot, { recursive: true }),
    fs.mkdir(paths.logsRoot, { recursive: true }),
    fs.mkdir(paths.recoveryRoot, { recursive: true }),
  ]);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  for (let attempt = 0; attempt <= TRANSIENT_JSON_READ_RETRIES; attempt += 1) {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return null;
      }
      if (error instanceof SyntaxError && attempt < TRANSIENT_JSON_READ_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, TRANSIENT_JSON_READ_DELAY_MS));
        continue;
      }
      throw error;
    }
  }
  return null;
}

function createAtomicWriteTempPath(filePath: string): string {
  atomicWriteSequence += 1;
  return `${filePath}.${process.pid}.${Date.now()}.${atomicWriteSequence}.tmp`;
}

async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  const tempPath = createAtomicWriteTempPath(filePath);
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function createDaemonStateStore(
  systemHomeDirOrPaths: string | MetabotDaemonPaths,
): DaemonStateStore {
  const paths = typeof systemHomeDirOrPaths === 'string'
    ? resolveMetabotDaemonPaths(systemHomeDirOrPaths)
    : systemHomeDirOrPaths;

  return {
    paths,
    async ensureLayout() {
      await ensureDaemonRuntimeLayout(paths);
      return paths;
    },
    async readInstallation() {
      await ensureDaemonRuntimeLayout(paths);
      return readJsonFile<DaemonInstallationRecord>(paths.installationPath);
    },
    async writeInstallation(record) {
      await ensureDaemonRuntimeLayout(paths);
      await writeJsonFileAtomic(paths.installationPath, record);
      return record;
    },
    async readDaemon() {
      await ensureDaemonRuntimeLayout(paths);
      return readJsonFile<GlobalDaemonRecord>(paths.daemonStatePath);
    },
    async writeDaemon(record) {
      await ensureDaemonRuntimeLayout(paths);
      await writeJsonFileAtomic(paths.daemonStatePath, record);
      return record;
    },
    async clearDaemon(pid) {
      await ensureDaemonRuntimeLayout(paths);
      const current = await readJsonFile<GlobalDaemonRecord>(paths.daemonStatePath);
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
