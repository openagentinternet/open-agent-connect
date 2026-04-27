import { sendPrivateChat } from './privateChat';
import { loadChatPersona } from './chatPersonaLoader';
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
const DEFAULT_RECENT_MESSAGES_LIMIT = 20;
const END_CONVERSATION_MARKER = '[END_CONVERSATION]';
const CLOSING_SIGNAL = 'closing';
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

function hasClosingSignal(message: PrivateChatInboundMessage): boolean {
  const extensions = parseExtensions(message.content);
  return normalizeText(extensions?.conversationSignal) === CLOSING_SIGNAL;
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
  ): Promise<string | null> {
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
      return normalizeText(chatWrite.pinId) || null;
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

      const inboundMessageRecord: PrivateChatMessage = {
        conversationId: conversation.conversationId,
        messageId: message.messagePinId || buildMessageId(now),
        direction: 'inbound',
        senderGlobalMetaId: peerGlobalMetaId,
        content: message.content,
        messagePinId: message.messagePinId,
        extensions: parseExtensions(message.content),
        timestamp: message.timestamp || now,
      };

      await deps.stateStore.appendMessages([inboundMessageRecord]);

      conversation = {
        ...conversation,
        turnCount: conversation.turnCount + 1,
        lastDirection: 'inbound',
        updatedAt: now,
      };
      await deps.stateStore.upsertConversation(conversation);

      // Step 2: Check for closing signal from peer.
      if (hasClosingSignal(message)) {
        conversation = { ...conversation, state: 'closed', updatedAt: now };
        await deps.stateStore.upsertConversation(conversation);
        return;
      }

      // Step 3: Check auto-reply eligibility.
      if (conversation.state !== 'active') return;
      if (!checkRateLimit(rateLimiter, now)) return;

      // Load strategy.
      const strategy = conversation.strategyId
        ? await deps.strategyStore.getStrategy(conversation.strategyId)
        : null;
      const maxTurns = strategy?.maxTurns ?? DEFAULT_MAX_TURNS;

      // Step 4: Apply cooldown delay.
      const cooldownMs = getCooldownDelayMs(conversation.turnCount);
      if (cooldownMs > 0) {
        await sleep(cooldownMs);
      }

      // Step 5: Check hard turn limit.
      if (conversation.turnCount >= maxTurns) {
        const closingContent = 'It was great chatting with you. Let us continue another time!';
        const closingPinId = await sendReplyMessage(
          selfGlobalMetaId,
          peerGlobalMetaId,
          closingContent,
          { conversationSignal: CLOSING_SIGNAL },
        );

        const outboundRecord: PrivateChatMessage = {
          conversationId: conversation.conversationId,
          messageId: closingPinId || buildMessageId(getNow()),
          direction: 'outbound',
          senderGlobalMetaId: selfGlobalMetaId,
          content: closingContent,
          messagePinId: closingPinId,
          extensions: { conversationSignal: CLOSING_SIGNAL },
          timestamp: getNow(),
        };
        await deps.stateStore.appendMessages([outboundRecord]);
        rateLimiter.replyTimestamps.push(getNow());
        conversation = {
          ...conversation,
          state: 'closed',
          turnCount: conversation.turnCount + 1,
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
      let replyExtensions: Record<string, unknown> | null = runnerResult.extensions ?? null;
      let shouldClose = runnerResult.state === 'end_conversation';

      // Check for [END_CONVERSATION] marker in reply content.
      if (replyContent.includes(END_CONVERSATION_MARKER)) {
        replyContent = replyContent.replace(END_CONVERSATION_MARKER, '').trim();
        shouldClose = true;
      }

      if (shouldClose) {
        replyExtensions = { ...(replyExtensions ?? {}), conversationSignal: CLOSING_SIGNAL };
      }

      if (!replyContent) return;

      // Step 8: Send reply.
      const outboundPinId = await sendReplyMessage(
        selfGlobalMetaId,
        peerGlobalMetaId,
        replyContent,
        replyExtensions,
      );

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

      rateLimiter.replyTimestamps.push(getNow());

      conversation = {
        ...conversation,
        state: shouldClose ? 'closed' : 'active',
        turnCount: conversation.turnCount + 1,
        lastDirection: 'outbound',
        updatedAt: getNow(),
      };
      await deps.stateStore.upsertConversation(conversation);
    },
  };
}
