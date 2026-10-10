import type { PrivateChatMessage } from './privateChatTypes';
/**
 * Loop-hygiene helpers for the 1:1 private-chat auto-reply loop, ported from
 * the IDBots private-chat daemon (2026-09 BOT-009 silence ping-pong and
 * 2026-09-16 empty-reply stall postmortems).
 *
 * These are pure functions over conversation messages so they stay unit
 * testable without a daemon; the orchestrator wires them into the reply path.
 */
export declare const CHAT_NO_REPLY_EXTENSION = "chatNoReply";
export declare const CHAT_SILENT_TAIL_EXTENSION = "chatSilentTail";
/** Outbound marker for an inbound message whose reply was handed to an external relay (Grok Bot routine webhook). */
export declare const CHAT_EXTERNAL_RELAY_EXTENSION = "chatExternalRelay";
export declare const PRIVATE_CHAT_NO_REPLY_SENTINEL = "[NO_REPLY]";
/**
 * Exact-match check (ASCII protocol tag): tolerates surrounding whitespace,
 * wrapping quotes/backticks and a trailing sentence punctuation mark, but any
 * additional prose means it is real reply text and must be delivered verbatim.
 */
export declare function isPrivateChatNoReplySentinel(value: unknown): boolean;
/**
 * Inbound texts that must never drive an auto-reply turn: empty messages,
 * placeholder chatter ("Thinking...", "...."), a bare "bye" (the Bye handler
 * owns that), and a peer host broadcasting its own silence sentinel verbatim.
 */
export declare function shouldSkipPrivateChatAutoReplyText(value: string): boolean;
/**
 * Delivery-side degenerate-loop guard: counts the trailing run of delivered
 * outbound messages that are verbatim-identical to the candidate reply (wait
 * notices and host-side silence markers do not count). A bot never needs to
 * say the exact same thing three times in a row: once the tail shows two
 * identical delivered replies, a third identical delivery is definitionally
 * an echo loop. Language-agnostic by construction: byte equality only.
 */
export declare const PRIVATE_CHAT_ECHO_GUARD_MIN_REPEATS = 2;
export declare function wouldCreatePrivateChatEchoLoop(input: {
    messages: PrivateChatMessage[];
    replyText: string;
    minRepeats?: number;
}): boolean;
/**
 * True when the inbound plaintext is verbatim-identical to the immediately
 * previous inbound message of the same conversation segment (gap-bounded).
 * The first copy already drove (or is driving) a reply turn, so re-running
 * the model for each identical retransmission only feeds degenerate loops.
 * Pure byte-equality dedup; no wording, language, or intent is interpreted.
 */
export declare function isRepeatInboundPrivateChatMessage(input: {
    messages: PrivateChatMessage[];
    content: string;
    now?: number;
    gapMs?: number;
    defaultGapMs: number;
}): boolean;
/**
 * Host notice appended to the prompt when a wake timer re-drives a turn that
 * previously ended silent: the host only runs the bot again when a NEW peer
 * message arrives, so if both sides now wait, the conversation deadlocks.
 */
export declare function buildPrivateChatWakeNotice(fire: number): string;
/**
 * Host notice appended to the prompt when a reply turn is re-run because the
 * previous attempt completed WITHOUT any final reply text (a reasoning-only
 * completion where the whole answer stayed inside the thinking block).
 */
export declare function buildPrivateChatEmptyReplyRetryNotice(attempt: number): string;
/**
 * Prompt-context selection (IDBots parity): keep up to `activeLimit` messages
 * from the active session tail plus up to `previousLimit` messages from the
 * previous session as background. A session boundary is an idle gap beyond
 * `gapMs` or a session-closing Bye message. Input must be chronologically
 * ascending; the output preserves that order.
 */
export declare function selectPrivateChatPromptContextMessages(messages: PrivateChatMessage[], options?: {
    activeLimit?: number;
    previousLimit?: number;
    gapMs?: number;
}): PrivateChatMessage[];
