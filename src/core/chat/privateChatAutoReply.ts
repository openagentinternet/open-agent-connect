import { sendPrivateChat } from './privateChat';
import { loadChatPersona } from './chatPersonaLoader';
import {
  buildPrivateReplyMemoryContext,
  recordPrivateChatMemoryTurn,
} from './privateChatMemory';
import type { ChatSkillWaitNoticeGenerator } from './chatSkillWaitNotice';
import {
  buildPrivateChatEmptyReplyRetryNotice,
  buildPrivateChatWakeNotice,
  CHAT_NO_REPLY_EXTENSION,
  CHAT_SILENT_TAIL_EXTENSION,
  isPrivateChatNoReplySentinel,
  isRepeatInboundPrivateChatMessage,
  selectPrivateChatPromptContextMessages,
  shouldSkipPrivateChatAutoReplyText,
  wouldCreatePrivateChatEchoLoop,
} from './privateChatLoopGuards';
import {
  createPrivateChatWakeStore,
  DEFAULT_EMPTY_REPLY_RETRY_DELAYS_MS,
  type PrivateChatWakeRecord,
  type PrivateChatWakeStore,
} from './privateChatWake';
import { CHAT_INTERIM_EXTENSION } from './privateChatInterimTurn';
import {
  persistA2AConversationMessageBestEffort,
  publishA2AConversationReplyState,
  type A2AConversationMessagePersister,
} from '../a2a/conversationPersistence';
import { classifySimplemsgContent } from '../a2a/simplemsgClassifier';
import {
  describePrivateChatSendFailureError,
  type PrivateChatSendFailureEvent,
} from './privateChatSendFailureLog';
import type { PrivateChatPendingGuidanceClaim, PrivateChatStateStore } from './privateChatStateStore';
import type { ChatStrategyStore } from './chatStrategyStore';
import type { MetabotPaths } from '../state/paths';
import type { Signer } from '../signing/signer';
import type {
  PrivateChatInboundMessage,
  PrivateChatConversation,
  PrivateChatMessage,
  ChatReplyRunner,
  ChatStrategy,
  PrivateChatAutoReplyConfig,
} from './privateChatTypes';

// IDBots parity: 50 turns per active session by default.
export const DEFAULT_MAX_TURNS = 50;
const DEFAULT_MAX_IDLE_MS = 300_000;
// IDBots parity: 80 messages from the active session + 20 from the previous
// session as background (see selectPrivateChatPromptContextMessages).
const ACTIVE_SEGMENT_MESSAGES_LIMIT = 80;
const PREVIOUS_SEGMENT_MESSAGES_LIMIT = 20;
const DEFAULT_RECENT_MESSAGES_LIMIT = ACTIVE_SEGMENT_MESSAGES_LIMIT + PREVIOUS_SEGMENT_MESSAGES_LIMIT;
const CLOSE_CONVERSATION_SIGNAL = 'Bye';
const CLOSE_CONVERSATION_FINAL_LINE_PATTERN = /^(?:bye|goodbye)[.!。！]?$/iu;
const MAX_REPLIES_PER_MINUTE = 10;
const MAX_REPLIES_PER_HOUR = 100;
// Inbound verbatim retransmissions: the 2nd consecutive copy is absorbed
// (loop protection); the 3rd runs again as an insistent re-ask (IDBots parity).
const INBOUND_REPEAT_ESCALATION_AFTER = 3;
const WAKE_LOOP_INTERVAL_MS = 10_000;
const WAKE_TURN_BUSY_DEFER_MS = 60_000;
// Outbound-message extension markers for the chat-skill wait notice: they let
// retries dedupe against conversation history and let the staleness guard
// skip notices when checking whether a newer peer message has arrived.
const CHAT_SKILL_WAIT_NOTICE_EXTENSION = 'chatSkillWaitNotice';
const CHAT_SKILL_WAIT_NOTICE_FOR_EXTENSION = 'chatSkillWaitNoticeForMessageId';

// Host-side silence markers (chatNoReply / chatSilentTail, defined in
// privateChatLoopGuards) record a turn that deliberately delivered nothing.
// They are local-only: never pinned, never shown to the peer, and they must
// not read as an answer for staleness checks or prompt history.
function isHostSilenceMarker(message: PrivateChatMessage): boolean {
  return Boolean(
    message.direction === 'outbound'
    && (
      message.extensions?.[CHAT_NO_REPLY_EXTENSION] === true
      || message.extensions?.[CHAT_SILENT_TAIL_EXTENSION] === true
    ),
  );
}

// Bot-initiated interim updates (ticket-gated, IDBots send_private_chat
// parity): real delivered text for the peer, but never the turn's answer.
// Staleness checks must not read them as "the final reply already went out".
function isChatInterimMessage(message: PrivateChatMessage): boolean {
  return Boolean(
    message.direction === 'outbound'
    && message.extensions?.[CHAT_INTERIM_EXTENSION] === true,
  );
}

function hasSentChatSkillWaitNotice(
  messages: PrivateChatMessage[],
  forMessageId: string,
): boolean {
  return messages.some((message) => (
    message.direction === 'outbound'
    && message.extensions?.[CHAT_SKILL_WAIT_NOTICE_EXTENSION] === true
    && message.extensions?.[CHAT_SKILL_WAIT_NOTICE_FOR_EXTENSION] === forMessageId
  ));
}

// Order-protocol records (ORDER/ORDER_STATUS/DELIVERY/NeedsRating/ORDER_END)
// and OpenTeam recruitment envelopes are service traffic, not conversation.
// Keep them out of the LLM chat context so a completed service exchange does
// not read as a finished conversation and nudge the model into closing early.
// Host-side silence markers are dropped too: the sentinel carries no
// conversational value — the Silence Protocol prompt section governs when to
// use it, and past uses must not echo through the history.
function filterChatPromptMessages(messages: PrivateChatMessage[]): PrivateChatMessage[] {
  return messages.filter((message) => (
    classifySimplemsgContent(message.content).kind === 'private_chat'
    && !isHostSilenceMarker(message)
  ));
}

export interface PrivateChatAutoReplyDependencies {
  stateStore: PrivateChatStateStore;
  strategyStore: ChatStrategyStore;
  paths: MetabotPaths;
  signer: Signer;
  selfGlobalMetaId: () => Promise<string | null>;
  resolvePeerChatPublicKey: (globalMetaId: string) => Promise<string | null>;
  replyRunner: ChatReplyRunner;
  a2aConversationPersister?: A2AConversationMessagePersister;
  logSendFailure?: (event: PrivateChatSendFailureEvent) => void;
  // IDBots hasActiveOrderForPrivateChatSuppression parity: while an order with
  // the peer is being negotiated/executed, inbound free-chat messages are
  // still recorded but get no auto-reply (and no turn counting), so the LLM
  // cannot chime in between order-protocol messages. Operator guided turns
  // are never suppressed. Absent = never suppress.
  hasActiveOrderWithPeer?: (peerGlobalMetaId: string) => Promise<boolean>;
  // Generates the persona-voiced "please wait" notice sent to the peer once
  // per inbound message when an allowed chat skill actually starts executing
  // (IDBots-style interim reply). Null/absent disables the notice.
  chatSkillWaitNotice?: ChatSkillWaitNoticeGenerator | null;
  // Persistence for silent-tail wake timers (IDBots parity). Auto-created
  // from `paths` when absent so every orchestrator gets wakes by default.
  wakeStore?: PrivateChatWakeStore;
  now?: () => number;
}

