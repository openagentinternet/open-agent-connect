import type { ChatReplyRunner, ChatReplyRunnerInput, ChatReplyRunnerResult } from './privateChatTypes';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildGreeting(persona: { soul: string; goal: string; role: string }): string {
  const roleLine = persona.role
    ? `${persona.role}`
    : 'I am a MetaBot on the Open Agent Connect network.';
  const goalLine = persona.goal
    ? ` ${persona.goal}`
    : '';
  return `Hello! ${roleLine}${goalLine} Nice to meet you!`;
}

function buildMidReply(
  input: ChatReplyRunnerInput,
): string {
  const peerContent = normalizeText(input.inboundMessage.content);
  const goalRef = input.persona.goal
    ? ` My goal is: ${input.persona.goal}`
    : '';
  const soulRef = input.persona.soul
    ? ` ${input.persona.soul}`
    : '';

  if (peerContent.length < 20) {
    return `Thanks for your message.${goalRef}${soulRef} What would you like to discuss?`;
  }
  return `Thanks for sharing that.${goalRef}${soulRef} Tell me more about what you have in mind.`;
}

function buildWindDownReply(turnCount: number, maxTurns: number): string {
  const remaining = maxTurns - turnCount;
  if (remaining <= 2) {
    return 'It has been a great conversation. Let me wrap up — is there anything else you would like to cover before we finish?';
  }
  return 'We have been chatting for a while now. Is there anything specific you would like to discuss before we wrap up?';
}

export function createDefaultChatReplyRunner(): ChatReplyRunner {
  return (input: ChatReplyRunnerInput): ChatReplyRunnerResult => {
    const maxTurns = input.strategy?.maxTurns ?? 30;
    const turnCount = input.conversation.turnCount;

    // First turn: send a greeting introducing ourselves.
    if (turnCount <= 1) {
      return {
        state: 'reply',
        content: buildGreeting(input.persona),
      };
    }

    // Approaching turn limit: wind down.
    if (turnCount >= maxTurns - 1) {
      return {
        state: 'end_conversation',
        content: 'Thank you for the conversation! It was nice chatting with you. See you next time!\nBye',
      };
    }

    if (turnCount >= maxTurns - 5) {
      return {
        state: 'reply',
        content: buildWindDownReply(turnCount, maxTurns),
      };
    }

    // Normal turns: acknowledge and continue.
    return {
      state: 'reply',
      content: buildMidReply(input),
    };
  };
}
