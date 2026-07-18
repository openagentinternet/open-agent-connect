import { type MetabotDaemonPaths } from './paths';
import type { RuntimeDaemonRecord } from './runtimeStateStore';
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
export declare function ensureDaemonRuntimeLayout(paths: MetabotDaemonPaths): Promise<void>;
export declare function createDaemonStateStore(systemHomeDirOrPaths: string | MetabotDaemonPaths): DaemonStateStore;
