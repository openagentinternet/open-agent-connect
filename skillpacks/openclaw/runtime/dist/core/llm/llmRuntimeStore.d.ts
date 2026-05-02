import type { LlmRuntime, LlmRuntimesState } from './llmTypes';
export interface LlmRuntimeStore {
    read(): Promise<LlmRuntimesState>;
    write(state: LlmRuntimesState): Promise<LlmRuntimesState>;
    upsertRuntime(runtime: LlmRuntime): Promise<LlmRuntimesState>;
    removeRuntime(runtimeId: string): Promise<LlmRuntimesState>;
    markSeen(runtimeId: string, now: string): Promise<LlmRuntimesState>;
    updateHealth(runtimeId: string, health: string): Promise<LlmRuntimesState>;
}
export declare function createLlmRuntimeStore(homeDirOrPaths: string | {
    llmRuntimesPath: string;
}): LlmRuntimeStore;
