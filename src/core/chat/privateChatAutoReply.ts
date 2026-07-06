import { sendPrivateChat } from './privateChat';
import { loadChatPersona } from './chatPersonaLoader';
import {
  persistA2AConversationMessageBestEffort,
  type A2AConversationMessagePersister,
} from '../a2a/conversationPersistence';
import { classifySimplemsgContent } from '../a2a/simplemsgClassifier';
import type { PrivateChatPendingGuidanceClaim, PrivateChatStateStore } from './privateChatStateStore';
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
const CLOSE_CONVERSATION_FINAL_LINE_PATTERN = /^(?:bye|goodbye)[.!。！]?$/iu;
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
  a2aConversationPersister?: A2AConversationMessagePersister;
  now?: () => number;
}

export interface PrivateChatAutoReplyOrchestrator {
  handleInboundMessage(message: PrivateChatInboundMessage): Promise<void>;
  handleLocalGuidedTurn(
    peerGlobalMetaId: string,
    options?: {
      guidanceToConsume?: PrivateChatPendingGuidanceClaim | null;
    },
  ): Promise<void>;
}

interface RateLimiterState {
  replyTimestamps: number[];
}

interface SentPrivateChatReply {
  pinId: string | null;
  txids: string[];
  network: string | null;
}

interface PreparedOutboundTurn {
  content: string;
  extensions: Record<string, unknown> | null;
  shouldClose: boolean;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTimestampMs(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return numeric < 1_000_000_000_000 ? Math.floor(numeric * 1000) : Math.floor(numeric);
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

async function pendingGuidanceClaimStillMatchesState(
  stateStore: PrivateChatStateStore,
  conversationId: string,
  claim: PrivateChatPendingGuidanceClaim,
): Promise<boolean> {
  const state = await stateStore.readState();
  const conversation = state.conversations.find(entry => entry.conversationId === conversationId) ?? null;
  return Boolean(
    conversation
    && normalizeText(conversation.pendingGuidanceText) === claim.guidanceText
    && conversation.pendingGuidanceCreatedAt === claim.createdAt
    && conversation.pendingGuidanceLeaseId === claim.leaseId
    && conversation.pendingGuidanceLeaseExpiresAt === claim.leaseExpiresAt
  );
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
  return finalIndex >= 0 && CLOSE_CONVERSATION_FINAL_LINE_PATTERN.test(lines[finalIndex].trim());
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
  return normalizeTimestampMs(input.inboundTimestamp) - normalizeTimestampMs(latestMessage.timestamp) > input.maxIdleMs;
}

async function conversationHasOutboundSince(input: {
  stateStore: PrivateChatStateStore;
  conversationId: string;
  sinceTimestamp: number;
}): Promise<boolean> {
  const sinceTimestamp = normalizeTimestampMs(input.sinceTimestamp);
  if (!sinceTimestamp) {
    return false;
  }
  const state = await input.stateStore.readState();
  return state.messages.some((message) =>
    message.conversationId === input.conversationId
    && message.direction === 'outbound'
    && normalizeTimestampMs(message.timestamp) > sinceTimestamp,
  );
}

async function latestConversationMessageMatches(input: {
  stateStore: PrivateChatStateStore;
  conversationId: string;
  expectedMessageId: string;
}): Promise<boolean> {
  const latestMessages = await input.stateStore.getRecentMessages(input.conversationId, 1);
  const latestMessage = latestMessages.at(-1) ?? null;
  return Boolean(latestMessage && latestMessage.messageId === input.expectedMessageId);
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

  async function prepareOutboundTurn(input: {
    conversation: PrivateChatConversation;
    recentMessages: PrivateChatMessage[];
    persona: Awaited<ReturnType<typeof loadChatPersona>>;
    strategy: Awaited<ReturnType<ChatStrategyStore['getStrategy']>>;
    inboundMessage: PrivateChatMessage | null;
    operatorGuidanceText?: string | null;
  }): Promise<PreparedOutboundTurn | null> {
    let runnerResult;
    try {
      runnerResult = await deps.replyRunner({
        conversation: input.conversation,
        recentMessages: input.recentMessages,
        persona: input.persona,
        strategy: input.strategy,
        inboundMessage: input.inboundMessage,
        operatorGuidanceText: input.operatorGuidanceText ?? null,
      });
    } catch {
      return null;
    }

    if (runnerResult.state === 'skip') {
      return null;
    }

    let content = normalizeText(runnerResult.content);
    const shouldClose = runnerResult.state === 'end_conversation' || hasFinalByeLine(content);
    if (shouldClose) {
      content = ensureFinalByeLine(content);
    }
    if (!content) {
      return null;
    }

    return {
      content,
      extensions: shouldClose ? null : runnerResult.extensions ?? null,
      shouldClose,
    };
  }

  async function commitOutboundTurn(input: {
    selfGlobalMetaId: string;
    peerGlobalMetaId: string;
    conversation: PrivateChatConversation;
    content: string;
    extensions: Record<string, unknown> | null;
    shouldClose: boolean;
    triggerMessageId?: string | null;
    guidanceToConsume?: PrivateChatPendingGuidanceClaim | null;
  }): Promise<PrivateChatConversation | null> {
    let outboundReply: SentPrivateChatReply | null = null;
    try {
      if (
        input.guidanceToConsume
        && await conversationHasOutboundSince({
          stateStore: deps.stateStore,
          conversationId: input.conversation.conversationId,
          sinceTimestamp: input.guidanceToConsume.createdAt,
        })
      ) {
        await deps.stateStore.clearPendingGuidanceIfMatches(
          input.conversation.conversationId,
          input.guidanceToConsume.guidanceText,
          input.guidanceToConsume.createdAt,
          input.guidanceToConsume.leaseId,
        ).catch(() => null);
        return null;
      }
      if (
        input.guidanceToConsume
        && !(await pendingGuidanceClaimStillMatchesState(
          deps.stateStore,
          input.conversation.conversationId,
          input.guidanceToConsume,
        ))
      ) {
        await deps.stateStore.releasePendingGuidanceClaimIfMatches(
          input.conversation.conversationId,
          input.guidanceToConsume,
        ).catch(() => null);
        return null;
      }
      if (
        input.triggerMessageId
        && !(await latestConversationMessageMatches({
          stateStore: deps.stateStore,
          conversationId: input.conversation.conversationId,
          expectedMessageId: input.triggerMessageId,
        }))
      ) {
        if (input.guidanceToConsume) {
          await deps.stateStore.releasePendingGuidanceClaimIfMatches(
            input.conversation.conversationId,
            input.guidanceToConsume,
          ).catch(() => null);
        }
        return null;
      }
      outboundReply = await sendReplyMessage(
        input.selfGlobalMetaId,
        input.peerGlobalMetaId,
        input.content,
        input.extensions,
      );
      if (!outboundReply) {
        if (input.guidanceToConsume) {
          await deps.stateStore.releasePendingGuidanceClaimIfMatches(
            input.conversation.conversationId,
            input.guidanceToConsume,
          );
        }
        return null;
      }

      const timestamp = getNow();
      const outboundRecord: PrivateChatMessage = {
        conversationId: input.conversation.conversationId,
        messageId: outboundReply.pinId || buildMessageId(timestamp),
        direction: 'outbound',
        senderGlobalMetaId: input.selfGlobalMetaId,
        content: input.content,
        messagePinId: outboundReply.pinId,
        extensions: input.extensions,
        timestamp,
      };

      await deps.stateStore.appendMessages([outboundRecord]);
      await persistA2AConversationMessageBestEffort({
        paths: deps.paths,
        local: {
          globalMetaId: input.selfGlobalMetaId,
        },
        peer: {
          globalMetaId: input.peerGlobalMetaId,
        },
        message: {
          messageId: outboundRecord.messageId,
          direction: 'outgoing',
          content: outboundRecord.content,
          pinId: outboundRecord.messagePinId,
          txid: outboundReply.txids[0] ?? null,
          txids: outboundReply.txids,
          chain: outboundReply.network ?? 'mvc',
          timestamp: outboundRecord.timestamp,
        },
      }, deps.a2aConversationPersister);

      const latestConversation = await deps.stateStore.getConversationByPeer(input.peerGlobalMetaId);
      let updatedConversation: PrivateChatConversation = {
        ...input.conversation,
        state: input.shouldClose ? 'closed' : 'active',
        lastDirection: 'outbound',
        updatedAt: timestamp,
        pendingGuidanceText: latestConversation?.pendingGuidanceText ?? input.conversation.pendingGuidanceText,
        pendingGuidanceCreatedAt:
          latestConversation?.pendingGuidanceCreatedAt ?? input.conversation.pendingGuidanceCreatedAt,
        pendingGuidanceLeaseId:
          latestConversation?.pendingGuidanceLeaseId ?? input.conversation.pendingGuidanceLeaseId ?? null,
        pendingGuidanceLeaseExpiresAt:
          latestConversation?.pendingGuidanceLeaseExpiresAt ?? input.conversation.pendingGuidanceLeaseExpiresAt ?? null,
      };
      await deps.stateStore.upsertConversation(updatedConversation);

      if (input.guidanceToConsume) {
        updatedConversation = await deps.stateStore.clearPendingGuidanceIfMatches(
          input.conversation.conversationId,
          input.guidanceToConsume.guidanceText,
          input.guidanceToConsume.createdAt,
          input.guidanceToConsume.leaseId,
        ) ?? updatedConversation;
      }

      return updatedConversation;
    } catch {
      if (input.guidanceToConsume) {
        if (outboundReply) {
          await deps.stateStore.clearPendingGuidanceIfMatches(
            input.conversation.conversationId,
            input.guidanceToConsume.guidanceText,
            input.guidanceToConsume.createdAt,
            input.guidanceToConsume.leaseId,
          ).catch(() => null);
        } else {
          await deps.stateStore.releasePendingGuidanceClaimIfMatches(
            input.conversation.conversationId,
            input.guidanceToConsume,
          ).catch(() => null);
        }
      }
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
      const inboundTimestamp = normalizeTimestampMs(message.timestamp) || now;

      // ---- Shared: conversation lifecycle & message storage ----

      let conversation: PrivateChatConversation = await deps.stateStore.getConversationByPeer(peerGlobalMetaId) ?? {
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
        pendingGuidanceText: null,
        pendingGuidanceCreatedAt: null,
        pendingGuidanceLeaseId: null,
        pendingGuidanceLeaseExpiresAt: null,
      };

      const strategy = conversation.strategyId
        ? await deps.strategyStore.getStrategy(conversation.strategyId)
        : null;
      const maxIdleMs = strategy?.maxIdleMs ?? DEFAULT_MAX_IDLE_MS;
      const shouldReopenClosedConversation = conversation.state === 'closed'
        && now - conversation.updatedAt > maxIdleMs;
      if (shouldReopenClosedConversation) {
        conversation = {
          ...conversation,
          state: 'active',
          turnCount: 0,
        };
      }
      if (conversation.state !== 'closed' && await shouldResetIdleTurnCount({
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

      const simplemsgClassification = classifySimplemsgContent(message.content);

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

      const appendedInboundMessages = await deps.stateStore.appendMessages([inboundMessageRecord]);
      if (appendedInboundMessages.length === 0) {
        return;
      }

      conversation = {
        ...conversation,
        lastDirection: 'inbound',
        updatedAt: now,
      };

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
          contentType: message.contentType,
          pinId: inboundMessageRecord.messagePinId,
          timestamp: inboundMessageRecord.timestamp,
          raw: message.rawMessage,
        },
      }, deps.a2aConversationPersister);

      if (conversation.state === 'closed') {
        await deps.stateStore.upsertConversation(conversation);
        return;
      }

      // ---- Order-protocol path: record-only, no turn counting, no reply ----

      if (simplemsgClassification.kind === 'order_protocol') {
        await deps.stateStore.upsertConversation(conversation);
        return;
      }

      // ---- Private-chat path: turn counting, cooldown, reply runner ----

      conversation = {
        ...conversation,
        turnCount: conversation.turnCount + 1,
      };
      await deps.stateStore.upsertConversation(conversation);

      // Check for the natural-language closing signal from peer.
      if (hasFinalByeLine(message.content)) {
        conversation = { ...conversation, state: 'closed', updatedAt: now };
        await deps.stateStore.upsertConversation(conversation);
        return;
      }

      // Check auto-reply eligibility.
      if (conversation.state !== 'active') return;
      if (!checkRateLimit(rateLimiter, now)) return;

      const guidanceWasPending = Boolean(
        normalizeText(conversation.pendingGuidanceText)
        && typeof conversation.pendingGuidanceCreatedAt === 'number',
      );
      const guidanceToConsume = guidanceWasPending
        ? await deps.stateStore.claimPendingGuidance(
            conversation.conversationId,
            { now: getNow() },
          )
        : null;
      if (guidanceWasPending && !guidanceToConsume) {
        return;
      }

      const maxTurns = strategy?.maxTurns ?? DEFAULT_MAX_TURNS;

      // Check hard turn limit unless an operator-guided turn must run now.
      if (conversation.turnCount >= maxTurns && !guidanceToConsume) {
        const committedConversation = await commitOutboundTurn({
          selfGlobalMetaId,
          peerGlobalMetaId,
          conversation,
          content: ensureFinalByeLine('It was great chatting with you. Let us continue another time.'),
          extensions: null,
          shouldClose: true,
        });
        if (committedConversation) {
          rateLimiter.replyTimestamps.push(getNow());
        }
        return;
      }

      // Build context and call reply runner.
      const persona = await loadChatPersona(deps.paths);
      const recentMessages = await deps.stateStore.getRecentMessages(
        conversation.conversationId,
        DEFAULT_RECENT_MESSAGES_LIMIT,
      );
      const preparedTurn = await prepareOutboundTurn({
        conversation,
        recentMessages,
        persona,
        strategy,
        inboundMessage: inboundMessageRecord,
        operatorGuidanceText: guidanceToConsume?.guidanceText ?? null,
      });
      if (!preparedTurn) {
        if (guidanceToConsume) {
          await deps.stateStore.releasePendingGuidanceClaimIfMatches(
            conversation.conversationId,
            guidanceToConsume,
          );
        }
        return;
      }

      const committedConversation = await commitOutboundTurn({
        selfGlobalMetaId,
        peerGlobalMetaId,
        conversation,
        content: preparedTurn.content,
        extensions: preparedTurn.extensions,
        shouldClose: preparedTurn.shouldClose,
        triggerMessageId: inboundMessageRecord.messageId,
        guidanceToConsume,
      });
      if (!committedConversation) return;

      rateLimiter.replyTimestamps.push(getNow());
    },
    async handleLocalGuidedTurn(peerGlobalMetaId, options = {}) {
      const selfGlobalMetaId = await deps.selfGlobalMetaId();
      if (!selfGlobalMetaId) return;

      const normalizedPeerGlobalMetaId = normalizeText(peerGlobalMetaId);
      if (!normalizedPeerGlobalMetaId) return;

      const conversation = await deps.stateStore.getConversationByPeer(normalizedPeerGlobalMetaId);
      if (!conversation) return;
      if (conversation.state !== 'active' && conversation.state !== 'closed') return;

      const strategy = conversation.strategyId
        ? await deps.strategyStore.getStrategy(conversation.strategyId)
        : null;
      const guidanceToConsume = options.guidanceToConsume
        ?? await deps.stateStore.claimPendingGuidance(
          conversation.conversationId,
          { now: getNow() },
        );
      if (!guidanceToConsume) return;
      const runnerConversation = conversation.state === 'closed'
        ? {
          ...conversation,
          state: 'active' as const,
          turnCount: 1,
        }
        : {
          ...conversation,
          turnCount: conversation.turnCount + 1,
        };
      const persona = await loadChatPersona(deps.paths);
      const recentMessages = await deps.stateStore.getRecentMessages(
        conversation.conversationId,
        DEFAULT_RECENT_MESSAGES_LIMIT,
      );
      const preparedTurn = await prepareOutboundTurn({
        conversation: runnerConversation,
        recentMessages,
        persona,
        strategy,
        inboundMessage: null,
        operatorGuidanceText: guidanceToConsume.guidanceText,
      });
      if (!preparedTurn) {
        await deps.stateStore.releasePendingGuidanceClaimIfMatches(
          conversation.conversationId,
          guidanceToConsume,
        );
        return;
      }

      const committedConversation = await commitOutboundTurn({
        selfGlobalMetaId,
        peerGlobalMetaId: normalizedPeerGlobalMetaId,
        conversation: runnerConversation,
        content: preparedTurn.content,
        extensions: preparedTurn.extensions,
        shouldClose: preparedTurn.shouldClose,
        guidanceToConsume,
      });
      if (!committedConversation) return;

      rateLimiter.replyTimestamps.push(getNow());
    },
  };
}
