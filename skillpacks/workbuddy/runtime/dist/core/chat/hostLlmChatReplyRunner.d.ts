import type { LlmRuntimeResolver } from '../llm/llmRuntimeResolver';
import type { LlmExecutionRequest, LlmSessionRecord } from '../llm/executor';
import { type PrivateChatAllowedSkillScope, type PrivateChatAllowedSkillsResolver } from './privateChatAllowedSkills';
import type { ChatReplyRunner, ChatReplyRunnerInput, ChatReplyRunnerResult } from './privateChatTypes';
export declare const PRIVATE_CHAT_REPLY_GENERATION_ENV = "METABOT_PRIVATE_CHAT_REPLY_GENERATION";
declare function isPlanningPreambleLine(line: string): boolean;
declare function stripPlanningPreamble(value: string): string;
type ChatLlmExecutor = {
    execute(request: LlmExecutionRequest): Promise<string>;
    getSession(sessionId: string): Promise<LlmSessionRecord | null>;
};
export interface BuildChatPromptOptions {
    metaBotSlug?: string;
}
declare function buildChatSystemPrompt(input: ChatReplyRunnerInput): string;
declare function buildChatPrompt(input: ChatReplyRunnerInput, allowedSkillScope?: PrivateChatAllowedSkillScope, options?: BuildChatPromptOptions): string;
declare function parseRunnerOutput(rawOutput: string): ChatReplyRunnerResult;
export declare function createHostLlmChatReplyRunner(options?: {
    runtimeResolver?: LlmRuntimeResolver;
    llmExecutor?: ChatLlmExecutor;
    metaBotSlug?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
    allowedChatSkillsResolver?: PrivateChatAllowedSkillsResolver;
    logWarning?: (scope: string, message: string) => void;
    allowTemplateFallback?: boolean;
    /**
     * Fired once per turn when no runtime could even be attempted (spec R5) —
     * fire-and-forget, never awaited; the turn still falls back as before.
     */
    requestAvailabilityRecovery?: (input: {
        metaBotSlug?: string;
    }) => void;
}): ChatReplyRunner;
export { buildChatPrompt, buildChatSystemPrompt, parseRunnerOutput, stripPlanningPreamble, isPlanningPreambleLine, };
