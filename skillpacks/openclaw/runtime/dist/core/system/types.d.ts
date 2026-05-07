export type SystemHost = 'codex' | 'claude-code' | 'openclaw';
export interface SystemUpdateInput {
    systemHomeDir: string;
    host?: SystemHost;
    version?: string;
    dryRun?: boolean;
    env: NodeJS.ProcessEnv;
}
export interface SystemUpdateResult {
    updateMode: 'npm' | 'release-pack';
    host: SystemHost | null;
    requestedVersion: string;
    resolvedVersion: string | null;
    previousVersion: string | null;
    outcome: 'updated' | 'no_update';
    downloadUrl?: string | null;
    installpackPath?: string | null;
    packageSpec?: string | null;
    dryRun: boolean;
}
export interface SystemUninstallInput {
    systemHomeDir: string;
    all: boolean;
    confirmToken?: string;
    env: NodeJS.ProcessEnv;
}
export interface SystemUninstallResult {
    tier: 'safe' | 'full_erase';
    removedHostBindings: string[];
    removedCliShim: boolean;
    daemonStopAttempted: boolean;
    daemonStopped: boolean;
    preservedSensitiveData: boolean;
}
export declare class SystemCommandError extends Error {
    code: string;
    manualActionRequired: boolean;
    constructor(code: string, message: string, manualActionRequired?: boolean);
}
export declare const SUPPORTED_SYSTEM_HOSTS: SystemHost[];
