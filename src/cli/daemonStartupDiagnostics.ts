import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveMetabotDaemonPaths } from '../core/state/paths';
import { createDaemonStateStore, type GlobalDaemonRecord } from '../core/state/daemonStateStore';

export interface DaemonLockInfo {
  ownerId?: string;
  pid?: number;
  acquiredAt?: number;
}

/**
 * Liveness classification of the tracked daemon record: `missing` means no
 * record, `stale` means a record whose pid is no longer running (the daemon
 * died without a clean shutdown), `alive` means the recorded pid is running.
 */
export type DaemonRecordState = 'missing' | 'stale' | 'alive';

/** Why the detached daemon child never became reachable (best-effort). */
export interface DaemonChildStartCause {
  spawnError?: string | null;
  exitCode?: number | null;
  signal?: string | null;
}

export interface DaemonStartupDiagnosticsSnapshot {
  systemHomeDir: string;
  preferredPort: number;
  daemonStatePath: string;
  lockPath: string;
  startupLogPath: string;
  daemonRecord: GlobalDaemonRecord | null;
  daemonRecordState: DaemonRecordState;
  lockInfo: DaemonLockInfo | null;
  lockOwnerAlive: boolean | null;
}

export async function readDaemonLockInfo(lockPath: string): Promise<DaemonLockInfo | null> {
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

export function isProcessAlive(pid: number): boolean {
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

export function classifyDaemonRecordState(
  daemonRecord: GlobalDaemonRecord | null,
): DaemonRecordState {
  if (!daemonRecord || typeof daemonRecord.pid !== 'number') {
    return 'missing';
  }
  return isProcessAlive(daemonRecord.pid) ? 'alive' : 'stale';
}

function formatDaemonRecord(record: GlobalDaemonRecord | null): string {
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
  systemHomeDir: string;
  preferredPort: number;
}): Promise<DaemonStartupDiagnosticsSnapshot> {
  const systemHomeDir = path.resolve(input.systemHomeDir);
  const paths = resolveMetabotDaemonPaths(systemHomeDir);
  const daemonRecord = await createDaemonStateStore(paths).readDaemon();
  const lockInfo = await readDaemonLockInfo(paths.daemonLockPath);
  const lockOwnerAlive = typeof lockInfo?.pid === 'number'
    ? isProcessAlive(lockInfo.pid)
    : null;

  return {
    systemHomeDir,
    preferredPort: input.preferredPort,
    daemonStatePath: paths.daemonStatePath,
    lockPath: paths.daemonLockPath,
    startupLogPath: paths.daemonLogPath,
    daemonRecord,
    daemonRecordState: classifyDaemonRecordState(daemonRecord),
    lockInfo,
    lockOwnerAlive,
  };
}

export function formatDaemonStartupTimeoutMessage(
  snapshot: DaemonStartupDiagnosticsSnapshot,
  childCause: DaemonChildStartCause = {},
): string {
  const lines = [
    'Timed out while starting the local MetaBot daemon.',
    'The timeout is the symptom, not the cause — the daemon process output and any spawn failure are written to the startup log below.',
    `System home: ${snapshot.systemHomeDir}`,
    `Preferred port: ${snapshot.preferredPort}`,
    `daemon.json: ${snapshot.daemonStatePath} (${formatDaemonRecord(snapshot.daemonRecord)})`,
    `daemon.json state: ${snapshot.daemonRecordState}${snapshot.daemonRecordState === 'stale' ? ' — a leftover daemon.json from a daemon that died without cleanup' : ''}`,
    `daemon.lock: ${snapshot.lockPath} (${formatLockInfo(snapshot.lockInfo, snapshot.lockOwnerAlive)})`,
  ];
  const childCauseLines = formatDaemonChildStartCause(childCause);
  if (childCauseLines.length > 0) {
    lines.push(...childCauseLines);
  }
  lines.push(`Startup log (real cause): ${snapshot.startupLogPath}`);
  return lines.join('\n');
}

export function formatDaemonChildStartCause(childCause: DaemonChildStartCause): string[] {
  const lines: string[] = [];
  if (childCause.spawnError) {
    lines.push(`Daemon spawn failed: ${childCause.spawnError}`);
  }
  if (childCause.exitCode != null) {
    lines.push(`Daemon process exited before becoming reachable (exit code ${childCause.exitCode}).`);
  }
  if (childCause.signal) {
    lines.push(`Daemon process was terminated before becoming reachable (signal ${childCause.signal}).`);
  }
  return lines;
}

export function isPermissionDeniedErrno(error: unknown): error is NodeJS.ErrnoException {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'EPERM' || code === 'EACCES' || code === 'EROFS';
}

/**
 * EPERM/EACCES on the daemon state paths is ambiguous between a real
 * filesystem permission problem and an execution sandbox (agent-host
 * seatbelt) denying writes outside the workspace. Attach stat context for
 * the target path plus concrete next steps so the operator can tell the two
 * apart instead of chasing the wrong lead.
 */
export async function formatPermissionDeniedStartupError(error: unknown): Promise<string> {
  if (!isPermissionDeniedErrno(error)) {
    throw error;
  }
  const errnoError = error;
  const targetPath = errnoError.path ?? '<unknown path>';
  const statLines: string[] = [];
  try {
    const stat = await fs.stat(targetPath);
    statLines.push(
      `stat ${targetPath}: exists, ${(stat.uid !== undefined) ? `owner uid=${stat.uid} gid=${stat.gid}` : 'owner unknown'}, mode=${(stat.mode & 0o777).toString(8)}`,
    );
  } catch (statError) {
    const statCode = (statError as NodeJS.ErrnoException).code;
    statLines.push(`stat ${targetPath}: ${statCode === 'ENOENT' ? 'does not exist' : `unavailable (${statCode ?? 'unknown error'})`}`);
  }
  return [
    `Failed to prepare the local MetaBot daemon runtime: ${errnoError.code}: ${errnoError.message}`,
    ...statLines,
    'This is either a real permission problem or an execution sandbox denying writes to the MetaBot home directory (common for agent hosts).',
    'Next steps:',
    `  1. Inspect the path: ls -le ${path.dirname(targetPath)}`,
    '  2. If you run inside a sandboxed agent host, grant write access to ~/.metabot (or run the command outside the sandbox).',
    '  3. If permissions are truly wrong, fix ownership (chown) or permissions (chmod) for the path above.',
  ].join('\n');
}
