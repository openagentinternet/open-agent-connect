/**
 * SurfBriefing — the deterministic stage-0 of every surf run. OAC port of the
 * IDBots surfBriefing (async file store instead of sync SQLite).
 *
 * For each registered protocol: fetch items newer than the bot's watermark
 * (first surf looks back SURF_FIRST_LOOKBACK_SECONDS) or continue a
 * registered backlog page, drop pins already in the seen ledger, and cap
 * per protocol and in total. The LLM session then decides what to deep-read,
 * save, and interact with. Two deterministic cross-protocol sections ride
 * along: YOUR INBOX (R3 interactions — likes/comments on my pins + answers
 * to my questions) and PROTOCOL RADAR (R6 registered /protocols/*
 * declarations). Neither ever throws — a sick backend lands in the section's
 * error field.
 *
 * This builder is side-effect free by design: survivors are marked
 * 'presented' by the surf service ONLY when the run succeeds, so a failed run
 * (LLM timeout, network outage) re-presents this same window on the next
 * surf instead of silently dropping it (catch-up semantics, IDBots review P1).
 */
import type { MetawebSurfStore } from './store.js';
import { type SurfItem, type SurfProtocolDescriptor } from './protocols.js';
export declare const SURF_FIRST_LOOKBACK_SECONDS: number;
export declare const SURF_PROTOCOL_FETCH_LIMIT = 50;
export declare const SURF_TOTAL_FETCH_LIMIT = 150;
/** Deterministic inbox items presented per run (newest first). */
export declare const SURF_INBOX_PRESENT_LIMIT = 30;
/** Protocol radar page size (one page, newest first). */
export declare const SURF_PROTOCOL_RADAR_LIMIT = 50;
export interface SurfBriefingProtocolSection {
    key: string;
    displayName: string;
    /** True when this section continued a registered backlog page instead of the since-window. */
    fetchedBacklog: boolean;
    fetchedCount: number;
    keptCount: number;
    /** Newest createdAt seen in this fetch (unix seconds); reporting only. */
    newestTs: number | null;
    /**
     * Kept items dropped by the TOTAL run cap (SURF_TOTAL_FETCH_LIMIT). These
     * stay OUT of the seen ledger and the watermark does not pass them, so the
     * cap defers them to the next surf instead of silently dropping them
     * (IDBots round 3, live evidence: 8 Q&A items once vanished without a trace).
     * For backlog pages the same rule preserves the backlog cursor instead of
     * advancing past them.
     */
    droppedByTotalCap: number;
    /**
     * Watermark to store after a successful run: the OLDEST kept item that made
     * the final capped list. Presented items are ledger-filtered on the next
     * run anyway, and crowded-out items survive that filter — so this cursor
     * re-fetches a bounded overlap and nothing is lost. null = do not advance
     * (fetch error, backlog pages, or this protocol was crowded out entirely).
     */
    nextWatermarkTs: number | null;
    /**
     * What the success path does with the stored backlog cursor (opaque R1
     * server token):
     * - 'store':    persist `backlogCursor` — the window's first page reported
     *               hasMore (debt registered) or a backlog page still has more.
     * - 'clear':    set it to null — the window/backlog is fully scanned
     *               (debt drained).
     * - 'preserve': leave it untouched — fetch error, or total-cap deferral on
     *               a backlog page (re-present the same backlog page next run).
     */
    backlogCursorAction: 'store' | 'clear' | 'preserve';
    /** Cursor value to persist when `backlogCursorAction` is 'store'. */
    backlogCursor: string | null;
    error: string | null;
}
/** One deterministic inbox interaction (R3). `pinId` is the interaction pin itself (the seen-ledger key). */
export interface SurfInboxItem {
    /** e.g. "simplebuzz_like" | "simplebuzz_comment" | "simpleanswer". */
    type: string;
    pinId: string;
    /** The bot's own pin the interaction points at. */
    targetPinId: string;
    actorName: string;
    actorGlobalMetaId: string;
    /** Unix seconds. */
    createdAt: number;
    excerpt: string;
}
export interface SurfBriefingInbox {
    items: SurfInboxItem[];
    /** The baseline the fetch used (unix seconds); presentation reports it. */
    sinceTs: number;
    error: string | null;
}
/** One registered /protocols/* declaration (R6), `isNew` computed against the surf baseline. */
export interface SurfProtocolRadarItem {
    path: string;
    title: string;
    protocolName: string;
    intro: string;
    version: string;
    authorName: string;
    createdAt: number;
    isNew: boolean;
}
export interface SurfProtocolRadar {
    items: SurfProtocolRadarItem[];
    rejectedCount: number;
    error: string | null;
}
/** What buildSurfBriefing expects from a radar fetcher (isNew is annotated in-house). */
export type SurfProtocolRadarFetchResult = {
    items: Array<Omit<SurfProtocolRadarItem, 'isNew'>>;
    rejectedCount: number;
};
export interface SurfBriefing {
    generatedAtIso: string;
    items: SurfItem[];
    protocols: SurfBriefingProtocolSection[];
    /** Deterministic inbox (R3); absent when the host passed no fetcher. */
    inbox?: SurfBriefingInbox;
    /** Registered-protocol radar (R6); absent when the host passed no fetcher. */
    protocolRadar?: SurfProtocolRadar;
    /** Chain-writing interactions allowed for this run (from bot settings). */
    interactionBudget: number;
}
export declare function buildSurfBriefing(input: {
    store: MetawebSurfStore;
    interactionBudget: number;
    registry?: SurfProtocolDescriptor[];
    nowMs?: number;
    /**
     * Deterministic inbox fetcher (R3). Called with sinceTs = inboxBaselineTs
     * (or the first-lookback default); returning items are ledger-filtered
     * here for exactly-once presentation. Never throws — errors land in
     * inbox.error.
     */
    fetchInbox?: (input: {
        sinceTs: number;
    }) => Promise<SurfInboxItem[]>;
    /**
     * Inbox/radar baseline (unix seconds): the START of the bot's previous
     * finished run. An interaction arriving mid-run must surface next run, so
     * the baseline is the previous run's createdAt, NOT its finishedAt.
     * Defaults to the first-lookback window.
     */
    inboxBaselineTs?: number;
    /** Protocol radar fetcher (R6); errors land in protocolRadar.error. */
    fetchProtocolRadar?: () => Promise<SurfProtocolRadarFetchResult>;
}): Promise<SurfBriefing>;
/**
 * Phase-2 digest report rendered when no LLM session ran (and always used as
 * the briefing appendix of the full report).
 */
export declare function renderSurfBriefingMarkdown(briefing: SurfBriefing): string;
