import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { MetabotPaths } from '../state/paths';
import { resolveMetabotPaths } from '../state/paths';
import type { A2ASessionRecord, A2ASessionRole, A2ATaskRunRecord } from './sessionTypes';
import type { PublicStatus } from './publicStatus';
import { ensureRuntimeLayout } from '../state/runtimeStateStore';

const SESSION_STATE_SCHEMA_VERSION = 1;
const MAX_TRANSCRIPT_ITEMS = 2_000;
const MAX_PUBLIC_STATUS_SNAPSHOTS = 1_000;
const LOCKFILE_BASE_DELAY_MS = 25;
const LOCKFILE_MAX_ATTEMPTS = 200;
const LOCKFILE_STALE_WITH_PID_MS = 5 * 60 * 1000;
const LOCKFILE_STALE_WITHOUT_PID_MS = 30_000;

export type A2ATranscriptSender = 'caller' | 'provider' | 'system';
export type A2ALoopCursor = string | number | null;

export interface A2ALoopCursors {
  caller: A2ALoopCursor;
  provider: A2ALoopCursor;
}

export interface A2ATranscriptItemRecord {
  id: string;
  sessionId: string;
  taskRunId?: string | null;
  timestamp: number;
  type: string;
  sender: A2ATranscriptSender;
  content: string;
  metadata?: Record<string, unknown> | null;
}

export interface A2APublicStatusSnapshot {
  sessionId: string;
  taskRunId?: string | null;
  status: PublicStatus | null;
  mapped: boolean;
  rawEvent?: string | null;
  resolvedAt: number;
}

export interface A2ASessionStoreState {
  version: number;
  sessions: A2ASessionRecord[];
  taskRuns: A2ATaskRunRecord[];
  transcriptItems: A2ATranscriptItemRecord[];
  cursors: A2ALoopCursors;
  publicStatusSnapshots: A2APublicStatusSnapshot[];
}

export interface A2ASessionStateStore {
  paths: MetabotPaths;
  sessionStatePath: string;
  ensureLayout(): Promise<MetabotPaths>;
  readState(): Promise<A2ASessionStoreState>;
  writeState(nextState: A2ASessionStoreState): Promise<A2ASessionStoreState>;
  updateState(
    updater: (currentState: A2ASessionStoreState) => A2ASessionStoreState | Promise<A2ASessionStoreState>
  ): Promise<A2ASessionStoreState>;
  writeSession(record: A2ASessionRecord): Promise<A2ASessionRecord>;
  writeTaskRun(record: A2ATaskRunRecord): Promise<A2ATaskRunRecord>;
  appendTranscriptItems(items: A2ATranscriptItemRecord[]): Promise<A2ATranscriptItemRecord[]>;
  appendPublicStatusSnapshots(
    items: A2APublicStatusSnapshot[]
  ): Promise<A2APublicStatusSnapshot[]>;
  setLoopCursor(role: A2ASessionRole, cursor: A2ALoopCursor): Promise<A2ALoopCursor>;
  readLoopCursor(role: A2ASessionRole): Promise<A2ALoopCursor>;
}

function cloneEmptyState(): A2ASessionStoreState {
  return {
    version: SESSION_STATE_SCHEMA_VERSION,
    sessions: [],
    taskRuns: [],
    transcriptItems: [],
    cursors: {
      caller: null,
      provider: null,
    },
    publicStatusSnapshots: [],
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
    if (error instanceof SyntaxError) {
      const corruptPath = `${filePath}.corrupt-${Date.now()}`;
      try {
        await fs.rename(filePath, corruptPath);
      } catch {
        // Best effort quarantine so malformed runtime state does not brick future reads.
      }
      return null;
    }
    throw error;
  }
}

async function readLockInfo(filePath: string): Promise<{ pid?: number; acquiredAt?: number } | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as { pid?: unknown; acquiredAt?: unknown };
    return {
      pid: typeof parsed.pid === 'number' ? parsed.pid : undefined,
      acquiredAt: typeof parsed.acquiredAt === 'number' ? parsed.acquiredAt : undefined,
    };
  } catch {
    return null;
  }
}

