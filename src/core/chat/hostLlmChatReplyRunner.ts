import { createDefaultChatReplyRunner } from './defaultChatReplyRunner';
import type { LlmRuntimeResolver } from '../llm/llmRuntimeResolver';
import type { LlmExecutionRequest, LlmSessionRecord } from '../llm/executor';
import type {
  ChatReplyRunner,
  ChatReplyRunnerInput,
  ChatReplyRunnerResult,
} from './privateChatTypes';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const MAX_FALLBACK_ATTEMPTS = 5;
const CLOSE_CONVERSATION_SIGNAL = 'Bye';

type ChatLlmExecutor = {
  execute(request: LlmExecutionRequest): Promise<string>;
  getSession(sessionId: string): Promise<LlmSessionRecord | null>;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function findFinalNonEmptyLineIndex(lines: string[]): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim()) {
      return index;
    }
  }
  return -1;
}

function hasFinalByeLine(value: string): boolean {
  const lines = value.split(/\r?\n/u);
  const finalIndex = findFinalNonEmptyLineIndex(lines);
  return finalIndex >= 0 && lines[finalIndex].trim().toLowerCase() === CLOSE_CONVERSATION_SIGNAL.toLowerCase();
}

function canonicalizeFinalByeLine(value: string): string {
  const lines = value.split(/\r?\n/u);
  const finalIndex = findFinalNonEmptyLineIndex(lines);
  if (finalIndex >= 0 && lines[finalIndex].trim().toLowerCase() === CLOSE_CONVERSATION_SIGNAL.toLowerCase()) {
    lines[finalIndex] = CLOSE_CONVERSATION_SIGNAL;
  }
  return lines.join('\n').trim();
}

function buildChatPrompt(input: ChatReplyRunnerInput): string {
  const { conversation, recentMessages, persona, strategy } = input;
  const maxTurns = strategy?.maxTurns ?? 30;

  const sections: string[] = [];

  sections.push(
    'You are a MetaBot having a private conversation with another MetaBot through the Open Agent Connect network.'
  );

  if (persona.role) {
    sections.push(`## Your Role\n${persona.role}`);
  }

  if (persona.soul) {
    sections.push(`## Your Style\n${persona.soul}`);
  }

  if (persona.goal) {
    sections.push(`## Your Goal\n${persona.goal}`);
  }

  const strategyLines = [
    '## Conversation Strategy',
    '- This is a MetaBot-to-MetaBot network conversation.',
  ];
  if (strategy?.exitCriteria) {
    strategyLines.push(`- Conversation objective: ${strategy.exitCriteria}`);
  }
  strategyLines.push(`- Current turn: ${conversation.turnCount} / ${maxTurns}`);
  strategyLines.push('- Keep replies concise and natural, 2-4 sentences per message.');
  strategyLines.push('- Do not repeat what you have already said.');
  strategyLines.push('- Actively steer the conversation toward the objective.');
  if (conversation.turnCount > 20) {
    strategyLines.push('- This private chat has passed 20 inbound turns; converge the topic and end naturally soon.');
  }
  sections.push(strategyLines.join('\n'));

  const exitLines = [
    '## Exit Mechanism',
    `When ANY of the following conditions are met, add ${CLOSE_CONVERSATION_SIGNAL} on its own final line at the very end of your reply:`,
    '- The conversation objective has been achieved',
    '- The other party says goodbye or signals the end',
    '- There are no more valuable topics to discuss',
    `- Approaching the turn limit (currently turn ${conversation.turnCount} of ${maxTurns})`,
  ];
  sections.push(exitLines.join('\n'));

  sections.push([
    '## Format Rules',
    '- Output ONLY the reply text itself, no prefixes, labels, or markdown formatting.',
    '- Reply in the same language the other party is using.',
    `- If ending the conversation, write your farewell first, then ${CLOSE_CONVERSATION_SIGNAL} on a separate final line.`,
  ].join('\n'));

  const selfName = 'Me';
  const peerName = conversation.peerName || 'Peer';
  const historyLines = recentMessages.map(msg => {
    const name = msg.direction === 'outbound' ? selfName : peerName;
    return `${name}: ${msg.content}`;
  });

  if (historyLines.length > 0) {
    sections.push(`## Chat History\n${historyLines.join('\n')}`);
  }

  sections.push('Reply now:');

  return sections.join('\n\n');
}

