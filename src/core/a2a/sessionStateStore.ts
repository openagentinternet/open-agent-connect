import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { MetabotPaths } from '../state/paths';
import { resolveMetabotPaths } from '../state/paths';
import type { A2ASessionRecord, A2ASessionRole, A2ATaskRunRecord } from './sessionTypes';
import type { PublicStatus } from './publicStatus';
import { ensureHotLayout } from '../state/runtimeStateStore';

const SESSION_STATE_FILENAME = 'a2a-session-state.json';
const SESSION_STATE_SCHEMA_VERSION = 1;
const MAX_TRANSCRIPT_ITEMS = 2_000;
const MAX_PUBLIC_STATUS_SNAPSHOTS = 1_000;
const LOCKFILE_RETRY_DELAY_MS = 20;
const LOCKFILE_MAX_ATTEMPTS = 50;

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
    if (code === 'ENOENT' || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

async function writeJsonFileAtomically(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function withLock<T>(lockPath: string, operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < LOCKFILE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      try {
        return await operation();
      } finally {
        await handle.close();
        await fs.rm(lockPath, { force: true });
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw error;
      }
      await sleep(LOCKFILE_RETRY_DELAY_MS);
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

  return {
    version: SESSION_STATE_SCHEMA_VERSION,
    sessions: Array.isArray(value.sessions) ? value.sessions : [],
    taskRuns: Array.isArray(value.taskRuns) ? value.taskRuns : [],
    transcriptItems: Array.isArray(value.transcriptItems)
      ? value.transcriptItems.slice(-MAX_TRANSCRIPT_ITEMS)
      : [],
    cursors: normalizeLoopCursors(value.cursors),
    publicStatusSnapshots: Array.isArray(value.publicStatusSnapshots)
      ? value.publicStatusSnapshots.slice(-MAX_PUBLIC_STATUS_SNAPSHOTS)
      : [],
  };
}

export function createSessionStateStore(homeDirOrPaths: string | MetabotPaths): A2ASessionStateStore {
  const paths =
    typeof homeDirOrPaths === 'string' ? resolveMetabotPaths(homeDirOrPaths) : homeDirOrPaths;
  const sessionStatePath = path.join(paths.hotRoot, SESSION_STATE_FILENAME);
  const lockPath = `${sessionStatePath}.lock`;
  let pendingWrite = Promise.resolve();

  const runExclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
    const next = pendingWrite.then(
      async () => {
        await ensureHotLayout(paths);
        return withLock(lockPath, operation);
      },
      async () => {
        await ensureHotLayout(paths);
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
      await ensureHotLayout(paths);
      return paths;
    },
    async readState() {
      await ensureHotLayout(paths);
      return normalizeState(await readJsonFile<A2ASessionStoreState>(sessionStatePath));
    },
    async writeState(nextState) {
      return runExclusive(async () => {
        await ensureHotLayout(paths);
        const normalized = normalizeState(nextState);
        await writeJsonFileAtomically(sessionStatePath, normalized);
        return normalized;
      });
    },
    async updateState(updater) {
      return runExclusive(async () => {
        await ensureHotLayout(paths);
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
      await this.updateState(state => ({
        ...state,
        transcriptItems: [
          ...state.transcriptItems,
          ...items.filter(item => !state.transcriptItems.some(existing => existing.id === item.id)),
        ].slice(-MAX_TRANSCRIPT_ITEMS),
      }));
      return items;
    },
    async appendPublicStatusSnapshots(items) {
      if (!items.length) {
        return items;
      }
      const snapshotKey = (snapshot: A2APublicStatusSnapshot): string =>
        [
          snapshot.sessionId,
          snapshot.taskRunId || '',
          snapshot.status || '',
          snapshot.rawEvent || '',
          String(snapshot.mapped),
          String(snapshot.resolvedAt),
        ].join(':');
      await this.updateState(state => ({
        ...state,
        publicStatusSnapshots: [
          ...state.publicStatusSnapshots,
          ...items.filter(snapshot => {
            const incomingKey = snapshotKey(snapshot);
            return !state.publicStatusSnapshots.some(
              existing => snapshotKey(existing) === incomingKey,
            );
          }),
        ].slice(-MAX_PUBLIC_STATUS_SNAPSHOTS),
      }));
      return items;
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
