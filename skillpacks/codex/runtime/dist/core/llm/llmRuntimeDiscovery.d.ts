import type { LlmRuntime, LlmProvider } from './llmTypes';
export interface DiscoveryInput {
    env?: NodeJS.ProcessEnv;
    createId?: () => string;
    now?: () => string;
    readinessProbe?: RuntimeReadinessProbe;
    readinessTimeoutMs?: number;
    cwd?: string;
    shellResolvedExecutables?: Record<string, string>;
}
export interface DiscoveryResult {
    runtimes: LlmRuntime[];
    errors: Array<{
        provider: string;
        message: string;
    }>;
}
export interface ExecutableVersionProbe {
    ok: boolean;
    version?: string;
    exitCode?: number | null;
    message?: string;
}
export interface RuntimeReadinessProbeResult {
    ok: boolean;
    output?: string;
    message?: string;
}
export type RuntimeReadinessProbe = (input: {
    runtime: LlmRuntime;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    cwd?: string;
}) => Promise<RuntimeReadinessProbeResult>;
export declare function findExecutableInPath(name: string, pathDirs?: string[]): Promise<string | null>;
export declare function findExecutablesInPath(name: string, pathDirs?: string[]): Promise<string[]>;
export declare function readExecutableVersion(binaryPath: string, versionArgs?: string[], timeoutMs?: number, env?: NodeJS.ProcessEnv): Promise<string | undefined>;
export declare function probeExecutableVersion(binaryPath: string, versionArgs?: string[], timeoutMs?: number, env?: NodeJS.ProcessEnv): Promise<ExecutableVersionProbe>;
export declare function discoverProvider(provider: LlmProvider, pathDirs: string[], options?: {
    createId?: () => string;
    now?: () => string;
    env?: NodeJS.ProcessEnv;
    readinessProbe?: RuntimeReadinessProbe;
    readinessTimeoutMs?: number;
    cwd?: string;
    shellResolvedExecutables?: Record<string, string>;
}): Promise<LlmRuntime | null>;
export declare function discoverLlmRuntimes(input?: DiscoveryInput): Promise<DiscoveryResult>;
