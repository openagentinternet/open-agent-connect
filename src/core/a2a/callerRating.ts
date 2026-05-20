import { extractOrderRawRequest } from '../orders/orderMessage';
import type {
  ChatPersona,
  ChatReplyRunner,
  PrivateChatConversation,
  PrivateChatMessage,
} from '../chat/privateChatTypes';
import type { BuyerRatingProtocolTextGeneratorInput } from './orderProtocolTextGenerator';

export interface BuyerRatingTranscriptItem {
  id?: string | null;
  timestamp?: number | null;
  type?: string | null;
  sender?: 'caller' | 'provider' | 'system' | string | null;
  content?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface BuyerServiceRatingResult {
  rate: number;
  comment: string;
}

export type BuyerServiceRatingTextGenerator = (
  input: Omit<BuyerRatingProtocolTextGeneratorInput, 'paths'>
) => Promise<string | null | undefined>;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.trunc(value);
  return normalized >= 1_000_000_000 && normalized < 1_000_000_000_000
    ? normalized * 1000
    : normalized;
}

function truncateForPrompt(value: string, maxChars: number): string {
  const text = normalizeText(value);
  if (text.length <= maxChars) {
    return text;
  }
  const tailLength = Math.min(600, Math.floor(maxChars / 3));
  const headLength = Math.max(0, maxChars - tailLength - 80);
  return [
    text.slice(0, headLength).trimEnd(),
    '[Prompt excerpt: middle content omitted.]',
    text.slice(-tailLength).trimStart(),
  ].filter(Boolean).join('\n\n');
}

function compactInlineText(value: string, maxChars: number): string {
  const text = normalizeText(value).replace(/\s+/gu, ' ');
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

function isGenericPrivateChatRating(value: string): boolean {
  const text = normalizeText(value);
  if (!text) {
    return true;
  }
  return /^(Hello!|Thanks for your message\.|Thanks for sharing that\.|It has been a great conversation\.|We have been chatting for a while now\.|Thank you for the conversation! It was nice chatting with you\. See you next time!)/u.test(text);
}

function buildContextualBuyerRatingFallback(input: {
  providerName: string;
  originalRequest: string;
  serviceResult: string;
  expectedOutputType: string;
}): string {
  const providerName = compactInlineText(input.providerName, 80) || 'Remote MetaBot';
  const originalRequest = compactInlineText(input.originalRequest, 80);
  const expectedOutputType = compactInlineText(input.expectedOutputType, 40) || 'text';
  const score = normalizeText(input.serviceResult) ? 5 : 3;
  const useChinese = containsCjk(`${input.originalRequest}\n${input.serviceResult}`);
  const taskPart = originalRequest || expectedOutputType;
  if (useChinese) {
    return `评分：${score}分。${providerName} 的服务已完成，结果能回应「${taskPart}」。谢谢你的交付。`;
  }

  return `Rating: ${score}/5. ${providerName} completed the service for "${taskPart}" and the result addressed my request. Thank you.`;
}

function isUnsuitableBuyerRating(value: string): boolean {
  const text = normalizeText(value);
  if (!text) {
    return true;
  }
  return (
    isGenericPrivateChatRating(text)
    || /(?:Result summary|https?:\/\/|\|.+\||TOP\s*\d+)/iu.test(text)
  );
}

function findLatestOrderText(items: BuyerRatingTranscriptItem[]): string {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const type = normalizeText(item.type).toLowerCase();
    const sender = normalizeText(item.sender).toLowerCase();
    const content = normalizeText(item.content);
    if (sender !== 'caller' || !content) {
      continue;
    }
    if (type === 'order' || /^\[ORDER\]/iu.test(content)) {
      return extractOrderRawRequest(content) || content;
    }
  }
  return '';
}

function findLatestDeliveryText(items: BuyerRatingTranscriptItem[]): string {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const type = normalizeText(item.type).toLowerCase();
    const sender = normalizeText(item.sender).toLowerCase();
    const content = normalizeText(item.content);
    if (sender !== 'provider' || !content) {
      continue;
    }
    if (type === 'delivery' || type === 'assistant') {
      return content;
    }
  }
  return '';
}

export function extractBuyerRatingScore(value: string): number {
  const text = normalizeText(value);
  const match = text.match(/[1-5]\s*分|评分[：:]\s*([1-5])|([1-5])\s*(?:out of|\/)\s*5|([1-5])\s*星/i)
    ?? text.match(/([1-5])/);
  const raw = match
    ? (match[1] ?? match[2] ?? match[3] ?? match[0])
    : '';
  const digit = normalizeText(raw).replace(/[^1-5]/g, '').slice(0, 1);
  const parsed = Number.parseInt(digit, 10);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 5 ? parsed : 3;
}

