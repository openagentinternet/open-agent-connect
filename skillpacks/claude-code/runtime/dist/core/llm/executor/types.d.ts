import type { LlmProvider, LlmRuntime } from '../llmTypes';
export type LlmExecutionStatus = 'starting' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled';
export interface LlmTokenUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
}
export interface LlmExecutionRequest {
    runtimeId: string;
    runtime: LlmRuntime;
    prompt: string;
    systemPrompt?: string;
    maxTurns?: number;
    timeout?: number;
    semanticInactivityTimeout?: number;
    cwd?: string;
    skills?: string[];
    resumeSessionId?: string;
    model?: string;
    metaBotSlug?: string;
    env?: Record<string, string>;
    extraArgs?: string[];
}
export interface LlmExecutionResult {
    status: 'completed' | 'failed' | 'timeout' | 'cancelled';
    output: string;
    error?: string;
    providerSessionId?: string;
    durationMs: number;
    usage?: Record<string, LlmTokenUsage>;
}
export type LlmExecutionEvent = {
    type: 'text';
    content: string;
} | {
    type: 'thinking';
    content: string;
} | {
    type: 'tool_use';
    tool: string;
    callId: string;
    input?: Record<string, unknown>;
} | {
    type: 'tool_result';
    tool?: string;
    callId: string;
    output: string;
} | {
    type: 'status';
    status: string;
    sessionId?: string;
} | {
    type: 'error';
    message: string;
} | {
    type: 'log';
    level: string;
    message: string;
} | {
    type: 'result';
    result: LlmExecutionResult;
};
export interface LlmEventEmitter {
    emit(event: LlmExecutionEvent): void;
}
export interface LlmSessionRecord {
    sessionId: string;
    status: LlmExecutionStatus;
    runtimeId: string;
    provider: LlmProvider;
    metaBotSlug?: string;
    prompt: string;
    systemPrompt?: string;
    skills?: string[];
    model?: string;
    cwd?: string;
    providerSessionId?: string;
    resumeSessionId?: string;
    result?: LlmExecutionResult;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
}
