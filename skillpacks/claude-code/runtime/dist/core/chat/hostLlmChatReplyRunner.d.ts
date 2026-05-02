import type { LlmRuntimeResolver } from '../llm/llmRuntimeResolver';
import type { ChatReplyRunner, ChatReplyRunnerInput, ChatReplyRunnerResult } from './privateChatTypes';
declare function buildChatPrompt(input: ChatReplyRunnerInput): string;
declare function parseRunnerOutput(rawOutput: string): ChatReplyRunnerResult;
export declare function createHostLlmChatReplyRunner(options?: {
    runtimeResolver?: LlmRuntimeResolver;
    metaBotSlug?: string;
    timeoutMs?: number;
}): ChatReplyRunner;
export { buildChatPrompt, parseRunnerOutput };
