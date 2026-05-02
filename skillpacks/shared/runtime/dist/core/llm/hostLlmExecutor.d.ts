import type { LlmRuntime } from './llmTypes';
export interface LlmExecuteInput {
    runtime: LlmRuntime;
    prompt: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
}
export interface LlmExecuteResult {
    ok: boolean;
    output: string;
    exitCode: number;
}
export declare function executeLlm(input: LlmExecuteInput): Promise<LlmExecuteResult>;
