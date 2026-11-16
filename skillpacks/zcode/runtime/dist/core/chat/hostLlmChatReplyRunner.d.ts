import type { LlmRuntimeResolver } from '../llm/llmRuntimeResolver';
import type { LlmExecutionEvent, LlmExecutionRequest, LlmSessionRecord } from '../llm/executor';
import { type PrivateChatAllowedSkillScope, type PrivateChatAllowedSkillsResolver } from './privateChatAllowedSkills';
import type { ChatReplyRunner, ChatReplyRunnerInput, ChatReplyRunnerResult } from './privateChatTypes';
import type { HostLlmGenerateForRunner } from '../llm/hostLlmExecutorBridge';
export declare const PRIVATE_CHAT_REPLY_GENERATION_ENV = "METABOT_PRIVATE_CHAT_REPLY_GENERATION";
declare function isPlanningPreambleLine(line: string): boolean;
declare function stripPlanningPreamble(value: string): string;
type ChatLlmExecutor = {
    execute(request: LlmExecutionRequest): Promise<string>;
    getSession(sessionId: string): Promise<LlmSessionRecord | null>;
    streamEvents?(sessionId: string): AsyncIterable<LlmExecutionEvent>;
};
export interface BuildChatPromptOptions {
    metaBotSlug?: string;
}
declare function buildChatSystemPrompt(input: ChatReplyRunnerInput): string;
declare function buildChatPrompt(input: ChatReplyRunnerInput, allowedSkillScope?: PrivateChatAllowedSkillScope, options?: BuildChatPromptOptions): string;
/**
 * A guided turn (operator Steer) that echoes the operator's own text back at
 * the peer has delivered nothing: the operator's words are a briefing, never
 * a message body, and the peer must not receive them. Prompt rules alone left
 * this open (a fresh guided turn has no chat history, so the guidance text is
 * the only material the model has), so the reply is rejected here and treated
 * as a retryable empty completion instead of being sent.
 *
 * The test is containment ONE way — the reply contains the whole guidance —
 * so both leak shapes are caught (the guidance pasted as the reply, and the
 * guidance spliced into a longer reply) without rejecting a legitimate short
 * answer that merely happens to be a fragment of the briefing.
 *
 * Short guidance (under 8 comparable chars) is skipped: a note like "好的"
 * legitimately appears inside a real reply and cannot be told apart.
 */
export declare function isOperatorGuidanceEcho(content: string, operatorGuidanceText: string): boolean;
declare function parseRunnerOutput(rawOutput: string, operatorGuidanceText?: string | null): ChatReplyRunnerResult;
export declare function createHostLlmChatReplyRunner(options?: {
    runtimeResolver?: LlmRuntimeResolver;
    llmExecutor?: ChatLlmExecutor;
    metaBotSlug?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
    allowedChatSkillsResolver?: PrivateChatAllowedSkillsResolver;
    logWarning?: (scope: string, message: string) => void;
    allowTemplateFallback?: boolean | (() => Promise<boolean>);
    /**
     * Working directory for chat reply turns. Allowed chat skills run with the
     * host's normal environment (IDBots-style), so they need a stable per-profile
     * workspace instead of the daemon's process cwd: injected project-level
     * skills and any files a skill produces land here.
     */
    chatWorkspaceDir?: string;
    /**
     * Fired once per turn when no runtime could even be attempted (spec R5) —
     * fire-and-forget, never awaited; the turn still falls back as before.
     */
    requestAvailabilityRecovery?: (input: {
        metaBotSlug?: string;
    }) => void;
    /**
     * Optional generation through a connected host executor (the DSH plugin's
     * ctx.llm with the Bot's DSH LLM pair). Returns null when no host executor
     * is connected or the Bot has no DSH pair — the local-runtime chain then
     * behaves exactly as before. A host attempt is a plain completion: it never
     * executes chat skills, so turns with an allowed-skill scope keep the
     * local-runtime chain first and use the host LLM only as a fallback.
     */
    hostLlmGenerate?: HostLlmGenerateForRunner;
}): ChatReplyRunner;
export { buildChatPrompt, buildChatSystemPrompt, parseRunnerOutput, stripPlanningPreamble, isPlanningPreambleLine, };
