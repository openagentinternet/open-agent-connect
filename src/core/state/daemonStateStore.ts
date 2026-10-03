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

export type DaemonLifecycleEventKind = 'start' | 'stop' | 'crash' | 'respawn';

/**
 * One queryable daemon lifecycle record. `crash` marks a tracked daemon whose
 * process is gone while its state record survived (no clean shutdown ran);
 * `respawn` marks a start that replaces such a crashed daemon.
 */
export interface DaemonLifecycleEvent {
  at: number;
  event: DaemonLifecycleEventKind;
  pid: number | null;
  trigger: string | null;
  detail: string | null;
}

const DAEMON_EVENTS_MAX_BYTES = 1_000_000;
const DAEMON_EVENTS_COMPACT_KEEP_LINES = 200;

export interface DaemonStateStore {
  paths: MetabotDaemonPaths;
  ensureLayout(): Promise<MetabotDaemonPaths>;
  readInstallation(): Promise<DaemonInstallationRecord | null>;
  writeInstallation(record: DaemonInstallationRecord): Promise<DaemonInstallationRecord>;
  readDaemon(): Promise<GlobalDaemonRecord | null>;
  writeDaemon(record: GlobalDaemonRecord): Promise<GlobalDaemonRecord>;
  clearDaemon(pid?: number): Promise<void>;
  appendDaemonEvent(event: DaemonLifecycleEvent): Promise<void>;
  readDaemonEvents(limit: number): Promise<DaemonLifecycleEvent[]>;
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

function parseDaemonEventLine(raw: string): DaemonLifecycleEvent | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const event = parsed.event;
    if (typeof event !== 'string') {
      return null;
    }
    const pid = typeof parsed.pid === 'number' ? parsed.pid : null;
    return {
      at: typeof parsed.at === 'number' ? parsed.at : 0,
      event: event as DaemonLifecycleEventKind,
      pid,
      trigger: typeof parsed.trigger === 'string' ? parsed.trigger : null,
      detail: typeof parsed.detail === 'string' ? parsed.detail : null,
    };
  } catch {
    return null;
  }
}

async function readDaemonEventLines(eventsPath: string): Promise<DaemonLifecycleEvent[]> {
  let raw: string;
  try {
    raw = await fs.readFile(eventsPath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  return raw
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map(parseDaemonEventLine)
    .filter((event): event is DaemonLifecycleEvent => event !== null);
}

/** Keep the journal bounded: rewrite the tail when it outgrows the cap. */
async function compactDaemonEventsFile(eventsPath: string, events: DaemonLifecycleEvent[]): Promise<void> {
  const kept = events.slice(-DAEMON_EVENTS_COMPACT_KEEP_LINES);
  const content = kept.map((event) => JSON.stringify(event)).join('\n');
  const temporaryPath = `${eventsPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, content ? `${content}\n` : '', 'utf8');
  await fs.rename(temporaryPath, eventsPath);
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
      // No tracked record means there is nothing to remove — skipping the
      // unlink also avoids raw EPERM noise in sandboxed environments where
      // even an unlink of a missing file is denied before ENOENT.
      if (!current) {
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
    async appendDaemonEvent(event) {
      await ensureDaemonRuntimeLayout(paths);
      const existing = await readDaemonEventLines(paths.daemonEventsPath);
      const stat = await fs.stat(paths.daemonEventsPath).catch(() => null);
      if (stat && stat.size > DAEMON_EVENTS_MAX_BYTES) {
        await compactDaemonEventsFile(paths.daemonEventsPath, existing);
      }
      await fs.appendFile(paths.daemonEventsPath, `${JSON.stringify(event)}\n`, 'utf8');
    },
    async readDaemonEvents(limit) {
      const events = await readDaemonEventLines(paths.daemonEventsPath);
      return limit > 0 ? events.slice(-limit) : [];
    },
  };
}
