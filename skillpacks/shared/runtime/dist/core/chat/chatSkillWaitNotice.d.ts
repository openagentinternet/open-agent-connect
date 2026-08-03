import type { LlmRuntimeResolver } from '../llm/llmRuntimeResolver';
import type { LlmExecutionRequest, LlmSessionRecord } from '../llm/executor';
import type { ChatPersona, PrivateChatConversation, PrivateChatMessage } from './privateChatTypes';
export declare const DEFAULT_CHAT_SKILL_WAIT_NOTICE = "I need a moment to check that. Please wait.";
export interface ChatSkillWaitNoticeInput {
    conversation: PrivateChatConversation;
    inboundMessage: PrivateChatMessage;
    persona: ChatPersona;
}
export type ChatSkillWaitNoticeGenerator = (input: ChatSkillWaitNoticeInput) => Promise<string>;
type ChatLlmExecutor = {
    execute(request: LlmExecutionRequest): Promise<string>;
    getSession(sessionId: string): Promise<LlmSessionRecord | null>;
};
export declare function normalizeChatSkillWaitNoticeText(value: unknown): string;
/**
 * Creates the persona-voiced "please wait" notice generator used by the chat
 * auto-reply orchestrator. Returns null when no LLM runtime is wired, which
 * disables the notice entirely. The generator itself never throws: any
 * runtime failure falls back to DEFAULT_CHAT_SKILL_WAIT_NOTICE so a skill
 * execution is always announced.
 */
export declare function createChatSkillWaitNoticeGenerator(options?: {
    runtimeResolver?: LlmRuntimeResolver;
    llmExecutor?: ChatLlmExecutor;
    metaBotSlug?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
}): ChatSkillWaitNoticeGenerator | null;
export {};
