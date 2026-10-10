import type { PrivateChatMessage } from './privateChatTypes';

/**
 * Loop-hygiene helpers for the 1:1 private-chat auto-reply loop, ported from
 * the IDBots private-chat daemon (2026-09 BOT-009 silence ping-pong and
 * 2026-09-16 empty-reply stall postmortems).
 *
 * These are pure functions over conversation messages so they stay unit
 * testable without a daemon; the orchestrator wires them into the reply path.
 */

// Outbound-record extension markers for host-side silence: a record carrying
// one of these never reached the peer and must not read as an answer for
// moved-past checks, echo guards, or prompt history.
export const CHAT_NO_REPLY_EXTENSION = 'chatNoReply';
export const CHAT_SILENT_TAIL_EXTENSION = 'chatSilentTail';
/** Outbound marker for an inbound message whose reply was handed to an external relay (Grok Bot routine webhook). */
export const CHAT_EXTERNAL_RELAY_EXTENSION = 'chatExternalRelay';

export const PRIVATE_CHAT_NO_REPLY_SENTINEL = '[NO_REPLY]';

/**
 * Exact-match check (ASCII protocol tag): tolerates surrounding whitespace,
 * wrapping quotes/backticks and a trailing sentence punctuation mark, but any
 * additional prose means it is real reply text and must be delivered verbatim.
 */
export function isPrivateChatNoReplySentinel(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value
    .trim()
    .replace(/^["'`“”『「]+/u, '')
    .replace(/["'`“”』」]+$/u, '')
    .replace(/[.!。！？?…]+$/u, '')
    .trim()
    .toLowerCase();
  return normalized === PRIVATE_CHAT_NO_REPLY_SENTINEL.toLowerCase();
}

/**
 * Inbound texts that must never drive an auto-reply turn: empty messages,
 * placeholder chatter ("Thinking...", "...."), a bare "bye" (the Bye handler
 * owns that), and a peer host broadcasting its own silence sentinel verbatim.
 */
export function shouldSkipPrivateChatAutoReplyText(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === 'bye' || normalized === 'goodbye') return true;
  if (normalized === 'thinking...' || normalized === 'thinking…') return true;
  if (/^[.\s]+$/u.test(normalized)) return true;
  if (/^[…\s]+$/u.test(normalized)) return true;
  if (isPrivateChatNoReplySentinel(normalized)) return true;
  return false;
}

function isHostSilenceMarker(message: PrivateChatMessage): boolean {
  return Boolean(
    message.direction === 'outbound'
    && (
      message.extensions?.[CHAT_NO_REPLY_EXTENSION] === true
      || message.extensions?.[CHAT_SILENT_TAIL_EXTENSION] === true
      || typeof message.extensions?.[CHAT_EXTERNAL_RELAY_EXTENSION] === 'string'
    ),
  );
}

/**
 * Outbound records that count as delivered conversational text: host-side
 * silence markers and chat-skill wait notices never count (IDBots parity).
 */
function isDeliveredOutbound(message: PrivateChatMessage): boolean {
  return Boolean(
    message.direction === 'outbound'
    && !isHostSilenceMarker(message)
    && message.extensions?.chatSkillWaitNotice !== true,
  );
}

/**
 * Delivery-side degenerate-loop guard: counts the trailing run of delivered
 * outbound messages that are verbatim-identical to the candidate reply (wait
 * notices and host-side silence markers do not count). A bot never needs to
 * say the exact same thing three times in a row: once the tail shows two
 * identical delivered replies, a third identical delivery is definitionally
 * an echo loop. Language-agnostic by construction: byte equality only.
 */
export const PRIVATE_CHAT_ECHO_GUARD_MIN_REPEATS = 2;

export function wouldCreatePrivateChatEchoLoop(input: {
  messages: PrivateChatMessage[];
  replyText: string;
  minRepeats?: number;
}): boolean {
  const target = input.replyText.trim();
  if (!target) return false;
  const minRepeats = Number.isFinite(input.minRepeats) && (input.minRepeats as number) >= 1
    ? Math.floor(input.minRepeats as number)
    : PRIVATE_CHAT_ECHO_GUARD_MIN_REPEATS;
  const delivered = input.messages.filter(isDeliveredOutbound);
  let identicalRun = 0;
  for (let index = delivered.length - 1; index >= 0; index -= 1) {
    if ((delivered[index]?.content ?? '').trim() !== target) break;
    identicalRun += 1;
  }
  return identicalRun >= minRepeats;
}

/**
 * True when the inbound plaintext is verbatim-identical to the immediately
 * previous inbound message of the same conversation segment (gap-bounded).
 * The first copy already drove (or is driving) a reply turn, so re-running
 * the model for each identical retransmission only feeds degenerate loops.
 * Pure byte-equality dedup; no wording, language, or intent is interpreted.
 */
export function isRepeatInboundPrivateChatMessage(input: {
  messages: PrivateChatMessage[];
  content: string;
  now?: number;
  gapMs?: number;
  defaultGapMs: number;
}): boolean {
  const target = input.content.trim();
  if (!target) return false;
  const now = Number.isFinite(input.now as number) ? (input.now as number) : Date.now();
  const gapMs = Number.isFinite(input.gapMs as number)
    ? (input.gapMs as number)
    : input.defaultGapMs;
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index];
    if (!message) continue;
    if (message.direction !== 'inbound') continue;
    const timestamp = Number.isFinite(message.timestamp) ? message.timestamp : now;
    if (now - timestamp > gapMs) return false;
    return message.content.trim() === target;
  }
  return false;
}

/**
 * Host notice appended to the prompt when a wake timer re-drives a turn that
 * previously ended silent: the host only runs the bot again when a NEW peer
 * message arrives, so if both sides now wait, the conversation deadlocks.
 */
export function buildPrivateChatWakeNotice(fire: number): string {
  const safeFire = Number.isFinite(fire) && fire > 0 ? Math.floor(fire) : 1;
  return [
    `## Host Wake Check ${safeFire} (host timer — no new peer message arrived)`,
    'Your previous turn for the peer\'s latest message ended WITHOUT delivering anything, and the conversation is still open. The host woke you on a timer because it only runs you again when a NEW peer message arrives — if both sides now wait, the conversation deadlocks.',
    'Decide again for the conversation tail:',
    '- If you owe the peer an answer you promised or deferred earlier (for example you said you would verify something and reply later), deliver it now as your final text.',
    '- If the conversation has nothing left to produce, close it politely with your farewell and the close marker.',
    `- Reply \`${PRIVATE_CHAT_NO_REPLY_SENTINEL}\` only if you genuinely owe nothing and the conversation should stay open awaiting the peer.`,
  ].join('\n');
}

/**
 * Host notice appended to the prompt when a reply turn is re-run because the
 * previous attempt completed WITHOUT any final reply text (a reasoning-only
 * completion where the whole answer stayed inside the thinking block).
 */
export function buildPrivateChatEmptyReplyRetryNotice(attempt: number): string {
  const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 1;
  return [
    `## Host Retry Notice (attempt ${safeAttempt} for the latest peer message)`,
    'Your previous turn for the latest peer message ended with no final reply text — for example a reasoning-only completion where the whole answer stayed inside the thinking block.',
    'The host delivers ONLY your final text message to the peer; reasoning content is never delivered. An empty turn is not a valid outcome.',
    'Answer the latest peer message again now and make sure the reply is emitted as a regular final text message outside any thinking block.',
    `If you genuinely have nothing to deliver, reply with exactly \`${PRIVATE_CHAT_NO_REPLY_SENTINEL}\`.`,
  ].join('\n');
}

const SESSION_CLOSE_LINE_PATTERN = /^(?:bye|goodbye)[.!。！]?$/iu;

function closesSession(message: PrivateChatMessage): boolean {
  if (!message.content.trim()) return false;
  const lines = message.content.split(/\r?\n/u);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index]!.trim()) continue;
    return SESSION_CLOSE_LINE_PATTERN.test(lines[index]!.trim());
  }
  return false;
}

