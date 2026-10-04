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
export declare function ensureDaemonRuntimeLayout(paths: MetabotDaemonPaths): Promise<void>;
export declare function createDaemonStateStore(systemHomeDirOrPaths: string | MetabotDaemonPaths): DaemonStateStore;
