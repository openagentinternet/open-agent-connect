import { type RuntimeDaemonRecord } from '../core/state/runtimeStateStore';
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
export declare function collectDaemonStartupDiagnostics(input: {
    homeDir: string;
    preferredPort: number;
}): Promise<DaemonStartupDiagnosticsSnapshot>;
export declare function formatDaemonStartupTimeoutMessage(snapshot: DaemonStartupDiagnosticsSnapshot): string;