export interface PrivateChatAutoReplyOrchestrator {
  handleInboundMessage(message: PrivateChatInboundMessage): Promise<void>;
  retryPendingInboundMessage(peerGlobalMetaId: string): Promise<boolean>;
  retryOutboundMessage(
    peerGlobalMetaId: string,
    message: PrivateChatMessage,
  ): Promise<boolean>;
  handleLocalGuidedTurn(
    peerGlobalMetaId: string,
    options?: {
      guidanceToConsume?: PrivateChatPendingGuidanceClaim | null;
    },
  ): Promise<void>;
  // Runs every wake record whose fire time is due (wake checks for silent
  // conversation tails and empty-reply retries). Returns how many wake turns
  // actually ran; the internal ticker calls this on an interval.
  fireDueWakes(): Promise<number>;
  startWakeLoop(): void;
  stopWakeLoop(): void;
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
  kind: 'reply' | 'no_reply' | 'empty_reply';
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

// The simplemsg wire format wraps extension-carrying messages as
// {"content": "...", "extensions": {...}}. Inbound records must store the
// unwrapped text (like outbound records do), otherwise raw JSON leaks into
// the LLM prompt history. Exported so prompt builders can also unwrap
// legacy records that were stored with the wrapper still on.
export function unwrapPrivateChatContent(raw: string): {
  content: string;
  extensions: Record<string, unknown> | null;
} {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      parsed
      && typeof parsed === 'object'
      && !Array.isArray(parsed)
      && typeof parsed.content === 'string'
      && Object.hasOwn(parsed, 'extensions')
    ) {
      return {
        content: parsed.content,
        extensions: (parsed.extensions as Record<string, unknown> | null) ?? null,
      };
    }
  } catch {
    // Not a wrapper payload.
  }
  return { content: raw, extensions: null };
}

