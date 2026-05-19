import type { LlmRuntimeResolver } from './llmRuntimeResolver';
import type { LlmExecutionRequest, LlmExecutionResult, LlmSessionRecord } from './executor';
export interface LlmRuntimeExecutionRunner {
    execute(input: LlmExecutionRequest): Promise<string>;
    getSession(sessionId: string): Promise<LlmSessionRecord | null>;
}
export interface RunLlmPromptWithRuntimeFallbackInput {
    runtimeResolver: Pick<LlmRuntimeResolver, 'resolveRuntime' | 'markBindingUsed' | 'markRuntimeUnavailable'>;
    llmExecutor: LlmRuntimeExecutionRunner;
    metaBotSlug: string;
    prompt: string;
    systemPrompt?: string;
    timeoutMs: number;
    pollIntervalMs: number;
    cwd?: string;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}
export type LlmRuntimeFallbackResult = Pick<LlmExecutionResult, 'status' | 'output' | 'error'> & {
    sessionId?: string;
};
export declare function runLlmPromptWithRuntimeFallback(input: RunLlmPromptWithRuntimeFallbackInput): Promise<LlmRuntimeFallbackResult>;
