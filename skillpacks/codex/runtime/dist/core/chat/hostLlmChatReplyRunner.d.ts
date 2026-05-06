import type { LlmRuntimeResolver } from '../llm/llmRuntimeResolver';
import type { LlmExecutionRequest, LlmSessionRecord } from '../llm/executor';
import type { ChatReplyRunner, ChatReplyRunnerInput, ChatReplyRunnerResult } from './privateChatTypes';
type ChatLlmExecutor = {
    execute(request: LlmExecutionRequest): Promise<string>;
    getSession(sessionId: string): Promise<LlmSessionRecord | null>;
};
declare function buildChatPrompt(input: ChatReplyRunnerInput): string;
declare function parseRunnerOutput(rawOutput: string): ChatReplyRunnerResult;
export declare function createHostLlmChatReplyRunner(options?: {
    runtimeResolver?: LlmRuntimeResolver;
    llmExecutor?: ChatLlmExecutor;
    metaBotSlug?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
}): ChatReplyRunner;
export { buildChatPrompt, parseRunnerOutput };
