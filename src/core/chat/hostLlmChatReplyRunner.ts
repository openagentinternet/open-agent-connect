import { createDefaultChatReplyRunner } from './defaultChatReplyRunner';
import { executeLlm } from '../llm/hostLlmExecutor';
import type { LlmRuntimeResolver } from '../llm/llmRuntimeResolver';
import type {
  ChatReplyRunner,
  ChatReplyRunnerInput,
  ChatReplyRunnerResult,
} from './privateChatTypes';

const DEFAULT_TIMEOUT_MS = 120_000;
const END_CONVERSATION_MARKER = '[END_CONVERSATION]';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
  sections.push(strategyLines.join('\n'));

  const exitLines = [
    '## Exit Mechanism',
    'When ANY of the following conditions are met, add [END_CONVERSATION] on a new line at the very end of your reply:',
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
    '- If ending the conversation, write your farewell first, then [END_CONVERSATION] on a separate line.',
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

  const hasEndMarker = output.includes(END_CONVERSATION_MARKER);
  const content = output.replace(END_CONVERSATION_MARKER, '').trim();

  if (!content) {
    return { state: 'end_conversation', content: 'Thank you for the conversation. See you next time!' };
  }

  return {
    state: hasEndMarker ? 'end_conversation' : 'reply',
    content,
  };
}

export function createHostLlmChatReplyRunner(options: {
  runtimeResolver: LlmRuntimeResolver;
  metaBotSlug?: string;
  timeoutMs?: number;
}): ChatReplyRunner {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fallbackRunner = createDefaultChatReplyRunner();

  return async (input: ChatReplyRunnerInput): Promise<ChatReplyRunnerResult> => {
    const runtime = await options.runtimeResolver.resolveRuntime({
      metaBotSlug: options.metaBotSlug,
    });

    if (!runtime) {
      return fallbackRunner(input);
    }

    const prompt = buildChatPrompt(input);

    try {
      const result = await executeLlm({
        runtime,
        prompt,
        timeoutMs,
      });

      // Update the lastUsedAt timestamp on the binding used.
      // We find the binding by inspecting the resolver's selectMetaBot.
      // Since resolveRuntime already found the runtime via the binding (or preferred),
      // we mark the last used timestamp via the resolver.
      try {
        const resolved = await options.runtimeResolver.resolveRuntime({
          metaBotSlug: options.metaBotSlug,
          explicitRuntimeId: runtime.id,
        });
        if (resolved && resolved.id === runtime.id) {
          // The bindingLastUsed tracking is done via resolveRuntime's side-effect.
          // We use a direct call to markBindingUsed if we can get the binding id.
          // For now, we pass: the resolver handles it internally.
        }
      } catch {
        // Best effort.
      }

      if (!result.ok) {
        return fallbackRunner(input);
      }

      return parseRunnerOutput(result.output);
    } catch {
      return fallbackRunner(input);
    }
  };
}

// Exported for testing.
export { buildChatPrompt, parseRunnerOutput };
