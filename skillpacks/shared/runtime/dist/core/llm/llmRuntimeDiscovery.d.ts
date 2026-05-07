import type { LlmRuntime, LlmProvider } from './llmTypes';
export interface DiscoveryInput {
    env?: NodeJS.ProcessEnv;
    createId?: () => string;
    now?: () => string;
}
export interface DiscoveryResult {
    runtimes: LlmRuntime[];
    errors: Array<{
        provider: string;
        message: string;
    }>;
}
export declare function findExecutableInPath(name: string, pathDirs?: string[]): Promise<string | null>;
export declare function readExecutableVersion(binaryPath: string, versionArgs?: string[], timeoutMs?: number, env?: NodeJS.ProcessEnv): Promise<string | undefined>;
export declare function discoverProvider(provider: LlmProvider, pathDirs: string[], options?: {
    createId?: () => string;
    now?: () => string;
    env?: NodeJS.ProcessEnv;
}): Promise<LlmRuntime | null>;
export declare function discoverLlmRuntimes(input?: DiscoveryInput): Promise<DiscoveryResult>;