function parseRunnerOutput(rawOutput: string): ChatReplyRunnerResult {
  const output = normalizeText(rawOutput);
  if (!output) {
    return { state: 'skip' };
  }

  const content = canonicalizeFinalByeLine(output);
  const hasEndMarker = hasFinalByeLine(content);

  return {
    state: hasEndMarker ? 'end_conversation' : 'reply',
    content,
  };
}

async function tryExecute(
  resolver: LlmRuntimeResolver,
  llmExecutor: ChatLlmExecutor,
  metaBotSlug: string | undefined,
  prompt: string,
  timeoutMs: number,
  pollIntervalMs: number,
  excludeRuntimeIds: Set<string>,
): Promise<{ result: ChatReplyRunnerResult; bindingId?: string } | null> {
  const resolved = await resolver.resolveRuntime({ metaBotSlug });
  if (!resolved.runtime) return null;
  if (excludeRuntimeIds.has(resolved.runtime.id)) return null;
  if (resolved.runtime.health !== 'healthy') return null;

  try {
    const sessionId = await llmExecutor.execute({
      runtimeId: resolved.runtime.id,
      runtime: resolved.runtime,
      prompt,
      timeout: timeoutMs,
      metaBotSlug,
    });

    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const session = await llmExecutor.getSession(sessionId);
      const result = session?.result;
      if (result) {
        if (result.status === 'completed') {
          return { result: parseRunnerOutput(result.output), bindingId: resolved.bindingId };
        }
        excludeRuntimeIds.add(resolved.runtime.id);
        await resolver.markRuntimeUnavailable(resolved.runtime.id).catch(() => {});
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    excludeRuntimeIds.add(resolved.runtime.id);
    await resolver.markRuntimeUnavailable(resolved.runtime.id).catch(() => {});
    return null;
  } catch {
    if (!excludeRuntimeIds.has(resolved.runtime.id)) {
      excludeRuntimeIds.add(resolved.runtime.id);
      await resolver.markRuntimeUnavailable(resolved.runtime.id).catch(() => {});
    }
    return null;
  }
}

export function createHostLlmChatReplyRunner(options?: {
  runtimeResolver?: LlmRuntimeResolver;
  llmExecutor?: ChatLlmExecutor;
  metaBotSlug?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): ChatReplyRunner {
  const runtimeResolver = options?.runtimeResolver;
  const llmExecutor = options?.llmExecutor;
  const metaBotSlug = options?.metaBotSlug;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const fallbackRunner = createDefaultChatReplyRunner();

  // If no resolver provided, fall back to template-only replies.
  if (!runtimeResolver || !llmExecutor) {
    return fallbackRunner;
  }

  return async (input: ChatReplyRunnerInput): Promise<ChatReplyRunnerResult> => {
    const prompt = buildChatPrompt(input);
    const excludeRuntimeIds = new Set<string>();

    // Try up to MAX_FALLBACK_ATTEMPTS different runtimes.
    for (let attempt = 0; attempt < MAX_FALLBACK_ATTEMPTS; attempt++) {
      const outcome = await tryExecute(runtimeResolver, llmExecutor, metaBotSlug, prompt, timeoutMs, pollIntervalMs, excludeRuntimeIds);
      if (outcome) {
        // Track lastUsedAt on the binding that was successfully used.
        if (outcome.bindingId) {
          runtimeResolver.markBindingUsed(outcome.bindingId).catch(() => { /* best effort */ });
        }
        return outcome.result;
      }
    }

    // All runtimes failed — fall back to template-only reply.
    return fallbackRunner(input);
  };
}

// Exported for testing.
export { buildChatPrompt, parseRunnerOutput };
