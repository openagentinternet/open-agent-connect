import { sendPrivateChat } from './privateChat';
import { loadChatPersona } from './chatPersonaLoader';
import { persistA2AConversationMessageBestEffort } from '../a2a/conversationPersistence';
import { classifySimplemsgContent } from '../a2a/simplemsgClassifier';
import type { PrivateChatStateStore } from './privateChatStateStore';
import type { ChatStrategyStore } from './chatStrategyStore';
import type { MetabotPaths } from '../state/paths';
import type { Signer } from '../signing/signer';
import type {
  PrivateChatInboundMessage,
  PrivateChatConversation,
  PrivateChatMessage,
  ChatReplyRunner,
  PrivateChatAutoReplyConfig,
} from './privateChatTypes';

const DEFAULT_MAX_TURNS = 30;
const DEFAULT_MAX_IDLE_MS = 300_000;
const DEFAULT_RECENT_MESSAGES_LIMIT = 60;
const CLOSE_CONVERSATION_SIGNAL = 'Bye';
const MAX_REPLIES_PER_MINUTE = 10;
const MAX_REPLIES_PER_HOUR = 100;

export interface PrivateChatAutoReplyDependencies {
  stateStore: PrivateChatStateStore;
  strategyStore: ChatStrategyStore;
  paths: MetabotPaths;
  signer: Signer;
  selfGlobalMetaId: () => Promise<string | null>;
  resolvePeerChatPublicKey: (globalMetaId: string) => Promise<string | null>;
  replyRunner: ChatReplyRunner;
  now?: () => number;
}

export interface PrivateChatAutoReplyOrchestrator {
  handleInboundMessage(message: PrivateChatInboundMessage): Promise<void>;
}

interface RateLimiterState {
  replyTimestamps: number[];
}

interface SentPrivateChatReply {
  pinId: string | null;
  txids: string[];
  network: string | null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getCooldownDelayMs(turnCount: number): number {
  if (turnCount <= 5) return 0;
  if (turnCount <= 10) return 10_000;
  if (turnCount <= 20) return 30_000;
  return 60_000;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function buildConversationId(selfGlobalMetaId: string, peerGlobalMetaId: string): string {
  return `pc-${selfGlobalMetaId}-${peerGlobalMetaId}`;
}

function buildMessageId(timestamp: number): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `msg-${timestamp}-${random}`;
}

function parseExtensions(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed.extensions as Record<string, unknown> | null ?? null;
    }
  } catch {
    // Not JSON, no extensions.
  }
  return null;
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

function ensureFinalByeLine(value: string): string {
  const content = normalizeText(value);
  if (!content) {
    return CLOSE_CONVERSATION_SIGNAL;
  }
  const lines = content.split(/\r?\n/u);
  const finalIndex = findFinalNonEmptyLineIndex(lines);
  if (finalIndex >= 0 && lines[finalIndex].trim().toLowerCase() === CLOSE_CONVERSATION_SIGNAL.toLowerCase()) {
    lines[finalIndex] = CLOSE_CONVERSATION_SIGNAL;
    return lines.join('\n').trim();
  }
  return `${content}\n${CLOSE_CONVERSATION_SIGNAL}`;
}

async function shouldResetIdleTurnCount(input: {
  stateStore: PrivateChatStateStore;
  conversationId: string;
  inboundTimestamp: number;
  maxIdleMs: number;
}): Promise<boolean> {
  const [latestMessage] = await input.stateStore.getRecentMessages(input.conversationId, 1);
  if (!latestMessage || !Number.isFinite(latestMessage.timestamp)) {
    return false;
  }
  return input.inboundTimestamp - latestMessage.timestamp > input.maxIdleMs;
}

function checkRateLimit(rateLimiter: RateLimiterState, now: number): boolean {
  const oneMinuteAgo = now - 60_000;
  const oneHourAgo = now - 3_600_000;
  rateLimiter.replyTimestamps = rateLimiter.replyTimestamps.filter(t => t > oneHourAgo);

  const repliesLastMinute = rateLimiter.replyTimestamps.filter(t => t > oneMinuteAgo).length;
  const repliesLastHour = rateLimiter.replyTimestamps.length;

  return repliesLastMinute < MAX_REPLIES_PER_MINUTE && repliesLastHour < MAX_REPLIES_PER_HOUR;
}

