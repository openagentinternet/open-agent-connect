import type { LlmRuntimeResolver } from '../llm/llmRuntimeResolver';
import { createHostFirstCompletion } from '../llm/hostLlmExecutorBridge';
import type { LlmExecutionRequest, LlmSessionRecord } from '../llm/executor';
import type {
  ChatPersona,
  PrivateChatConversation,
  PrivateChatMessage,
} from './privateChatTypes';

/**
 * Episode rollover (IDBots a2aEpisodeRollover parity): a private-chat
 * conversation that outgrows the message budget rolls into a new "episode" —
 * an LLM-written handoff summary replaces the raw history as background, the
 * engine-side message log is pruned (the A2A store and the chain keep the
 * full thread), and the UIs show a divider. Without the summary the thread
 * would silently lose its older half to the state-store cap while the prompt
 * would keep paying for stale context.
 */

export const DEFAULT_EPISODE_ROLLOVER_MESSAGES = 1000;

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const MAX_SUMMARY_CHARS = 1200;
const MAX_HISTORY_CHARS = 6_000;

export interface ChatEpisodeSummaryInput {
  conversation: PrivateChatConversation;
  recentMessages: PrivateChatMessage[];
  persona: ChatPersona;
}

export type ChatEpisodeSummaryGenerator = (
  input: ChatEpisodeSummaryInput,
) => Promise<string | null>;

type ChatLlmExecutor = {
  execute(request: LlmExecutionRequest): Promise<string>;
  getSession(sessionId: string): Promise<LlmSessionRecord | null>;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeChatEpisodeSummaryText(value: unknown): string {
  let text = normalizeText(value);
  if (!text) {
    return '';
  }
  text = text.replace(/^["'`“”‘’]+|["'`“”‘’]+$/gu, '').trim();
  if (text.length > MAX_SUMMARY_CHARS) {
    text = `${text.slice(0, MAX_SUMMARY_CHARS).trimEnd()}…`;
  }
  return text;
}

function buildEpisodeSummarySystemPrompt(): string {
  return [
    'Write a handoff summary of a finished private-chat episode, as read by the same bot when it starts the next episode with the same peer.',
    '- Capture the episode\'s main topics and outcomes in 3-6 sentences.',
    '- Explicitly list anything still owed or promised (deferred answers, pending results, agreed next steps).',
    '- Note how to address the peer and any standing preferences the peer expressed.',
    '- Do not include txids, raw tool logs, or internal system details.',
    '- Output only the summary text itself, no prefixes, labels, or quotes.',
  ].join('\n');
}

function buildEpisodeSummaryPrompt(input: ChatEpisodeSummaryInput): string {
  const peerName = normalizeText(input.conversation.peerName) || 'the peer';
  const transcript = input.recentMessages
    .map((message) => `${message.direction === 'inbound' ? peerName : 'Me'}: ${normalizeText(message.content)}`)
    .join('\n')
    .slice(-MAX_HISTORY_CHARS);
  return [
    `The finished episode with ${peerName} (transcript tail):`,
    `"""${transcript}"""`,
    'Write the handoff summary now.',
  ].join('\n');
}

/**
 * Creates the episode handoff-summary generator. Returns null when no LLM
 * runtime is wired (the orchestrator then falls back to a template line).
 * Never throws: failures surface as null.
 */
export function createChatEpisodeSummaryGenerator(options?: {
  runtimeResolver?: LlmRuntimeResolver;
  llmExecutor?: ChatLlmExecutor;
  metaBotSlug?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  dshLlmPath?: string;
}): ChatEpisodeSummaryGenerator | null {
  const runtimeResolver = options?.runtimeResolver;
  const llmExecutor = options?.llmExecutor;
  if (!runtimeResolver || !llmExecutor) {
    return null;
  }
  const hostComplete = options?.dshLlmPath
    ? createHostFirstCompletion({ dshLlmPath: options.dshLlmPath, timeoutMs: options?.timeoutMs })
    : null;
  const metaBotSlug = options?.metaBotSlug;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const completeViaRuntime = async (input: ChatEpisodeSummaryInput): Promise<string | null> => {
    const resolved = await runtimeResolver.resolveRuntime({ metaBotSlug });
    if (!resolved.runtime || resolved.runtime.health !== 'healthy') {
      return null;
    }
    const request: LlmExecutionRequest = {
      runtimeId: resolved.runtime.id,
      runtime: resolved.runtime,
      prompt: buildEpisodeSummaryPrompt(input),
      systemPrompt: buildEpisodeSummarySystemPrompt(),
      timeout: timeoutMs,
      metaBotSlug,
      outputMode: 'final',
    };
    const sessionId = await llmExecutor.execute(request);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const session = await llmExecutor.getSession(sessionId);
      const result = session?.result;
      if (result) {
        return result.status === 'completed'
          ? normalizeChatEpisodeSummaryText(result.output)
          : null;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    return null;
  };

  return async (input: ChatEpisodeSummaryInput): Promise<string | null> => {
    try {
      if (hostComplete) {
        const hostText = await hostComplete({
          ...(metaBotSlug ? { botSlug: metaBotSlug } : {}),
          system: buildEpisodeSummarySystemPrompt(),
          user: buildEpisodeSummaryPrompt(input),
        });
        if (hostText !== null) {
          return normalizeChatEpisodeSummaryText(hostText);
        }
      }
      return await completeViaRuntime(input);
    } catch {
      return null;
    }
  };
}