async function writeJsonFileAtomically(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(tempPath, 'w');
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tempPath, filePath);
    try {
      const directoryHandle = await fs.open(path.dirname(filePath), 'r');
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EINVAL' && code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EBADF') {
        throw error;
      }
    }
  } catch (error) {
    if (handle) {
      await handle.close();
    }
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== 'ESRCH';
  }
}

async function withLock<T>(lockPath: string, operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < LOCKFILE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      try {
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: Date.now() })}\n`, 'utf8');
        return await operation();
      } finally {
        await handle.close();
        try {
          await fs.rm(lockPath, { force: true });
        } catch {
          // Best effort cleanup; stale lock recovery handles leftover lock files later.
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw error;
      }
      try {
        const lockInfo = await readLockInfo(lockPath);
        const stat = await fs.stat(lockPath);
        const lockPid = typeof lockInfo?.pid === 'number' ? lockInfo.pid : null;
        const acquiredAt =
          typeof lockInfo?.acquiredAt === 'number' ? lockInfo.acquiredAt : stat.mtimeMs;
        const ownerAlive = lockPid ? isProcessAlive(lockPid) : false;
        if (lockPid && !ownerAlive) {
          await fs.rm(lockPath, { force: true });
          continue;
        }
        const staleThreshold = lockPid ? LOCKFILE_STALE_WITH_PID_MS : LOCKFILE_STALE_WITHOUT_PID_MS;
        const stale = Date.now() - acquiredAt > staleThreshold;
        if (!lockPid && stale) {
          await fs.rm(lockPath, { force: true });
          continue;
        }
      } catch {
        // Another writer may have released the lock between stat/remove attempts.
      }
      await sleep(Math.min(LOCKFILE_BASE_DELAY_MS * (attempt + 1), 250));
    }
  }

  throw new Error(`Timed out acquiring session-state lock: ${lockPath}`);
}

function normalizeLoopCursors(raw: Partial<A2ALoopCursors> | null | undefined): A2ALoopCursors {
  const normalizeCursor = (value: unknown): A2ALoopCursor => {
    if (typeof value === 'string' || typeof value === 'number') {
      return value;
    }
    return null;
  };

  return {
    caller: normalizeCursor(raw?.caller),
    provider: normalizeCursor(raw?.provider),
  };
}

function normalizeState(value: A2ASessionStoreState | null): A2ASessionStoreState {
  if (!value || typeof value !== 'object') {
    return cloneEmptyState();
  }

  const source = value as unknown as Record<string, unknown>;

  return {
    ...source,
    version: typeof source.version === 'number' ? source.version : SESSION_STATE_SCHEMA_VERSION,
    sessions: Array.isArray(source.sessions) ? source.sessions : [],
    taskRuns: Array.isArray(source.taskRuns) ? source.taskRuns : [],
    transcriptItems: Array.isArray(source.transcriptItems)
      ? source.transcriptItems.slice(-MAX_TRANSCRIPT_ITEMS)
      : [],
    cursors: normalizeLoopCursors(source.cursors as Partial<A2ALoopCursors> | null | undefined),
    publicStatusSnapshots: Array.isArray(source.publicStatusSnapshots)
      ? source.publicStatusSnapshots.slice(-MAX_PUBLIC_STATUS_SNAPSHOTS)
      : [],
  } as A2ASessionStoreState;
}

export function createSessionStateStore(homeDirOrPaths: string | MetabotPaths): A2ASessionStateStore {
  const paths =
    typeof homeDirOrPaths === 'string' ? resolveMetabotPaths(homeDirOrPaths) : homeDirOrPaths;
  const sessionStatePath = paths.sessionStatePath;
  const lockPath = `${sessionStatePath}.lock`;
  let pendingWrite = Promise.resolve();

  const runExclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
    const next = pendingWrite.then(
      async () => {
        await ensureRuntimeLayout(paths);
        return withLock(lockPath, operation);
      },
      async () => {
        await ensureRuntimeLayout(paths);
        return withLock(lockPath, operation);
      },
    );
    pendingWrite = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  return {
    paths,
    sessionStatePath,
    async ensureLayout() {
      await ensureRuntimeLayout(paths);
      return paths;
    },
    async readState() {
      await ensureRuntimeLayout(paths);
      return normalizeState(await readJsonFile<A2ASessionStoreState>(sessionStatePath));
    },
    async writeState(nextState) {
      return runExclusive(async () => {
        await ensureRuntimeLayout(paths);
        const normalized = normalizeState(nextState);
        await writeJsonFileAtomically(sessionStatePath, normalized);
        return normalized;
      });
    },
    async updateState(updater) {
      return runExclusive(async () => {
        await ensureRuntimeLayout(paths);
        const current = normalizeState(await readJsonFile<A2ASessionStoreState>(sessionStatePath));
        const nextState = await updater(current);
        const normalized = normalizeState(nextState);
        await writeJsonFileAtomically(sessionStatePath, normalized);
        return normalized;
      });
    },
    async writeSession(record) {
      await this.updateState(state => ({
        ...state,
        sessions: [...state.sessions.filter(session => session.sessionId !== record.sessionId), record],
      }));
      return record;
    },
    async writeTaskRun(record) {
      await this.updateState(state => ({
        ...state,
        taskRuns: [...state.taskRuns.filter(run => run.runId !== record.runId), record],
      }));
      return record;
    },
    async appendTranscriptItems(items) {
      if (!items.length) {
        return items;
      }
      let persistedItems: A2ATranscriptItemRecord[] = [];
      await this.updateState(state => ({
        ...state,
        transcriptItems: (() => {
          const seenIds = new Set(state.transcriptItems.map(item => item.id));
          const nextItems: A2ATranscriptItemRecord[] = [];
          for (const item of items) {
            if (seenIds.has(item.id)) {
              continue;
            }
            seenIds.add(item.id);
            nextItems.push(item);
          }
          const nextStateItems = [...state.transcriptItems, ...nextItems].slice(-MAX_TRANSCRIPT_ITEMS);
          const persistedIds = new Set(nextStateItems.map(item => item.id));
          persistedItems = nextItems.filter(item => persistedIds.has(item.id));
          return nextStateItems;
        })(),
      }));
      return persistedItems;
    },
    async appendPublicStatusSnapshots(items) {
      if (!items.length) {
        return items;
      }
      let persistedSnapshots: A2APublicStatusSnapshot[] = [];
      const snapshotKey = (snapshot: A2APublicStatusSnapshot): string =>
        JSON.stringify([
          snapshot.sessionId,
          snapshot.taskRunId || '',
          snapshot.status || '',
          snapshot.rawEvent || '',
          String(snapshot.mapped),
          String(snapshot.resolvedAt),
        ]);
      await this.updateState(state => ({
        ...state,
        publicStatusSnapshots: (() => {
          const seenKeys = new Set(state.publicStatusSnapshots.map(snapshotKey));
          const nextSnapshots: A2APublicStatusSnapshot[] = [];
          for (const snapshot of items) {
            const incomingKey = snapshotKey(snapshot);
            if (seenKeys.has(incomingKey)) {
              continue;
            }
            seenKeys.add(incomingKey);
            nextSnapshots.push(snapshot);
          }
          const nextStateSnapshots = [...state.publicStatusSnapshots, ...nextSnapshots]
            .slice(-MAX_PUBLIC_STATUS_SNAPSHOTS);
          const persistedKeys = new Set(nextStateSnapshots.map(snapshotKey));
          persistedSnapshots = nextSnapshots.filter(
            snapshot => persistedKeys.has(snapshotKey(snapshot)),
          );
          return nextStateSnapshots;
        })(),
      }));
      return persistedSnapshots;
    },
    async setLoopCursor(role, cursor) {
      await this.updateState(state => ({
        ...state,
        cursors: {
          ...state.cursors,
          [role]: cursor,
        },
      }));
      return cursor;
    },
    async readLoopCursor(role) {
      const state = await this.readState();
      return state.cursors[role];
    },
  };
}
