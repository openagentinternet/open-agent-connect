import type { LlmRuntimeResolver } from '../llm/llmRuntimeResolver';
import type { LlmExecutionRequest, LlmSessionRecord } from '../llm/executor';
import type { ChatPersona, PrivateChatConversation, PrivateChatMessage } from './privateChatTypes';
/**
 * Episode rollover (IDBots a2aEpisodeRollover parity): a private-chat
 * conversation that outgrows the message budget rolls into a new "episode" —
 * an LLM-written handoff summary replaces the raw history as background, the
 * engine-side message log is pruned (the A2A store and the chain keep the
 * full thread), and the UIs show a divider. Without the summary the thread
 * would silently lose its older half to the state-store cap while the prompt
 * would keep paying for stale context.
 */
export declare const DEFAULT_EPISODE_ROLLOVER_MESSAGES = 1000;
export interface ChatEpisodeSummaryInput {
    conversation: PrivateChatConversation;
    recentMessages: PrivateChatMessage[];
    persona: ChatPersona;
}
export type ChatEpisodeSummaryGenerator = (input: ChatEpisodeSummaryInput) => Promise<string | null>;
type ChatLlmExecutor = {
    execute(request: LlmExecutionRequest): Promise<string>;
    getSession(sessionId: string): Promise<LlmSessionRecord | null>;
};
export declare function normalizeChatEpisodeSummaryText(value: unknown): string;
/**
 * Creates the episode handoff-summary generator. Returns null when no LLM
 * runtime is wired (the orchestrator then falls back to a template line).
 * Never throws: failures surface as null.
 */
export declare function createChatEpisodeSummaryGenerator(options?: {
    runtimeResolver?: LlmRuntimeResolver;
    llmExecutor?: ChatLlmExecutor;
    metaBotSlug?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
    dshLlmPath?: string;
}): ChatEpisodeSummaryGenerator | null;
export {};
