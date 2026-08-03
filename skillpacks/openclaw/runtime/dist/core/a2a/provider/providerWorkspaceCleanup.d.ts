export declare const PROVIDER_RUN_WORKSPACE_TTL_MS: number;
export declare const PROVIDER_RUN_WORKSPACE_SWEEP_INTERVAL_MS: number;
export declare function resolveProviderRunWorkspaceDir(projectRoot: string, attemptWorkspaceCwd: unknown): Promise<string | null>;
export declare function removeProviderRunWorkspace(projectRoot: string, attemptWorkspaceCwd: unknown): Promise<boolean>;
export declare function sweepProviderRunWorkspaces(input: {
    projectRoot: string;
    ttlMs?: number;
    nowMs?: number;
}): Promise<{
    removedRunIds: string[];
}>;