export async function generateBuyerServiceRating(input: {
  replyRunner: ChatReplyRunner;
  textGenerator?: BuyerServiceRatingTextGenerator | null;
  persona: ChatPersona;
  traceId: string;
  providerGlobalMetaId: string;
  providerName?: string | null;
  originalRequest?: string | null;
  serviceResult?: string | null;
  expectedOutputType?: string | null;
  ratingRequestText?: string | null;
  transcriptItems: BuyerRatingTranscriptItem[];
  now?: number;
}): Promise<BuyerServiceRatingResult> {
  const now = typeof input.now === 'number' && Number.isFinite(input.now)
    ? Math.trunc(input.now)
    : Date.now();
  const originalRequest = normalizeText(input.originalRequest) || findLatestOrderText(input.transcriptItems);
  const serviceResult = normalizeText(input.serviceResult) || findLatestDeliveryText(input.transcriptItems);
  const expectedOutputType = normalizeText(input.expectedOutputType) || 'text';
  const ratingRequestText = normalizeText(input.ratingRequestText) || 'The provider is asking for a buyer rating.';
  const providerName = normalizeText(input.providerName) || 'Remote MetaBot';
  const contextualFallback = buildContextualBuyerRatingFallback({
    providerName,
    originalRequest,
    serviceResult,
    expectedOutputType,
  });

  if (input.textGenerator) {
    try {
      const generatedText = normalizeText(await input.textGenerator({
        persona: input.persona,
        traceId: input.traceId,
        providerGlobalMetaId: input.providerGlobalMetaId,
        providerName,
        originalRequest,
        serviceResult,
        expectedOutputType,
        ratingRequestText,
      }));
      if (generatedText && !isUnsuitableBuyerRating(generatedText)) {
        return {
          rate: extractBuyerRatingScore(generatedText),
          comment: generatedText.slice(0, 500),
        };
      }
    } catch {
      // Fall through to the existing chat runner and contextual fallback.
    }
  }

  const instruction = [
    'A remote MetaBot provider has delivered a skill-service result and is asking for final buyer feedback.',
    'You are the buyer MetaBot that requested the service. The provider is not the user.',
    `Provider: ${providerName}`,
    `Expected output type: ${expectedOutputType}`,
    `Original request:\n${truncateForPrompt(originalRequest || 'No original request was recorded.', 1200)}`,
    `Delivered result:\n${truncateForPrompt(serviceResult || 'No delivery text was recorded.', 1600)}`,
    `Provider rating request:\n${truncateForPrompt(ratingRequestText, 600)}`,
    'Write the buyer-side rating in the buyer MetaBot voice and use the original request language when clear.',
    'You MUST include one clear numeric score from 1 to 5, where 5 is best.',
    'Briefly mention whether the delivered result satisfied the task.',
    'Thank the provider politely.',
    'Do not paste or summarize the full delivered result. Do not include tables, rankings, URLs, or long data excerpts.',
    'Do not write phrases that imply the provider is the user, such as "用户请求 <provider>".',
    'Keep the complete message under 220 characters.',
  ].join('\n\n');

  const conversation: PrivateChatConversation = {
    conversationId: `service-rating-${normalizeText(input.traceId) || now}`,
    peerGlobalMetaId: normalizeText(input.providerGlobalMetaId),
    peerName: providerName,
    topic: 'service_rating',
    strategyId: 'service-rating',
    state: 'active',
    turnCount: 2,
    lastDirection: 'inbound',
    createdAt: now,
    updatedAt: now,
  };
  const recentMessages: PrivateChatMessage[] = [
    {
      conversationId: conversation.conversationId,
      messageId: `${conversation.conversationId}-order`,
      direction: 'outbound',
      senderGlobalMetaId: 'buyer',
      content: `Original request: ${truncateForPrompt(originalRequest, 1200)}`,
      messagePinId: null,
      extensions: null,
      timestamp: now - 3,
    },
    {
      conversationId: conversation.conversationId,
      messageId: `${conversation.conversationId}-delivery`,
      direction: 'inbound',
      senderGlobalMetaId: conversation.peerGlobalMetaId,
      content: `Delivered result: ${truncateForPrompt(serviceResult, 1600)}`,
      messagePinId: null,
      extensions: null,
      timestamp: now - 2,
    },
  ];
  const inboundMessage: PrivateChatMessage = {
    conversationId: conversation.conversationId,
    messageId: `${conversation.conversationId}-needs-rating`,
    direction: 'inbound',
    senderGlobalMetaId: conversation.peerGlobalMetaId,
    content: instruction,
    messagePinId: null,
    extensions: null,
    timestamp: now - 1,
  };

  const runnerResult = await input.replyRunner({
    conversation,
    recentMessages,
    persona: input.persona,
    strategy: {
      id: 'service-rating',
      maxTurns: 3,
      maxIdleMs: 0,
      exitCriteria: 'Evaluate the paid service, include a numeric 1-5 score, and close the order politely.',
    },
    inboundMessage,
  });
  const generated = normalizeText(runnerResult.content);
  const comment = generated && !isUnsuitableBuyerRating(generated)
    ? generated
    : contextualFallback;
  return {
    rate: extractBuyerRatingScore(comment),
    comment: comment.slice(0, 500),
  };
}
