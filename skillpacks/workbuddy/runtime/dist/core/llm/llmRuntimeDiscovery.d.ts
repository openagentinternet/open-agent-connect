import type { LlmRuntime, LlmProvider } from './llmTypes';
export interface DiscoveryInput {
    env?: NodeJS.ProcessEnv;
    providers?: LlmProvider[];
    createId?: () => string;
    now?: () => string;
    readinessProbe?: RuntimeReadinessProbe;
    readinessTimeoutMs?: number;
    providerConcurrency?: number;
    knownRuntimes?: LlmRuntime[];
    recentHealthyReadinessSkipMs?: number;
    cwd?: string;
    shellResolvedExecutables?: Record<string, string>;
    onRuntimeDiscovered?: (runtime: LlmRuntime) => void | Promise<void>;
    /** Presence-scan mode: stop after the version probe and report each found binary as `detected` without running readiness probes. */
    skipReadinessProbe?: boolean;
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
export declare function readinessSemanticInactivityTimeoutForProvider(provider: LlmProvider, readinessTimeoutMs: number): number;
export declare function discoverProvider(provider: LlmProvider, pathDirs: string[], options?: {
    createId?: () => string;
    now?: () => string;
    env?: NodeJS.ProcessEnv;
    readinessProbe?: RuntimeReadinessProbe;
    readinessTimeoutMs?: number;
    knownRuntimesById?: ReadonlyMap<string, LlmRuntime>;
    recentHealthyReadinessSkipMs?: number;
    cwd?: string;
    shellResolvedExecutables?: Record<string, string>;
    skipReadinessProbe?: boolean;
}): Promise<LlmRuntime | null>;
export declare function testLlmRuntimeReadiness(runtime: LlmRuntime, options?: {
    env?: NodeJS.ProcessEnv;
    readinessProbe?: RuntimeReadinessProbe;
    readinessTimeoutMs?: number;
    cwd?: string;
    now?: () => string;
}): Promise<LlmRuntime>;
export declare function discoverLlmRuntimes(input?: DiscoveryInput): Promise<DiscoveryResult>;
