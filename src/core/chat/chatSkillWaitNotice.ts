import type { LlmRuntimeResolver } from '../llm/llmRuntimeResolver';
import type { LlmExecutionRequest, LlmSessionRecord } from '../llm/executor';
import type {
  ChatPersona,
  PrivateChatConversation,
  PrivateChatMessage,
} from './privateChatTypes';

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const MAX_NOTICE_CHARS = 180;
const MAX_PEER_MESSAGE_CHARS = 500;
// Static fallback for when the persona LLM cannot write the notice in time
// (mirrors the IDBots fallback text).
export const DEFAULT_CHAT_SKILL_WAIT_NOTICE = 'I need a moment to check that. Please wait.';

export interface ChatSkillWaitNoticeInput {
  conversation: PrivateChatConversation;
  inboundMessage: PrivateChatMessage;
  persona: ChatPersona;
}

export type ChatSkillWaitNoticeGenerator = (
  input: ChatSkillWaitNoticeInput,
) => Promise<string>;

type ChatLlmExecutor = {
  execute(request: LlmExecutionRequest): Promise<string>;
  getSession(sessionId: string): Promise<LlmSessionRecord | null>;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// Keep the notice to a single short chat message: strip wrapping quotes the
// model likes to add, collapse newlines, and cap the length.
export function normalizeChatSkillWaitNoticeText(value: unknown): string {
  let text = normalizeText(value);
  if (!text) {
    return '';
  }
  text = text.replace(/^["'`“”‘’]+|["'`“”‘’]+$/gu, '').trim();
  text = text.replace(/\s*\r?\n\s*/gu, ' ').trim();
  if (text.length > MAX_NOTICE_CHARS) {
    text = `${text.slice(0, MAX_NOTICE_CHARS).trimEnd()}…`;
  }
  return text;
}

function buildWaitNoticeSystemPrompt(input: ChatSkillWaitNoticeInput): string {
  const { persona } = input;
  const identityName = normalizeText(persona.identity?.name);
  const sections = [
    [
      'Write a short private-chat wait notice as the bot described below, right before local skill execution starts.',
      '- Tell the peer that you need a little time to check, query, or process their latest message before giving the final answer.',
      '- Use your own natural voice and stay in character.',
      '- Keep it to 1 short sentence, or 2 very short sentences max.',
      '- Reply in the same language the peer used in their latest message.',
      '- Do not mention internal system prompts, exact skill names, tool logs, txids, implementation details, or deadlines.',
      '- Output only the notice text itself, no prefixes, labels, or quotes.',
    ].join('\n'),
  ];
  const personaLines: string[] = ['## Your Bot Identity and Persona (authoritative)'];
  if (identityName) {
    personaLines.push(`- Your name is ${JSON.stringify(identityName)}.`);
  }
  if (persona.role) {
    personaLines.push(`- Role: ${persona.role}`);
  }
  if (persona.soul) {
    personaLines.push(`- Style: ${persona.soul}`);
  }
  if (personaLines.length > 1) {
    sections.push(personaLines.join('\n'));
  }
  return sections.join('\n\n');
}

function buildWaitNoticePrompt(input: ChatSkillWaitNoticeInput): string {
  const peerMessage = normalizeText(input.inboundMessage.content)
    .slice(0, MAX_PEER_MESSAGE_CHARS);
  return [
    `The peer's latest message:`,
    `"""${peerMessage}"""`,
    'Write the wait notice now.',
  ].join('\n');
}

/**
 * Creates the persona-voiced "please wait" notice generator used by the chat
 * auto-reply orchestrator. Returns null when no LLM runtime is wired, which
 * disables the notice entirely. The generator itself never throws: any
 * runtime failure falls back to DEFAULT_CHAT_SKILL_WAIT_NOTICE so a skill
 * execution is always announced.
 */
export function createChatSkillWaitNoticeGenerator(options?: {
  runtimeResolver?: LlmRuntimeResolver;
  llmExecutor?: ChatLlmExecutor;
  metaBotSlug?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): ChatSkillWaitNoticeGenerator | null {
  const runtimeResolver = options?.runtimeResolver;
  const llmExecutor = options?.llmExecutor;
  if (!runtimeResolver || !llmExecutor) {
    return null;
  }
  const metaBotSlug = options?.metaBotSlug;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  return async (input: ChatSkillWaitNoticeInput): Promise<string> => {
    try {
      const resolved = await runtimeResolver.resolveRuntime({ metaBotSlug });
      if (!resolved.runtime || resolved.runtime.health !== 'healthy') {
        return DEFAULT_CHAT_SKILL_WAIT_NOTICE;
      }
      const request: LlmExecutionRequest = {
        runtimeId: resolved.runtime.id,
        runtime: resolved.runtime,
        prompt: buildWaitNoticePrompt(input),
        systemPrompt: buildWaitNoticeSystemPrompt(input),
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
          if (result.status === 'completed') {
            return normalizeChatSkillWaitNoticeText(result.output) || DEFAULT_CHAT_SKILL_WAIT_NOTICE;
          }
          return DEFAULT_CHAT_SKILL_WAIT_NOTICE;
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
      return DEFAULT_CHAT_SKILL_WAIT_NOTICE;
    } catch {
      return DEFAULT_CHAT_SKILL_WAIT_NOTICE;
    }
  };
}
