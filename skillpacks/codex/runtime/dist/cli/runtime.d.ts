import type { CliDependencies, CliRuntimeContext } from './types';
export declare function getDefaultDaemonPort(homeDir?: string): number;
export declare function getDaemonRuntimeFingerprint(rootDir?: string): string;
export declare function buildDaemonConfigHash(env: NodeJS.ProcessEnv, options?: {
    runtimeFingerprint?: string;
}): string;
export declare function createDefaultCliDependencies(context: CliRuntimeContext): CliDependencies;
export declare function mergeCliDependencies(context: CliRuntimeContext): CliDependencies;
export declare function serveCliDaemonProcess(context: Pick<CliRuntimeContext, 'env' | 'cwd'>): Promise<never>;
