import type { MetabotPaths } from '../state/paths';
/**
 * Bounded host wake for silent-but-open private-chat conversations
 * (IDBots privateChatDaemon wake parity, 2026-09-16 deadlock postmortem).
 *
 * When a reply turn ends WITHOUT delivering anything — the model answered
 * `[NO_REPLY]`, an echo guard blocked the send, or the completion came back
 * empty — the conversation tail stays silent. The host only runs the bot
 * again when a NEW peer message arrives, so if the bot owes the peer a
 * deferred answer, both sides wait forever. This store arms a bounded timer
 * per conversation that re-drives the silent tail: the model gets a host
 * wake notice and decides again (deliver the owed answer / close politely /
 * stay silent). A new peer message, a delivered reply, or a closed
 * conversation cancels the wake.
 *
 * State persists at `<profile>/.runtime/state/private-chat-wake.json` (lazy,
 * atomic write-then-rename like the auto-reply backfill cursor; the only
 * writer is the profile's own orchestrator, so no lockfile is needed).
 */
export declare const DEFAULT_PRIVATE_CHAT_WAKE_DELAYS_MS: readonly number[];
export declare const DEFAULT_EMPTY_REPLY_RETRY_DELAYS_MS: readonly number[];
export type PrivateChatWakeKind = 'silent_tail' | 'empty_reply';
export interface PrivateChatWakeRecord {
    conversationId: string;
    peerGlobalMetaId: string;
    triggerMessageId: string;
    kind: PrivateChatWakeKind;
    /** Wakes/retries that already fired for this tail. */
    fires: number;
    fireAt: number;
    scheduledAt: number;
}
export interface PrivateChatWakeState {
    version: number;
    wakes: PrivateChatWakeRecord[];
}
export interface PrivateChatWakeStore {
    readWakes(): Promise<PrivateChatWakeRecord[]>;
    /** Next wake timestamp after `fires` fires have already happened, or null
     * when the budget is exhausted. */
    schedule(input: {
        conversationId: string;
        peerGlobalMetaId: string;
        triggerMessageId: string;
        kind: PrivateChatWakeKind;
        fires: number;
        delays?: readonly number[];
        now: number;
    }): Promise<PrivateChatWakeRecord | null>;
    /** Pushes the fire time of an existing record forward without spending a
     * fire (used when a wake turn could not run, e.g. rate limited or busy). */
    deferFire(conversationId: string, byMs: number): Promise<void>;
    remove(conversationId: string): Promise<void>;
}
/** Fire timestamp for the given delay schedule after `fires` fires. */
export declare function nextPrivateChatWakeAt(fires: number, delays?: readonly number[], now?: number): number | null;
export declare function createPrivateChatWakeStore(paths: MetabotPaths): PrivateChatWakeStore;
