/**
 * App Session persistence. Sessions, task-level grants, internal cursors and
 * leases are written atomically to a single JSON file under the profile
 * runtime root; leases carry `expiresAt` so fencing survives daemon restarts.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  type AppSessionGrant,
  type AppSessionLease,
  type AppSessionPersistedState,
  type AppSessionRecord,
} from './types';

const STORE_VERSION = 1;
const TRANSIENT_READ_RETRIES = 5;
const TRANSIENT_READ_DELAY_MS = 10;

let atomicWriteSequence = 0;

export interface AppSessionStore {
  load(): Promise<AppSessionPersistedState | null>;
  save(state: AppSessionPersistedState): Promise<void>;
}

export interface AppSessionStateSnapshot {
  sessions: AppSessionRecord[];
  grants: AppSessionGrant[];
  leases: AppSessionLease[];
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  for (let attempt = 0; attempt <= TRANSIENT_READ_RETRIES; attempt += 1) {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return null;
      }
      if (error instanceof SyntaxError && attempt < TRANSIENT_READ_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, TRANSIENT_READ_DELAY_MS));
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

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = createAtomicWriteTempPath(filePath);
  try {
    await fs.writeFile(tempPath, content, 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function normalizePersistedAppSessionState(
  raw: AppSessionPersistedState | null,
): AppSessionPersistedState {
  if (!raw || raw.version !== STORE_VERSION) {
    return { version: STORE_VERSION, sessions: [], grants: [], leases: [] };
  }
  return {
    version: STORE_VERSION,
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    grants: Array.isArray(raw.grants) ? raw.grants : [],
    leases: Array.isArray(raw.leases) ? raw.leases : [],
  };
}

export function createAppSessionStore(runtimeRoot: string): AppSessionStore {
  const storeDir = path.join(path.resolve(runtimeRoot), 'app-session');
  const storePath = path.join(storeDir, 'runtime.json');

  return {
    async load() {
      const raw = await readJsonFile<AppSessionPersistedState>(storePath);
      return normalizePersistedAppSessionState(raw);
    },
    async save(state) {
      await fs.mkdir(storeDir, { recursive: true });
      await writeFileAtomic(storePath, `${JSON.stringify(normalizePersistedAppSessionState(state), null, 2)}\n`);
    },
  };
}