// Prompt-context helper: unwrap legacy inbound records whose stored content
// still carries the {"content","extensions"} wire wrapper, so every consumer
// downstream (history rendering, notice dedupe, moved-past checks) sees plain
// text. New records are already stored unwrapped; this is idempotent.
function unwrapLegacyInboundContents(messages: PrivateChatMessage[]): PrivateChatMessage[] {
  return messages.map((message) => (
    message.direction === 'inbound'
      ? { ...message, content: unwrapPrivateChatContent(message.content).content }
      : message
  ));
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

// Drop a trailing close marker from an outbound turn that must not close the
// conversation (session-opening guided turns); the farewell text above it
// stays, only the marker line is removed.
function stripFinalByeLine(value: string): string {
  const lines = value.split(/\r?\n/u);
  const finalIndex = findFinalNonEmptyLineIndex(lines);
  if (finalIndex >= 0 && CLOSE_CONVERSATION_FINAL_LINE_PATTERN.test(lines[finalIndex].trim())) {
    lines.splice(finalIndex, 1);
  }
  return lines.join('\n').trim();
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
  // Scan a small tail instead of only the very last record: our own interim
  // chat-skill wait notices and host-side silence markers are appended to the
  // store while the turn is still being composed, and must not count as "a
  // newer message arrived".
  const latestMessages = await input.stateStore.getRecentMessages(input.conversationId, 5);
  const latestSignificantMessage = [...latestMessages].reverse().find((message) => !(
    message.direction === 'outbound'
    && (
      message.extensions?.[CHAT_SKILL_WAIT_NOTICE_EXTENSION] === true
      || isHostSilenceMarker(message)
      || isChatInterimMessage(message)
    )
  ));
  return Boolean(latestSignificantMessage && latestSignificantMessage.messageId === input.expectedMessageId);
}

function checkRateLimit(rateLimiter: RateLimiterState, now: number): boolean {
  const oneMinuteAgo = now - 60_000;
  const oneHourAgo = now - 3_600_000;
  rateLimiter.replyTimestamps = rateLimiter.replyTimestamps.filter(t => t > oneHourAgo);

  const repliesLastMinute = rateLimiter.replyTimestamps.filter(t => t > oneMinuteAgo).length;
  const repliesLastHour = rateLimiter.replyTimestamps.length;

  return repliesLastMinute < MAX_REPLIES_PER_MINUTE && repliesLastHour < MAX_REPLIES_PER_HOUR;
}

// True when the conversation has moved past the given message: either a
// newer inbound arrived (only the latest message of a burst should be
// answered, IDBots-style) or a non-notice outbound already answered it. Used
// both to skip queued reply turns BEFORE paying for an LLM call and as the
// commit-time staleness guard before sending. Host-side silence markers
// (chatNoReply / chatSilentTail) and ticket-gated interim updates never
// answer a message — a wake turn must still be able to re-drive the tail
// they sit behind.
async function conversationMovedPastMessage(input: {
  stateStore: PrivateChatStateStore;
  conversationId: string;
  messageId: string;
}): Promise<boolean> {
  const recentMessages = await input.stateStore.getRecentMessages(input.conversationId, 20);
  const triggerIndex = recentMessages.findIndex((message) => message.messageId === input.messageId);
  if (triggerIndex < 0) {
    return false;
  }
  return recentMessages.slice(triggerIndex + 1).some((message) => (
    message.direction === 'inbound'
    || (
      message.direction === 'outbound'
      && message.extensions?.[CHAT_SKILL_WAIT_NOTICE_EXTENSION] !== true
      && !isHostSilenceMarker(message)
      && !isChatInterimMessage(message)
    )
  ));
}

// Per-bot config values win over strategy values; the defaults are the last
// resort for runtime configs constructed without the new fields.
function resolveEffectiveStrategy(
  strategy: ChatStrategy | null,
  config: PrivateChatAutoReplyConfig,
): ChatStrategy {
  return {
    id: strategy?.id ?? 'default',
    maxTurns: config.maxTurns ?? strategy?.maxTurns ?? DEFAULT_MAX_TURNS,
    maxIdleMs: config.cooldownMs ?? strategy?.maxIdleMs ?? DEFAULT_MAX_IDLE_MS,
    exitCriteria: strategy?.exitCriteria ?? '',
  };
}

export function createPrivateChatAutoReplyOrchestrator(
  deps: PrivateChatAutoReplyDependencies,
  config: PrivateChatAutoReplyConfig,
): PrivateChatAutoReplyOrchestrator {
  const rateLimiter: RateLimiterState = { replyTimestamps: [] };
  const activeInboundReplies = new Set<string>();
  const getNow = deps.now ?? (() => Date.now());
  const wakeStore = deps.wakeStore ?? createPrivateChatWakeStore(deps.paths);
  const wakeDelaysMs = Array.isArray(config.wakeDelaysMs) && config.wakeDelaysMs.length > 0
    ? config.wakeDelaysMs
    : null;
  // Consecutive verbatim-identical inbound copies per conversation: the 2nd
  // copy is absorbed (loop protection), the 3rd runs as an insistent re-ask
  // (IDBots inbound retransmission escalation). Entries reset when a different
  // plaintext arrives or the session gap lapses.
  const inboundRepeatTracker = new Map<string, { content: string; count: number; firstAt: number }>();

  // Reply turns are serialized per conversation: back-to-back inbound messages
  // must not spawn concurrent LLM turns (lost turnCount increments, replies
  // discarded only after the LLM call was paid for). Different conversations
  // still run concurrently. The chain never wedges on a rejected promise and
  // entries are removed once drained.
  const conversationTurnChains = new Map<string, Promise<unknown>>();
  async function runSerializedConversationTurn<T>(
    conversationId: string,
    turn: () => Promise<T>,
  ): Promise<T> {
    const previous = conversationTurnChains.get(conversationId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(turn);
    conversationTurnChains.set(conversationId, current);
    try {
      return await current;
    } finally {
      if (conversationTurnChains.get(conversationId) === current) {
        conversationTurnChains.delete(conversationId);
      }
    }
  }

  // ---- Host-side silence bookkeeping (IDBots [NO_REPLY] / silent-tail parity) ----

  // Records that a turn deliberately delivered nothing: a local-only marker
  // message plus a conversation update that flips lastDirection back to
  // 'outbound' so the backfill's unanswered-tail recovery and every
  // moved-past guard treat the tail as handled — only wake timers may
  // re-drive it. Never pinned, never shown to the peer.
  async function recordSilentTail(input: {
    conversation: PrivateChatConversation;
    selfGlobalMetaId: string;
    marker: 'no_reply' | 'silent_tail';
    triggerMessageId: string;
  }): Promise<void> {
    try {
      const timestamp = getNow();
      const extensions: Record<string, unknown> = input.marker === 'no_reply'
        ? { [CHAT_NO_REPLY_EXTENSION]: true }
        : { [CHAT_SILENT_TAIL_EXTENSION]: true };
      extensions.chatSilentTailForMessageId = input.triggerMessageId;
      const markerRecord: PrivateChatMessage = {
        conversationId: input.conversation.conversationId,
        messageId: buildMessageId(timestamp),
        direction: 'outbound',
        senderGlobalMetaId: input.selfGlobalMetaId,
        content: input.marker === 'no_reply' ? '[NO_REPLY]' : '',
        messagePinId: null,
        extensions,
        timestamp,
      };
      await deps.stateStore.appendMessages([markerRecord]).catch(() => undefined);
      const latestConversation = await deps.stateStore.getConversationByPeer(input.conversation.peerGlobalMetaId);
      if (latestConversation) {
        await deps.stateStore.upsertConversation({
          ...latestConversation,
          lastDirection: 'outbound',
          updatedAt: timestamp,
        });
      }
    } catch {
      // Silence bookkeeping must never break the reply loop.
    }
  }

  // Local-only host status line (IDBots "[Host] …" bubbles parity): recorded
  // in the UI-facing A2A store only — never pinned on-chain, never part of
  // the LLM context, rendered as an internal status line by the UIs.
  async function recordHostStatusMessage(input: {
    selfGlobalMetaId: string;
    peerGlobalMetaId: string;
    text: string;
  }): Promise<void> {
    const timestamp = getNow();
    await persistA2AConversationMessageBestEffort({
      paths: deps.paths,
      local: {
        globalMetaId: input.selfGlobalMetaId,
      },
      peer: {
        globalMetaId: input.peerGlobalMetaId,
      },
      message: {
        messageId: `host-${buildMessageId(timestamp)}`,
        direction: 'outgoing',
        content: input.text,
        timestamp,
        hostStatus: true,
      },
    }, deps.a2aConversationPersister).catch(() => undefined);
  }

  // Arms (or advances) the bounded wake for a silent tail. Returns false when
  // the wake budget for that kind is exhausted.
  async function scheduleSilentTailWake(input: {
    conversation: PrivateChatConversation;
    peerGlobalMetaId: string;
    triggerMessageId: string;
    kind: 'silent_tail' | 'empty_reply';
  }): Promise<boolean> {
    try {
      if (!config.enabled) return false;
      const existing = (await wakeStore.readWakes())
        .find((record) => record.conversationId === input.conversation.conversationId) ?? null;
      const continues = existing !== null
        && existing.kind === input.kind
        && existing.triggerMessageId === input.triggerMessageId;
      const fires = continues ? existing!.fires + 1 : 0;
      const scheduled = await wakeStore.schedule({
        conversationId: input.conversation.conversationId,
        peerGlobalMetaId: input.peerGlobalMetaId,
        triggerMessageId: input.triggerMessageId,
        kind: input.kind,
        fires,
        delays: input.kind === 'empty_reply'
          ? DEFAULT_EMPTY_REPLY_RETRY_DELAYS_MS
          : (wakeDelaysMs ?? undefined),
        now: getNow(),
      });
      if (!scheduled) {
        // Budget exhausted: drop the record so the sweep does not re-fire a
        // wake whose schedule can no longer advance.
        await wakeStore.remove(input.conversation.conversationId).catch(() => undefined);
      }
      return scheduled !== null;
    } catch {
      return false;
    }
  }

  async function sendReplyMessage(
    selfGlobalMetaId: string,
    peerGlobalMetaId: string,
    content: string,
    extensions: Record<string, unknown> | null,
  ): Promise<SentPrivateChatReply | null> {
    let privateChatIdentity;
    try {
      privateChatIdentity = await deps.signer.getPrivateChatIdentity();
    } catch (error) {
      deps.logSendFailure?.({
        kind: 'identity_unavailable',
        peerGlobalMetaId,
        error: describePrivateChatSendFailureError(error),
      });
      return null;
    }

    let peerChatPublicKey: string | null = null;
    try {
      peerChatPublicKey = await deps.resolvePeerChatPublicKey(peerGlobalMetaId);
    } catch (error) {
      deps.logSendFailure?.({
        kind: 'peer_chat_key_unavailable',
        peerGlobalMetaId,
        error: describePrivateChatSendFailureError(error),
      });
      return null;
    }
    if (!peerChatPublicKey) {
      deps.logSendFailure?.({
        kind: 'peer_chat_key_unavailable',
        peerGlobalMetaId,
        error: null,
      });
      return null;
    }

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
    } catch (error) {
      deps.logSendFailure?.({
        kind: 'pin_write_failed',
        peerGlobalMetaId,
        error: describePrivateChatSendFailureError(error),
      });
      return null;
    }
  }

  // Sends the interim "please wait" notice for a chat-skill execution and
  // records it like a normal outbound message, so conversation history (and
  // later retry dedupe) reflects what the peer actually saw.
  async function sendChatSkillWaitNotice(input: {
    selfGlobalMetaId: string;
    peerGlobalMetaId: string;
    conversation: PrivateChatConversation;
    inboundMessage: PrivateChatMessage;
    persona: Awaited<ReturnType<typeof loadChatPersona>>;
  }): Promise<void> {
    if (!deps.chatSkillWaitNotice) return;
    try {
      const text = normalizeText(await deps.chatSkillWaitNotice({
        conversation: input.conversation,
        inboundMessage: input.inboundMessage,
        persona: input.persona,
      }));
      if (!text) return;
      const extensions: Record<string, unknown> = {
        [CHAT_SKILL_WAIT_NOTICE_EXTENSION]: true,
        [CHAT_SKILL_WAIT_NOTICE_FOR_EXTENSION]: input.inboundMessage.messageId,
      };
      const sent = await sendReplyMessage(
        input.selfGlobalMetaId,
        input.peerGlobalMetaId,
        text,
        extensions,
      );
      if (!sent) return;
      const timestamp = getNow();
      const outboundRecord: PrivateChatMessage = {
        conversationId: input.conversation.conversationId,
        messageId: sent.pinId || buildMessageId(timestamp),
        direction: 'outbound',
        senderGlobalMetaId: input.selfGlobalMetaId,
        content: text,
        messagePinId: sent.pinId,
        extensions,
        timestamp,
      };
      await deps.stateStore.appendMessages([outboundRecord]).catch(() => undefined);
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
          txid: sent.txids[0] ?? null,
          txids: sent.txids,
          chain: sent.network ?? 'mvc',
          timestamp: outboundRecord.timestamp,
        },
      }, deps.a2aConversationPersister);
    } catch {
      // The wait notice is strictly best-effort; skill execution continues.
    }
  }

  async function prepareOutboundTurn(input: {
    conversation: PrivateChatConversation;
    recentMessages: PrivateChatMessage[];
    persona: Awaited<ReturnType<typeof loadChatPersona>>;
    strategy: Awaited<ReturnType<ChatStrategyStore['getStrategy']>>;
    inboundMessage: PrivateChatMessage | null;
    operatorGuidanceText?: string | null;
    conversationCloseAllowed?: boolean;
    onSkillExecutionStart?: () => void;
    memoryContext?: string | null;
    hostNoticeText?: string | null;
  }): Promise<PreparedOutboundTurn | null> {
    const conversationCloseAllowed = input.conversationCloseAllowed !== false;
    let runnerResult;
    try {
      runnerResult = await deps.replyRunner({
        conversation: input.conversation,
        recentMessages: input.recentMessages,
        persona: input.persona,
        strategy: input.strategy,
        inboundMessage: input.inboundMessage,
        operatorGuidanceText: input.operatorGuidanceText ?? null,
        conversationCloseAllowed,
        onSkillExecutionStart: input.onSkillExecutionStart,
        memoryContext: input.memoryContext ?? null,
        hostNoticeText: input.hostNoticeText ?? null,
      });
    } catch (error) {
      // Never let a throwing runner crash the daemon loop, but never leave the
      // peer's silence unexplained either.
      deps.logSendFailure?.({
        kind: 'reply_runner_failed',
        peerGlobalMetaId: input.conversation.peerGlobalMetaId,
        error: describePrivateChatSendFailureError(error),
      });
      return null;
    }

    if (runnerResult.state === 'skip') {
      return null;
    }
    if (runnerResult.state === 'no_reply') {
      return { kind: 'no_reply', content: '', extensions: null, shouldClose: false };
    }
    if (runnerResult.state === 'empty_reply') {
      return { kind: 'empty_reply', content: '', extensions: null, shouldClose: false };
    }

    let content = normalizeText(runnerResult.content);
    let shouldClose = runnerResult.state === 'end_conversation' || hasFinalByeLine(content);
    if (shouldClose && !conversationCloseAllowed) {
      content = normalizeText(stripFinalByeLine(content));
      shouldClose = false;
    }
    if (shouldClose) {
      content = ensureFinalByeLine(content);
    }
    if (!content) {
      // Defensive: a 'reply' state without usable text behaves like an empty
      // completion — retryable, never delivered.
      return { kind: 'empty_reply', content: '', extensions: null, shouldClose: false };
    }

    return {
      kind: 'reply',
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
        && await conversationMovedPastMessage({
          stateStore: deps.stateStore,
          conversationId: input.conversation.conversationId,
          messageId: input.triggerMessageId,
        })
      ) {
        if (input.guidanceToConsume) {
          await deps.stateStore.releasePendingGuidanceClaimIfMatches(
            input.conversation.conversationId,
            input.guidanceToConsume,
          ).catch(() => null);
        }
        return null;
      }
      // Delivery lifecycle (IDBots parity): the outgoing bubble appears in
      // the UI-facing A2A store as pending the moment the turn commits to
      // sending; the same record (same messageId) is then replaced with
      // sent/failed once the chain write settles.
      const pendingTimestamp = getNow();
      const outgoingMessageId = buildMessageId(pendingTimestamp);
      await persistA2AConversationMessageBestEffort({
        paths: deps.paths,
        local: {
          globalMetaId: input.selfGlobalMetaId,
        },
        peer: {
          globalMetaId: input.peerGlobalMetaId,
        },
        message: {
          messageId: outgoingMessageId,
          direction: 'outgoing',
          content: input.content,
          timestamp: pendingTimestamp,
          deliveryStatus: 'pending',
        },
      }, deps.a2aConversationPersister);

      outboundReply = await sendReplyMessage(
        input.selfGlobalMetaId,
        input.peerGlobalMetaId,
        input.content,
        input.extensions,
      );
      if (!outboundReply) {
        await persistA2AConversationMessageBestEffort({
          paths: deps.paths,
          local: {
            globalMetaId: input.selfGlobalMetaId,
          },
          peer: {
            globalMetaId: input.peerGlobalMetaId,
          },
          message: {
            messageId: outgoingMessageId,
            direction: 'outgoing',
            content: input.content,
            timestamp: pendingTimestamp,
            deliveryStatus: 'failed',
            deliveryError: 'chain write failed',
          },
          replaceExistingMessage: true,
        }, deps.a2aConversationPersister);
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
        messageId: outgoingMessageId,
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
          deliveryStatus: 'sent',
        },
        replaceExistingMessage: true,
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

      // A delivered reply answers the conversation tail: any pending wake for
      // it is obsolete.
      await wakeStore.remove(input.conversation.conversationId).catch(() => undefined);

      if (input.guidanceToConsume) {
        updatedConversation = await deps.stateStore.clearPendingGuidanceIfMatches(
          input.conversation.conversationId,
          input.guidanceToConsume.guidanceText,
          input.guidanceToConsume.createdAt,
          input.guidanceToConsume.leaseId,
        ) ?? updatedConversation;
      }

      return updatedConversation;
    } catch (error) {
      deps.logSendFailure?.({
        kind: 'reply_commit_failed',
        peerGlobalMetaId: input.peerGlobalMetaId,
        error: describePrivateChatSendFailureError(error),
      });
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

  async function replyToInboundMessage(input: {
    selfGlobalMetaId: string;
    peerGlobalMetaId: string;
    conversation: PrivateChatConversation;
    inboundMessage: PrivateChatMessage;
    strategy: Awaited<ReturnType<ChatStrategyStore['getStrategy']>>;
    // Host-injected notice for wake turns and empty-reply retries. Null for
    // plain inbound-driven turns.
    hostNoticeText?: string | null;
  }): Promise<boolean> {
    const replyKey = `${input.conversation.conversationId}:${input.inboundMessage.messageId}`;
    if (activeInboundReplies.has(replyKey)) return false;
    if (!checkRateLimit(rateLimiter, getNow())) {
      // A dropped reply is peer-visible silence; make it diagnosable. The
      // backfill may retry this message later.
      deps.logSendFailure?.({
        kind: 'rate_limited',
        peerGlobalMetaId: input.peerGlobalMetaId,
        error: `reply rate limit exceeded (max ${MAX_REPLIES_PER_MINUTE}/min, ${MAX_REPLIES_PER_HOUR}/h)`,
      });
      return false;
    }

    // This turn may have waited in the per-conversation queue while the
    // conversation moved on (a newer inbound arrived, or an earlier turn
    // already answered this message). Skip it BEFORE paying for an LLM call;
    // the commit-time guard applies the same moved-past check before sending.
    if (await conversationMovedPastMessage({
      stateStore: deps.stateStore,
      conversationId: input.conversation.conversationId,
      messageId: input.inboundMessage.messageId,
    })) {
      return false;
    }

    activeInboundReplies.add(replyKey);
    // Live activity (IDBots StreamingActivityBar parity): the UI shows a
    // "local bot is working" indicator while this turn composes.
    publishA2AConversationReplyState({
      type: 'conversation-reply-state',
      localGlobalMetaId: input.selfGlobalMetaId,
      peerGlobalMetaId: input.peerGlobalMetaId,
      replying: true,
      timestamp: getNow(),
    });
    try {
      const guidanceWasPending = Boolean(
        normalizeText(input.conversation.pendingGuidanceText)
        && typeof input.conversation.pendingGuidanceCreatedAt === 'number',
      );
      const guidanceToConsume = guidanceWasPending
        ? await deps.stateStore.claimPendingGuidance(
          input.conversation.conversationId,
          { now: getNow() },
        )
        : null;
      if (guidanceWasPending && !guidanceToConsume) return false;

      const maxTurns = input.strategy?.maxTurns ?? DEFAULT_MAX_TURNS;
      if (input.conversation.turnCount >= maxTurns && !guidanceToConsume) {
        const committedConversation = await commitOutboundTurn({
          selfGlobalMetaId: input.selfGlobalMetaId,
          peerGlobalMetaId: input.peerGlobalMetaId,
          conversation: input.conversation,
          content: ensureFinalByeLine('It was great chatting with you. Let us continue another time.'),
          extensions: null,
          shouldClose: true,
          triggerMessageId: input.inboundMessage.messageId,
        });
        if (!committedConversation) return false;
        rateLimiter.replyTimestamps.push(getNow());
        return true;
      }

      const persona = await loadChatPersona(deps.paths);
      const recentMessages = unwrapLegacyInboundContents(filterChatPromptMessages(
        selectPrivateChatPromptContextMessages(
          await deps.stateStore.getRecentMessages(
            input.conversation.conversationId,
            DEFAULT_RECENT_MESSAGES_LIMIT,
          ),
          {
            activeLimit: ACTIVE_SEGMENT_MESSAGES_LIMIT,
            previousLimit: PREVIOUS_SEGMENT_MESSAGES_LIMIT,
            gapMs: input.strategy?.maxIdleMs ?? DEFAULT_MAX_IDLE_MS,
          },
        ),
      ));
      // Interim "please wait" notice (IDBots-style): fired by the reply runner
      // when an allowed chat skill actually starts executing. Sent at most once
      // per inbound message, deduped against history so a later retry of the
      // same message does not re-notify the peer.
      const waitNoticeState: { sent: boolean; promise: Promise<void> | null } = {
        sent: false,
        promise: null,
      };
      const onSkillExecutionStart = deps.chatSkillWaitNotice
        ? () => {
          if (waitNoticeState.sent) return;
          waitNoticeState.sent = true;
          if (hasSentChatSkillWaitNotice(recentMessages, input.inboundMessage.messageId)) return;
          waitNoticeState.promise = sendChatSkillWaitNotice({
            selfGlobalMetaId: input.selfGlobalMetaId,
            peerGlobalMetaId: input.peerGlobalMetaId,
            conversation: input.conversation,
            inboundMessage: input.inboundMessage,
            persona,
          });
        }
        : undefined;
      const preparedTurn = await prepareOutboundTurn({
        conversation: input.conversation,
        recentMessages,
        persona,
        strategy: input.strategy,
        inboundMessage: input.inboundMessage,
        operatorGuidanceText: guidanceToConsume?.guidanceText ?? null,
        onSkillExecutionStart,
        hostNoticeText: input.hostNoticeText ?? null,
        memoryContext: await buildPrivateReplyMemoryContext(deps.paths, {
          peerGlobalMetaId: input.peerGlobalMetaId,
          userText: normalizeText(input.inboundMessage.content),
        }),
      });
      if (!preparedTurn) {
        if (guidanceToConsume) {
          await deps.stateStore.releasePendingGuidanceClaimIfMatches(
            input.conversation.conversationId,
            guidanceToConsume,
          );
        }
        return false;
      }

      // The model deliberately chose silence ([NO_REPLY]): record a local
      // marker so nothing re-drives the tail except a bounded wake, then arm
      // that wake — the model may owe the peer a deferred answer.
      if (preparedTurn.kind === 'no_reply') {
        await recordSilentTail({
          conversation: input.conversation,
          selfGlobalMetaId: input.selfGlobalMetaId,
          marker: 'no_reply',
          triggerMessageId: input.inboundMessage.messageId,
        });
        if (guidanceToConsume) {
          await deps.stateStore.releasePendingGuidanceClaimIfMatches(
            input.conversation.conversationId,
            guidanceToConsume,
          );
        }
        await scheduleSilentTailWake({
          conversation: input.conversation,
          peerGlobalMetaId: input.peerGlobalMetaId,
          triggerMessageId: input.inboundMessage.messageId,
          kind: 'silent_tail',
        });
        return true;
      }

      // The LLM completed without any final text (reasoning-only completion):
      // nothing is deliverable. Record the silent tail and arm a bounded
      // retry that re-runs the turn with a host retry notice.
      if (preparedTurn.kind === 'empty_reply') {
        await recordSilentTail({
          conversation: input.conversation,
          selfGlobalMetaId: input.selfGlobalMetaId,
          marker: 'silent_tail',
          triggerMessageId: input.inboundMessage.messageId,
        });
        if (guidanceToConsume) {
          await deps.stateStore.releasePendingGuidanceClaimIfMatches(
            input.conversation.conversationId,
            guidanceToConsume,
          );
        }
        const scheduled = await scheduleSilentTailWake({
          conversation: input.conversation,
          peerGlobalMetaId: input.peerGlobalMetaId,
          triggerMessageId: input.inboundMessage.messageId,
          kind: 'empty_reply',
        });
        if (scheduled) {
          await recordHostStatusMessage({
            selfGlobalMetaId: input.selfGlobalMetaId,
            peerGlobalMetaId: input.peerGlobalMetaId,
            text: '[Host] Previous turn ended with no final reply text. A retry is scheduled.',
          });
        } else {
          deps.logSendFailure?.({
            kind: 'reply_empty_after_retries',
            peerGlobalMetaId: input.peerGlobalMetaId,
            error: 'reply turn produced no final reply text after all host retries',
          });
          await recordHostStatusMessage({
            selfGlobalMetaId: input.selfGlobalMetaId,
            peerGlobalMetaId: input.peerGlobalMetaId,
            text: '[Host] No final reply text was produced after all host retries.',
          });
        }
        return true;
      }

      // Echo guard (IDBots parity): a bot never needs to say the exact same
      // thing three times in a row. Once the delivered tail already shows two
      // verbatim-identical replies, a third identical one is an echo loop —
      // block the delivery and leave the tail silent.
      if (wouldCreatePrivateChatEchoLoop({
        messages: recentMessages,
        replyText: preparedTurn.content,
      })) {
        deps.logSendFailure?.({
          kind: 'echo_guard_blocked',
          peerGlobalMetaId: input.peerGlobalMetaId,
          error: 'reply blocked: verbatim echo of the last delivered replies',
        });
        await recordHostStatusMessage({
          selfGlobalMetaId: input.selfGlobalMetaId,
          peerGlobalMetaId: input.peerGlobalMetaId,
          text: '[Host] Reply withheld: it would repeat the last delivered message verbatim.',
        });
        await recordSilentTail({
          conversation: input.conversation,
          selfGlobalMetaId: input.selfGlobalMetaId,
          marker: 'silent_tail',
          triggerMessageId: input.inboundMessage.messageId,
        });
        if (guidanceToConsume) {
          await deps.stateStore.releasePendingGuidanceClaimIfMatches(
            input.conversation.conversationId,
            guidanceToConsume,
          );
        }
        return true;
      }

      // Keep wire order for the peer: the wait notice (if one went out during
      // the LLM turn) must settle before the final reply is sent.
      await waitNoticeState.promise;

      const committedConversation = await commitOutboundTurn({
        selfGlobalMetaId: input.selfGlobalMetaId,
        peerGlobalMetaId: input.peerGlobalMetaId,
        conversation: input.conversation,
        content: preparedTurn.content,
        extensions: preparedTurn.extensions,
        shouldClose: preparedTurn.shouldClose,
        triggerMessageId: input.inboundMessage.messageId,
        guidanceToConsume,
      });
      if (!committedConversation) return false;

      // Memory bookkeeping after a successful reply: extraction into the
      // contact scope + an experience record for the dream pipeline. Never
      // breaks the reply loop.
      await recordPrivateChatMemoryTurn(deps.paths, {
        selfGlobalMetaId: input.selfGlobalMetaId,
        peerGlobalMetaId: input.peerGlobalMetaId,
        conversationId: input.conversation.conversationId,
        inboundMessageId: input.inboundMessage.messageId,
        inboundPinId: input.inboundMessage.messagePinId ?? null,
        inboundTimestamp: input.inboundMessage.timestamp,
        userText: normalizeText(input.inboundMessage.content),
        assistantText: preparedTurn.content,
      });

      rateLimiter.replyTimestamps.push(getNow());
      return true;
    } finally {
      publishA2AConversationReplyState({
        type: 'conversation-reply-state',
        localGlobalMetaId: input.selfGlobalMetaId,
        peerGlobalMetaId: input.peerGlobalMetaId,
        replying: false,
        timestamp: getNow(),
      });
      activeInboundReplies.delete(replyKey);
    }
  }

  // ---- Wake loop: bounded re-drive of silent-but-open conversation tails ----

  let wakeLoopTimer: ReturnType<typeof setInterval> | null = null;
  let wakeSweepRunning = false;

  // Runs one due wake record. Returns true when a wake turn actually ran
  // (delivered a reply or re-marked the tail silent); false means the record
  // was obsolete (removed) or the turn could not run (deferred/busy).
  async function runWakeTurn(record: PrivateChatWakeRecord): Promise<boolean> {
    const conversation = await deps.stateStore.getConversationByPeer(record.peerGlobalMetaId);
    if (!conversation || conversation.state !== 'active') {
      await wakeStore.remove(record.conversationId).catch(() => undefined);
      return false;
    }
    // Only re-drive a tail that is still the tail: a newer message or a real
    // delivered answer cancels the wake instead.
    if (!(await latestConversationMessageMatches({
      stateStore: deps.stateStore,
      conversationId: record.conversationId,
      expectedMessageId: record.triggerMessageId,
    }))) {
      await wakeStore.remove(record.conversationId).catch(() => undefined);
      return false;
    }
    if (conversationTurnChains.has(record.conversationId)) {
      await wakeStore.deferFire(record.conversationId, WAKE_TURN_BUSY_DEFER_MS).catch(() => undefined);
      return false;
    }
    const selfGlobalMetaId = normalizeText(await deps.selfGlobalMetaId());
    if (!selfGlobalMetaId) {
      await wakeStore.deferFire(record.conversationId, WAKE_TURN_BUSY_DEFER_MS).catch(() => undefined);
      return false;
    }
    const triggerMessages = await deps.stateStore.getRecentMessages(record.conversationId, 5);
    const triggerMessage = triggerMessages.find(
      (message) => message.messageId === record.triggerMessageId,
    );
    if (!triggerMessage) {
      await wakeStore.remove(record.conversationId).catch(() => undefined);
      return false;
    }
    const strategy = resolveEffectiveStrategy(
      conversation.strategyId
        ? await deps.strategyStore.getStrategy(conversation.strategyId)
        : null,
      config,
    );
    await recordHostStatusMessage({
      selfGlobalMetaId,
      peerGlobalMetaId: record.peerGlobalMetaId,
      text: record.kind === 'empty_reply'
        ? `[Host] Retry ${record.fires + 1}: re-running the turn after an empty completion.`
        : `[Host] Wake check ${record.fires + 1}: re-evaluating the silent conversation tail.`,
    });
    const hostNoticeText = record.kind === 'empty_reply'
      ? buildPrivateChatEmptyReplyRetryNotice(record.fires + 1)
      : buildPrivateChatWakeNotice(record.fires + 1);
    return runSerializedConversationTurn(record.conversationId, () => replyToInboundMessage({
      selfGlobalMetaId,
      peerGlobalMetaId: record.peerGlobalMetaId,
      conversation,
      inboundMessage: triggerMessage,
      strategy,
      hostNoticeText,
    }));
  }

  async function fireDueWakes(): Promise<number> {
    if (!config.enabled) return 0;
    if (wakeSweepRunning) return 0;
    wakeSweepRunning = true;
    try {
      const due = (await wakeStore.readWakes()).filter((record) => record.fireAt <= getNow());
      let ran = 0;
      for (const record of due) {
        let ranTurn = false;
        try {
          ranTurn = await runWakeTurn(record);
        } catch {
          ranTurn = false;
        }
        if (ranTurn) {
          ran += 1;
        } else {
          // The turn could not run (busy, rate limited, transient runner
          // failure): push the fire time forward instead of hammering it on
          // every sweep. Records already removed as obsolete are untouched.
          await wakeStore.deferFire(record.conversationId, WAKE_TURN_BUSY_DEFER_MS).catch(() => undefined);
        }
      }
      return ran;
    } finally {
      wakeSweepRunning = false;
    }
  }

  function startWakeLoop(): void {
    if (wakeLoopTimer) return;
    wakeLoopTimer = setInterval(() => {
      void fireDueWakes().catch(() => undefined);
    }, WAKE_LOOP_INTERVAL_MS);
    wakeLoopTimer.unref?.();
  }

  function stopWakeLoop(): void {
    if (!wakeLoopTimer) return;
    clearInterval(wakeLoopTimer);
    wakeLoopTimer = null;
  }

  return {
    async retryPendingInboundMessage(peerGlobalMetaId) {
      if (!config.enabled) return false;
      const selfGlobalMetaId = normalizeText(await deps.selfGlobalMetaId());
      const normalizedPeerGlobalMetaId = normalizeText(peerGlobalMetaId);
      if (!selfGlobalMetaId || !normalizedPeerGlobalMetaId) return false;
      // Active-order suppression gates the recovery path too: a message that
      // arrived mid-order must not get a late free-chat reply while the order
      // is still open.
      if (await deps.hasActiveOrderWithPeer?.(normalizedPeerGlobalMetaId)) return false;

      const conversation = await deps.stateStore.getConversationByPeer(normalizedPeerGlobalMetaId);
      if (!conversation || conversation.state !== 'active' || conversation.lastDirection !== 'inbound') {
        return false;
      }
      // A live or queued reply turn for this conversation already covers the
      // pending message; recovery must not line up behind it.
      if (conversationTurnChains.has(conversation.conversationId)) {
        return false;
      }
      const [latestMessage] = await deps.stateStore.getRecentMessages(conversation.conversationId, 1);
      if (
        !latestMessage
        || latestMessage.direction !== 'inbound'
        || hasFinalByeLine(latestMessage.content)
        || classifySimplemsgContent(latestMessage.content).kind !== 'private_chat'
      ) {
        return false;
      }
      const strategy = resolveEffectiveStrategy(
        conversation.strategyId
          ? await deps.strategyStore.getStrategy(conversation.strategyId)
          : null,
        config,
      );
      return runSerializedConversationTurn(conversation.conversationId, () => replyToInboundMessage({
        selfGlobalMetaId,
        peerGlobalMetaId: normalizedPeerGlobalMetaId,
        conversation,
        inboundMessage: latestMessage,
        strategy,
      }));
    },
    async retryOutboundMessage(peerGlobalMetaId, message) {
      if (message.direction !== 'outbound') return false;
      const selfGlobalMetaId = normalizeText(await deps.selfGlobalMetaId());
      const normalizedPeerGlobalMetaId = normalizeText(peerGlobalMetaId);
      if (!selfGlobalMetaId || !normalizedPeerGlobalMetaId) return false;
      if (!(await latestConversationMessageMatches({
        stateStore: deps.stateStore,
        conversationId: message.conversationId,
        expectedMessageId: message.messageId,
      }))) {
        return false;
      }

      const outboundReply = await sendReplyMessage(
        selfGlobalMetaId,
        normalizedPeerGlobalMetaId,
        message.content,
        message.extensions,
      );
      if (!outboundReply) return false;

      const timestamp = getNow();
      const failedPinIds = Array.from(new Set([
        ...(message.deliveryRecovery?.failedPinIds ?? []),
        normalizeText(message.messagePinId),
      ].filter(Boolean)));
      const deliveryRecovery = {
        failedPinIds,
        retryCount: (message.deliveryRecovery?.retryCount ?? 0) + 1,
      };
      const replacement: PrivateChatMessage = {
        ...message,
        senderGlobalMetaId: selfGlobalMetaId,
        messagePinId: outboundReply.pinId,
        timestamp,
        deliveryRecovery,
      };
      const replaced = await deps.stateStore.replaceMessage(message.messageId, replacement);
      if (!replaced) return false;

      await persistA2AConversationMessageBestEffort({
        paths: deps.paths,
        local: {
          globalMetaId: selfGlobalMetaId,
        },
        peer: {
          globalMetaId: normalizedPeerGlobalMetaId,
        },
        message: {
          messageId: message.messageId,
          direction: 'outgoing',
          content: message.content,
          pinId: outboundReply.pinId,
          txid: outboundReply.txids[0] ?? null,
          txids: outboundReply.txids,
          chain: outboundReply.network ?? 'mvc',
          timestamp,
          raw: { deliveryRecovery },
        },
        replaceExistingMessage: true,
      }, deps.a2aConversationPersister);

      const conversation = await deps.stateStore.getConversationByPeer(normalizedPeerGlobalMetaId);
      if (conversation) {
        await deps.stateStore.upsertConversation({
          ...conversation,
          lastDirection: 'outbound',
          updatedAt: timestamp,
        });
      }
      return true;
    },
    async handleInboundMessage(message) {
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

      const strategy = resolveEffectiveStrategy(
        conversation.strategyId
          ? await deps.strategyStore.getStrategy(conversation.strategyId)
          : null,
        config,
      );
      const maxIdleMs = strategy.maxIdleMs;
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

      // Unwrap the {"content","extensions"} wire envelope up front so
      // classification, the Bye check, the stored record, and the LLM prompt
      // all see plain text instead of raw JSON.
      const inboundWireContent = unwrapPrivateChatContent(message.content);
      const simplemsgClassification = classifySimplemsgContent(inboundWireContent.content);

      const inboundMessageRecord: PrivateChatMessage = {
        conversationId: conversation.conversationId,
        messageId: message.messagePinId || buildMessageId(now),
        direction: 'inbound',
        senderGlobalMetaId: peerGlobalMetaId,
        content: inboundWireContent.content,
        messagePinId: message.messagePinId,
        extensions: inboundWireContent.extensions,
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

      // Any new peer message owns the conversation tail now: pending wakes for
      // an older silent tail are obsolete (IDBots wake cancellation parity).
      await wakeStore.remove(conversation.conversationId).catch(() => undefined);

      if (conversation.state === 'closed') {
        await deps.stateStore.upsertConversation(conversation);
        return;
      }

      // ---- Order-protocol path: record-only, no turn counting, no reply ----

      if (simplemsgClassification.kind === 'order_protocol') {
        await deps.stateStore.upsertConversation(conversation);
        return;
      }

      // ---- OpenTeam envelope path: record-only, handled by the group-task
      // engine (IDBots interceptOpenTeamEnvelope parity — never reaches LLM) ----

      if (simplemsgClassification.kind === 'openteam_envelope') {
        await deps.stateStore.upsertConversation(conversation);
        return;
      }

      // Inbound messages are always persisted above so they stay visible and
      // recoverable; only the automated reply is gated by the enabled flag.
      if (!config.enabled) return;

      // ---- Active-order suppression: record-only, no turn counting, no reply ----

      // While an order with this peer is open, free-chat auto-replies stay
      // silent (IDBots hasActiveOrderForPrivateChatSuppression parity). The
      // message is already persisted; like the order-protocol path above it
      // does not count turns. Suppression lifts automatically once the order
      // reaches a terminal state.
      if (await deps.hasActiveOrderWithPeer?.(peerGlobalMetaId)) {
        await deps.stateStore.upsertConversation(conversation);
        return;
      }

      // ---- Private-chat path: turn counting, cooldown, reply runner ----

      // Skip-list inbound (placeholder chatter, a peer host's silence
      // sentinel, a bare goodbye): record-only, no turn, no reply (IDBots
      // shouldSkipPrivateChatAutoReplyText parity). A bare goodbye still
      // closes the conversation — the peer meant to end it.
      if (shouldSkipPrivateChatAutoReplyText(inboundWireContent.content)) {
        if (hasFinalByeLine(inboundWireContent.content)) {
          conversation = { ...conversation, state: 'closed', updatedAt: now };
        }
        await deps.stateStore.upsertConversation(conversation);
        return;
      }

      // Verbatim inbound retransmission handling (IDBots parity): a
      // consecutive identical copy inside the session gap is a retransmission
      // echo — the first copy already drove (or is driving) a reply turn. The
      // 2nd copy is absorbed; the 3rd consecutive copy runs again as an
      // insistent re-ask. The current record is excluded by id so the scan
      // finds the previous inbound even when our own reply sits between.
      const recentForRepeat = (await deps.stateStore.getRecentMessages(conversation.conversationId, 10))
        .filter((message) => message.messageId !== inboundMessageRecord.messageId);
      if (isRepeatInboundPrivateChatMessage({
        messages: recentForRepeat,
        content: inboundWireContent.content,
        now,
        gapMs: maxIdleMs,
        defaultGapMs: DEFAULT_MAX_IDLE_MS,
      })) {
        const previousRepeat = inboundRepeatTracker.get(conversation.conversationId);
        const consecutiveRepeatCount = previousRepeat
          && previousRepeat.content === inboundWireContent.content.trim()
          ? previousRepeat.count + 1
          : 2;
        if (consecutiveRepeatCount < INBOUND_REPEAT_ESCALATION_AFTER) {
          inboundRepeatTracker.set(conversation.conversationId, {
            content: inboundWireContent.content.trim(),
            count: consecutiveRepeatCount,
            firstAt: now,
          });
          await deps.stateStore.upsertConversation(conversation);
          return;
        }
      }
      inboundRepeatTracker.delete(conversation.conversationId);

      await runSerializedConversationTurn(conversation.conversationId, async () => {
        // Re-read inside the per-conversation mutex so back-to-back inbound
        // messages cannot lose turnCount increments to a read-modify-write
        // race, then re-apply the reopen/idle-reset decisions made above.
        const storedConversation = await deps.stateStore.getConversationByPeer(peerGlobalMetaId)
          ?? conversation;
        const turnCountWasReset = conversation.turnCount === 0 && storedConversation.turnCount > 0;
        conversation = {
          ...storedConversation,
          state: conversation.state,
          lastDirection: 'inbound',
          updatedAt: now,
          turnCount: (turnCountWasReset ? 0 : storedConversation.turnCount) + 1,
        };
        await deps.stateStore.upsertConversation(conversation);

        // Check for the natural-language closing signal from peer.
        if (hasFinalByeLine(inboundWireContent.content)) {
          conversation = { ...conversation, state: 'closed', updatedAt: now };
          await deps.stateStore.upsertConversation(conversation);
          return;
        }

        if (conversation.state !== 'active') return;
        await replyToInboundMessage({
          selfGlobalMetaId,
          peerGlobalMetaId,
          conversation,
          strategy,
          inboundMessage: inboundMessageRecord,
        });
      });
    },
    async handleLocalGuidedTurn(peerGlobalMetaId, options = {}) {
      const selfGlobalMetaId = await deps.selfGlobalMetaId();
      if (!selfGlobalMetaId) return;

      const normalizedPeerGlobalMetaId = normalizeText(peerGlobalMetaId);
      if (!normalizedPeerGlobalMetaId) return;

      const conversation = await deps.stateStore.getConversationByPeer(normalizedPeerGlobalMetaId);
      if (!conversation) return;
      if (conversation.state !== 'active' && conversation.state !== 'closed') return;

      const strategy = resolveEffectiveStrategy(
        conversation.strategyId
          ? await deps.strategyStore.getStrategy(conversation.strategyId)
          : null,
        config,
      );
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
      const recentMessages = unwrapLegacyInboundContents(filterChatPromptMessages(
        selectPrivateChatPromptContextMessages(
          await deps.stateStore.getRecentMessages(
            conversation.conversationId,
            DEFAULT_RECENT_MESSAGES_LIMIT,
          ),
          {
            activeLimit: ACTIVE_SEGMENT_MESSAGES_LIMIT,
            previousLimit: PREVIOUS_SEGMENT_MESSAGES_LIMIT,
            gapMs: strategy?.maxIdleMs ?? DEFAULT_MAX_IDLE_MS,
          },
        ),
      ));
      const preparedTurn = await prepareOutboundTurn({
        conversation: runnerConversation,
        recentMessages,
        persona,
        strategy,
        inboundMessage: null,
        operatorGuidanceText: guidanceToConsume.guidanceText,
        // A guided turn that opens a new session (turnCount 1, fresh or
        // reopened) is the operator reaching out — it must not carry a close
        // marker, or the peer side would instantly re-close the conversation.
        conversationCloseAllowed: runnerConversation.turnCount > 1,
        memoryContext: await buildPrivateReplyMemoryContext(deps.paths, {
          peerGlobalMetaId: normalizedPeerGlobalMetaId,
          userText: normalizeText(guidanceToConsume.guidanceText),
        }),
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
    fireDueWakes,
    startWakeLoop,
    stopWakeLoop,
  };
}