function normalizeTimestampMs(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Prompt-context selection (IDBots parity): keep up to `activeLimit` messages
 * from the active session tail plus up to `previousLimit` messages from the
 * previous session as background. A session boundary is an idle gap beyond
 * `gapMs` or a session-closing Bye message. Input must be chronologically
 * ascending; the output preserves that order.
 */
export function selectPrivateChatPromptContextMessages(
  messages: PrivateChatMessage[],
  options: {
    activeLimit?: number;
    previousLimit?: number;
    gapMs?: number;
  } = {},
): PrivateChatMessage[] {
  const activeLimit = options.activeLimit && options.activeLimit > 0
    ? Math.floor(options.activeLimit)
    : 80;
  const previousLimit = options.previousLimit && options.previousLimit > 0
    ? Math.floor(options.previousLimit)
    : 20;
  const gapMs = options.gapMs && options.gapMs > 0 ? options.gapMs : 300_000;
  if (messages.length === 0) return [];

  // Find the last session boundary strictly before the tail: the first index
  // (scanning backwards) whose gap to its successor exceeds gapMs, or whose
  // own content closes the session.
  let boundaryIndex = 0;
  for (let index = messages.length - 1; index > 0; index -= 1) {
    const current = messages[index]!;
    const previous = messages[index - 1]!;
    const currentTs = normalizeTimestampMs(current.timestamp);
    const previousTs = normalizeTimestampMs(previous.timestamp);
    if (currentTs && previousTs && currentTs - previousTs > gapMs) {
      boundaryIndex = index;
      break;
    }
    if (closesSession(previous)) {
      boundaryIndex = index;
      break;
    }
  }

  const active = messages.slice(boundaryIndex);
  const activeTrimmed = active.length > activeLimit
    ? active.slice(active.length - activeLimit)
    : active;
  const previous = messages.slice(
    Math.max(0, boundaryIndex - previousLimit),
    boundaryIndex,
  );
  return [...previous, ...activeTrimmed];
}
