import type { LlmRuntime, LlmRuntimesState } from './llmTypes';
export interface LlmRuntimeStore {
    read(): Promise<LlmRuntimesState>;
    write(state: LlmRuntimesState): Promise<LlmRuntimesState>;
    upsertRuntime(runtime: LlmRuntime, options?: UpsertRuntimeOptions): Promise<LlmRuntimesState>;
    removeRuntime(runtimeId: string): Promise<LlmRuntimesState>;
    markSeen(runtimeId: string, now: string): Promise<LlmRuntimesState>;
    updateHealth(runtimeId: string, health: string, options?: {
        reason?: string;
        healthCheckedAt?: string;
        unavailableUntil?: string;
    }): Promise<LlmRuntimesState>;
}
export interface UpsertRuntimeOptions {
    preserveRecentHealthyOnDetected?: boolean;
    preserveRecentHealthyWindowMs?: number;
}
export declare function createLlmRuntimeStore(homeDirOrPaths: string | {
    llmRuntimesPath: string;
}): LlmRuntimeStore;