export function createPrivateChatAutoReplyOrchestrator(
  deps: PrivateChatAutoReplyDependencies,
  config: PrivateChatAutoReplyConfig,
): PrivateChatAutoReplyOrchestrator {
  const rateLimiter: RateLimiterState = { replyTimestamps: [] };
  const getNow = deps.now ?? (() => Date.now());

  async function sendReplyMessage(
    selfGlobalMetaId: string,
    peerGlobalMetaId: string,
    content: string,
    extensions: Record<string, unknown> | null,
  ): Promise<SentPrivateChatReply | null> {
    let privateChatIdentity;
    try {
      privateChatIdentity = await deps.signer.getPrivateChatIdentity();
    } catch {
      return null;
    }

    const peerChatPublicKey = await deps.resolvePeerChatPublicKey(peerGlobalMetaId);
    if (!peerChatPublicKey) return null;

    const messageContent = extensions
      ? JSON.stringify({ content, extensions })
      : content;

    const sent = sendPrivateChat({
      fromIdentity: {
        globalMetaId: privateChatIdentity.globalMetaId,
        privateKeyHex: privateChatIdentity.privateKeyHex,
      },
      toGlobalMetaId: peerGlobalMetaId,
      peerChatPublicKey,
      content: messageContent,
    });

    try {
      const chatWrite = await deps.signer.writePin({
        operation: 'create',
        path: sent.path,
        encryption: sent.encryption,
        version: sent.version,
        contentType: sent.contentType,
        payload: sent.payload,
        encoding: 'utf-8',
        network: 'mvc',
      });
      return {
        pinId: normalizeText(chatWrite.pinId) || null,
        txids: Array.isArray(chatWrite.txids)
          ? chatWrite.txids.map((entry) => normalizeText(entry)).filter(Boolean)
          : [],
        network: normalizeText(chatWrite.network) || null,
      };
    } catch {
      return null;
    }
  }

  return {
    async handleInboundMessage(message) {
      if (!config.enabled) return;

      const selfGlobalMetaId = await deps.selfGlobalMetaId();
      if (!selfGlobalMetaId) return;

      const now = getNow();
      const peerGlobalMetaId = normalizeText(message.fromGlobalMetaId);
      if (!peerGlobalMetaId) return;

      const conversationId = buildConversationId(selfGlobalMetaId, peerGlobalMetaId);
      const inboundTimestamp = message.timestamp || now;
      const simplemsgClassification = classifySimplemsgContent(message.content);

      // Step 1: Store the inbound message.
      let conversation = await deps.stateStore.getConversationByPeer(peerGlobalMetaId);
      if (!conversation || conversation.state === 'closed') {
        conversation = {
          conversationId,
          peerGlobalMetaId,
          peerName: null,
          topic: null,
          strategyId: config.defaultStrategyId,
          state: 'active',
          turnCount: 0,
          lastDirection: 'inbound',
          createdAt: now,
          updatedAt: now,
        };
      }

      const strategy = conversation.strategyId
        ? await deps.strategyStore.getStrategy(conversation.strategyId)
        : null;
      const maxIdleMs = strategy?.maxIdleMs ?? DEFAULT_MAX_IDLE_MS;
      if (await shouldResetIdleTurnCount({
        stateStore: deps.stateStore,
        conversationId: conversation.conversationId,
        inboundTimestamp,
        maxIdleMs,
      })) {
        conversation = {
          ...conversation,
          turnCount: 0,
        };
      }

      const inboundMessageRecord: PrivateChatMessage = {
        conversationId: conversation.conversationId,
        messageId: message.messagePinId || buildMessageId(now),
        direction: 'inbound',
        senderGlobalMetaId: peerGlobalMetaId,
        content: message.content,
        messagePinId: message.messagePinId,
        extensions: parseExtensions(message.content),
        timestamp: inboundTimestamp,
      };

      await deps.stateStore.appendMessages([inboundMessageRecord]);

      conversation = {
        ...conversation,
        turnCount: conversation.turnCount + 1,
        lastDirection: 'inbound',
        updatedAt: now,
      };
      await deps.stateStore.upsertConversation(conversation);
      await persistA2AConversationMessageBestEffort({
        paths: deps.paths,
        local: {
          globalMetaId: selfGlobalMetaId,
        },
        peer: {
          globalMetaId: peerGlobalMetaId,
          chatPublicKey: message.fromChatPublicKey,
        },
        message: {
          messageId: inboundMessageRecord.messageId,
          direction: 'incoming',
          content: inboundMessageRecord.content,
          pinId: inboundMessageRecord.messagePinId,
          timestamp: inboundMessageRecord.timestamp,
          raw: message.rawMessage,
        },
      });

      if (simplemsgClassification.kind === 'order_protocol') {
        return;
      }

      // Step 2: Check for the natural-language closing signal from peer.
      if (hasFinalByeLine(message.content)) {
        conversation = { ...conversation, state: 'closed', updatedAt: now };
        await deps.stateStore.upsertConversation(conversation);
        return;
      }

      // Step 3: Check auto-reply eligibility.
      if (conversation.state !== 'active') return;
      if (!checkRateLimit(rateLimiter, now)) return;

      const maxTurns = strategy?.maxTurns ?? DEFAULT_MAX_TURNS;

      // Step 4: Apply cooldown delay.
      const cooldownMs = getCooldownDelayMs(conversation.turnCount);
      if (cooldownMs > 0) {
        await sleep(cooldownMs);
      }

      // Step 5: Check hard turn limit.
      if (conversation.turnCount >= maxTurns) {
        const closingContent = ensureFinalByeLine('It was great chatting with you. Let us continue another time.');
        const closingReply = await sendReplyMessage(
          selfGlobalMetaId,
          peerGlobalMetaId,
          closingContent,
          null,
        );
        const closingPinId = closingReply?.pinId ?? null;

        const outboundRecord: PrivateChatMessage = {
          conversationId: conversation.conversationId,
          messageId: closingPinId || buildMessageId(getNow()),
          direction: 'outbound',
          senderGlobalMetaId: selfGlobalMetaId,
          content: closingContent,
          messagePinId: closingPinId,
          extensions: null,
          timestamp: getNow(),
        };
        await deps.stateStore.appendMessages([outboundRecord]);
        await persistA2AConversationMessageBestEffort({
          paths: deps.paths,
          local: {
            globalMetaId: selfGlobalMetaId,
          },
          peer: {
            globalMetaId: peerGlobalMetaId,
          },
          message: {
            messageId: outboundRecord.messageId,
            direction: 'outgoing',
            content: outboundRecord.content,
            pinId: outboundRecord.messagePinId,
            txid: closingReply?.txids[0] ?? null,
            txids: closingReply?.txids ?? [],
            chain: closingReply?.network ?? 'mvc',
            timestamp: outboundRecord.timestamp,
          },
        });
        rateLimiter.replyTimestamps.push(getNow());
        conversation = {
          ...conversation,
          state: 'closed',
          lastDirection: 'outbound',
          updatedAt: getNow(),
        };
        await deps.stateStore.upsertConversation(conversation);
        return;
      }

      // Step 6: Build context and call reply runner.
      const persona = await loadChatPersona(deps.paths);
      const recentMessages = await deps.stateStore.getRecentMessages(
        conversation.conversationId,
        DEFAULT_RECENT_MESSAGES_LIMIT,
      );

      let runnerResult;
      try {
        runnerResult = await deps.replyRunner({
          conversation,
          recentMessages,
          persona,
          strategy,
          inboundMessage: inboundMessageRecord,
        });
      } catch {
        return;
      }

      // Step 7: Process runner result.
      if (runnerResult.state === 'skip') return;

      let replyContent = normalizeText(runnerResult.content);
      const shouldClose = runnerResult.state === 'end_conversation' || hasFinalByeLine(replyContent);
      if (shouldClose) {
        replyContent = ensureFinalByeLine(replyContent);
      }
      const replyExtensions: Record<string, unknown> | null = shouldClose
        ? null
        : runnerResult.extensions ?? null;

      if (!replyContent) return;

      // Step 8: Send reply.
      const outboundReply = await sendReplyMessage(
        selfGlobalMetaId,
        peerGlobalMetaId,
        replyContent,
        replyExtensions,
      );
      const outboundPinId = outboundReply?.pinId ?? null;

      const outboundRecord: PrivateChatMessage = {
        conversationId: conversation.conversationId,
        messageId: outboundPinId || buildMessageId(getNow()),
        direction: 'outbound',
        senderGlobalMetaId: selfGlobalMetaId,
        content: replyContent,
        messagePinId: outboundPinId,
        extensions: replyExtensions,
        timestamp: getNow(),
      };

      await deps.stateStore.appendMessages([outboundRecord]);
      await persistA2AConversationMessageBestEffort({
        paths: deps.paths,
        local: {
          globalMetaId: selfGlobalMetaId,
        },
        peer: {
          globalMetaId: peerGlobalMetaId,
        },
        message: {
          messageId: outboundRecord.messageId,
          direction: 'outgoing',
          content: outboundRecord.content,
          pinId: outboundRecord.messagePinId,
          txid: outboundReply?.txids[0] ?? null,
          txids: outboundReply?.txids ?? [],
          chain: outboundReply?.network ?? 'mvc',
          timestamp: outboundRecord.timestamp,
        },
      });

      rateLimiter.replyTimestamps.push(getNow());

      conversation = {
        ...conversation,
        state: shouldClose ? 'closed' : 'active',
        lastDirection: 'outbound',
        updatedAt: getNow(),
      };
      await deps.stateStore.upsertConversation(conversation);
    },
  };
}
