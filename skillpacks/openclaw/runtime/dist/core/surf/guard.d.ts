/**
 * Surf interaction guard. OAC port of the IDBots surfInteractionGuard,
 * adapted to OAC's write path: every chain write a surf session can reach
 * (like/comment/answer/ask/buzz/note/agentpedia challenge) funnels through
 * one guarded `write({path, payload})` primitive instead of IDBots'
 * `createPin`.
 */
import { type MetawebSurfRunStats, type MetawebSurfSeenAction } from './store.js';
/**
 * Surf-session write state, one object per surf run (the OAC surf turn loop
 * keeps it for the whole run, so counters never reset mid-run).
 */
export interface SurfSessionWriteState {
    /** Hard ceiling of chain-writing interactions for this run (0 = none). */
    interactionBudget: number;
    /** Hard ceiling of metaweb-source KB adds for this run. */
    kbBudget: number;
    /** Chain writes attempted so far this run (attempts count, even failed ones). */
    writesUsed?: number;
    /** metaweb-source KB adds so far this run (read by the KB wrapper). */
    kbAddsUsed?: number;
    /** targetPinId → strongest interaction rank published this run (dup guard). */
    interactions?: Record<string, number>;
    /**
     * pinIds of ORIGINAL posts actually published this run (buzz/note/question/
     * rev) — the 'posted' receipt class. Read back after the session as ground
     * truth (IDBots review 2, item 6).
     */
    postedPinIds?: string[];
    /**
     * pinIds actually deep-read this run (recorded by the readPin wrapper —
     * readable pins only, deduped). Success path: folded over the model's
     * self-reported readPinIds (receipts over self-report). Failure path:
     * powers the real partial stats on the failed run row — these pins
     * deliberately stay OUT of the seen ledger so the next surf re-presents
     * them (the run's saves are lost; the catch-up must get another chance).
     */
    readPinIds?: string[];
    /**
     * Scheduled tasks actually created this run (create_scheduled_task — the
     * surf→work handoff). Counter drives the per-run hard cap; ids are the
     * ground-truth receipt for the run stats.
     */
    tasksScheduled?: number;
    /** Ids of the scheduled tasks created this run (same order as created). */
    scheduledTaskIds?: string[];
}
/**
 * The run's ACTUAL on-chain writes as seen-ledger entries, read back from the
 * guard-mutated write state after the session — the ground truth the model's
 * self-report is checked against.
 */
export declare function surfReceiptSeenActions(state: SurfSessionWriteState): Array<{
    pinId: string;
    action: MetawebSurfSeenAction;
}>;
/**
 * Fold receipts over the session's self-reported seen actions: every
 * chain-write class comes ONLY from what the guard actually published — a
 * like the model forgot to report is still banked, a like it merely claimed
 * is dropped. Read/saved-class entries stay self-reported (their blast
 * radius is one bot's digest, not gas).
 */
export declare function foldSurfReceiptsIntoSeenActions(selfReported: Array<{
    pinId: string;
    action: MetawebSurfSeenAction;
}>, state: SurfSessionWriteState): Array<{
    pinId: string;
    action: MetawebSurfSeenAction;
}>;
/** Record one actual deep read on the run's write state (deduped). */
export declare function recordSurfDeepRead(state: SurfSessionWriteState, pinId: string): void;
/** The run's tracked deep reads as 'read'-class seen-ledger entries. */
export declare function surfDeepReadReceiptSeenActions(state: SurfSessionWriteState): Array<{
    pinId: string;
    action: 'read';
}>;
/**
 * What the host can vouch for on a FAILED run: real counts from the
 * guard-mutated state — chain interactions by their strongest action, posts,
 * KB adds and tracked deep reads. Attached to the session error so the failed
 * run row stops reporting all-zero stats.
 */
export declare function surfSessionPartialStats(state: SurfSessionWriteState): Partial<MetawebSurfRunStats>;
/**
 * Re-derive one bot's surf receipts from a chain-history write record
 * (reconciliation): the row's own pin is always a 'posted' receipt (the bot
 * published it), and an interaction payload yields its target receipt on
 * top. Used to backfill the seen ledger before a surf run, so receipts lost
 * to a crash/kill mid-run can never cause a paid duplicate interaction.
 */
export declare function surfReceiptsFromChainWriteRecord(record: {
    pinId: string;
    path?: string | null;
    contentText?: string | null;
}): Array<{
    pinId: string;
    action: MetawebSurfSeenAction;
}>;
/** One guarded chain write: performed by the host, receipt-shaped result. */
export type SurfChainWrite = (input: {
    path: string;
    payload: unknown;
    network?: string;
}) => Promise<{
    pinId: string;
    txids: string[];
    totalCost: number;
    network: string;
}>;
/**
 * The surf session's single chain-write choke point (IDBots review P2.1 +
 * P2.3). Three rules before the wallet is touched:
 *
 * 0. Self-interaction block: liking, answering, or challenging the bot's OWN
 *    pin is chain spam — rejected without spending budget, against the local
 *    chain-history writes ledger (isOwnPin; best-effort, pins published
 *    elsewhere are unknown). Comments on own pins stay allowed: replying in
 *    your own thread is how the inbox step works.
 * 1. Duplicate-interaction guard: targeting a pin this bot already engaged
 *    with an equal-or-stronger action — earlier in THIS run (state.interactions)
 *    or in a previous surf (the seen ledger via getSeenAction) — is rejected
 *    WITHOUT spending budget. Read/save-level ledger entries never block an
 *    interaction: liking a pin you only bookmarked yesterday is fine.
 * 2. Budget hard ceiling: write attempts beyond state.interactionBudget are
 *    rejected with guidance to finish the run report. Budget 0 refuses every
 *    write while learning tools keep working.
 */
export declare function createSurfChainWriteGuard(deps: {
    write: SurfChainWrite;
    state: SurfSessionWriteState;
    getSeenAction?: (pinId: string) => Promise<MetawebSurfSeenAction | null>;
    isOwnPin?: (pinId: string) => Promise<boolean>;
}): SurfChainWrite;
