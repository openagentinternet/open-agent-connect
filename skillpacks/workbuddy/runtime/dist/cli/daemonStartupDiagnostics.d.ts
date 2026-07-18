import { type GlobalDaemonRecord } from '../core/state/daemonStateStore';
export interface DaemonLockInfo {
    ownerId?: string;
    pid?: number;
    acquiredAt?: number;
}
export interface DaemonStartupDiagnosticsSnapshot {
    systemHomeDir: string;
    preferredPort: number;
    daemonStatePath: string;
    lockPath: string;
    daemonRecord: GlobalDaemonRecord | null;
    lockInfo: DaemonLockInfo | null;
    lockOwnerAlive: boolean | null;
}
export declare function collectDaemonStartupDiagnostics(input: {
    systemHomeDir: string;
    preferredPort: number;
}): Promise<DaemonStartupDiagnosticsSnapshot>;
export declare function formatDaemonStartupTimeoutMessage(snapshot: DaemonStartupDiagnosticsSnapshot): string;
