import { type RuntimePlatformId } from '../platform/platformRegistry';
export interface ProviderProcessEnvResolution {
    env: NodeJS.ProcessEnv;
    nodePath?: string;
    error?: string;
}
export declare function resolveProviderProcessEnv(provider: RuntimePlatformId, binaryPath: string, baseEnv?: NodeJS.ProcessEnv): Promise<ProviderProcessEnvResolution>;
