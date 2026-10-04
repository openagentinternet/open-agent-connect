import { type GlobalDaemonRecord } from '../core/state/daemonStateStore';
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
export declare function readDaemonLockInfo(lockPath: string): Promise<DaemonLockInfo | null>;
export declare function isProcessAlive(pid: number): boolean;
export declare function classifyDaemonRecordState(daemonRecord: GlobalDaemonRecord | null): DaemonRecordState;
export declare function collectDaemonStartupDiagnostics(input: {
    systemHomeDir: string;
    preferredPort: number;
}): Promise<DaemonStartupDiagnosticsSnapshot>;
export declare function formatDaemonStartupTimeoutMessage(snapshot: DaemonStartupDiagnosticsSnapshot, childCause?: DaemonChildStartCause): string;
export declare function formatDaemonChildStartCause(childCause: DaemonChildStartCause): string[];
export declare function isPermissionDeniedErrno(error: unknown): error is NodeJS.ErrnoException;
/**
 * EPERM/EACCES on the daemon state paths is ambiguous between a real
 * filesystem permission problem and an execution sandbox (agent-host
 * seatbelt) denying writes outside the workspace. Attach stat context for
 * the target path plus concrete next steps so the operator can tell the two
 * apart instead of chasing the wrong lead.
 */
export declare function formatPermissionDeniedStartupError(error: unknown): Promise<string>;
