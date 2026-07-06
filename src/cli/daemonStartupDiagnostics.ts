import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveMetabotPaths } from '../core/state/paths';
import { createRuntimeStateStore, type RuntimeDaemonRecord } from '../core/state/runtimeStateStore';

export interface DaemonLockInfo {
  ownerId?: string;
  pid?: number;
  acquiredAt?: number;
}

export interface DaemonStartupDiagnosticsSnapshot {
  homeDir: string;
  preferredPort: number;
  daemonStatePath: string;
  lockPath: string;
  daemonRecord: RuntimeDaemonRecord | null;
  lockInfo: DaemonLockInfo | null;
  lockOwnerAlive: boolean | null;
}

async function readDaemonLockInfo(lockPath: string): Promise<DaemonLockInfo | null> {
  try {
    const raw = await fs.readFile(lockPath, 'utf8');
    const parsed = JSON.parse(raw) as { ownerId?: unknown; pid?: unknown; acquiredAt?: unknown };
    return {
      ownerId: typeof parsed.ownerId === 'string' ? parsed.ownerId : undefined,
      pid: typeof parsed.pid === 'number' ? parsed.pid : undefined,
      acquiredAt: typeof parsed.acquiredAt === 'number' ? parsed.acquiredAt : undefined,
    };
  } catch {
    return null;
  }
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

function formatDaemonRecord(record: RuntimeDaemonRecord | null): string {
  if (!record) {
    return 'missing';
  }
  return `present (baseUrl=${record.baseUrl}, port=${record.port}, pid=${record.pid}, startedAt=${record.startedAt}, configHash=${record.configHash ?? 'null'})`;
}

function formatLockInfo(lockInfo: DaemonLockInfo | null, lockOwnerAlive: boolean | null): string {
  if (!lockInfo) {
    return 'missing';
  }

  const pidText = typeof lockInfo.pid === 'number' ? String(lockInfo.pid) : 'none';
  const acquiredAtText = typeof lockInfo.acquiredAt === 'number' ? String(lockInfo.acquiredAt) : 'unknown';
  const ownerAliveText = lockOwnerAlive == null ? 'unknown' : lockOwnerAlive ? 'yes' : 'no';
  return `present (ownerId=${lockInfo.ownerId ?? 'unknown'}, pid=${pidText}, acquiredAt=${acquiredAtText}, ownerAlive=${ownerAliveText})`;
}

export async function collectDaemonStartupDiagnostics(input: {
  homeDir: string;
  preferredPort: number;
}): Promise<DaemonStartupDiagnosticsSnapshot> {
  const homeDir = path.resolve(input.homeDir);
  const paths = resolveMetabotPaths(homeDir);
  const daemonRecord = await createRuntimeStateStore(paths).readDaemon();
  const lockInfo = await readDaemonLockInfo(paths.daemonLockPath);
  const lockOwnerAlive = typeof lockInfo?.pid === 'number'
    ? isProcessAlive(lockInfo.pid)
    : null;

  return {
    homeDir,
    preferredPort: input.preferredPort,
    daemonStatePath: paths.daemonStatePath,
    lockPath: paths.daemonLockPath,
    daemonRecord,
    lockInfo,
    lockOwnerAlive,
  };
}

export function formatDaemonStartupTimeoutMessage(
  snapshot: DaemonStartupDiagnosticsSnapshot,
): string {
  return [
    'Timed out while starting the local MetaBot daemon.',
    `Selected profile home: ${snapshot.homeDir}`,
    `Preferred port: ${snapshot.preferredPort}`,
    `daemon.json: ${snapshot.daemonStatePath} (${formatDaemonRecord(snapshot.daemonRecord)})`,
    `daemon.lock: ${snapshot.lockPath} (${formatLockInfo(snapshot.lockInfo, snapshot.lockOwnerAlive)})`,
  ].join('\n');
}
