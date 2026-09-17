/** One content item surfaced to the bot during a surf run. */
export interface SurfItem {
    /** Pin id to deep-read (current version when the source folds revisions). */
    pinId: string;
    protocolKey: string;
    chainName: string;
    title: string;
    summary: string;
    authorName: string;
    authorGlobalMetaId: string;
    /** Unix seconds. */
    createdAt: number;
    likeCount: number | null;
    commentCount: number | null;
    /** Short protocol-specific note, e.g. "3 answers". */
    extra: string | null;
    /**
     * Server-side byte-identical dedupe (R1 dedupe=identical): number of
     * collapsed copies when > 1, already rendered into `extra` as "×N copies".
     */
    duplicates?: number;
}
/**
 * One stage-0 fetch result. `nextCursor` is an OPAQUE server token (R1
 * cursor paging pins the exact index key) — surfBriefing stores and forwards
 * it verbatim, never parses it.
 */
export interface SurfFreshPage {
    items: SurfItem[];
    hasMore: boolean;
    nextCursor: string | null;
}
export type SurfInteraction = 'like' | 'comment' | 'answer' | 'ask' | 'post' | 'challenge';
export interface SurfProtocolDescriptor {
    key: string;
    displayName: string;
    /** Chain paths this protocol lives under — used for new-protocol discovery. */
    paths: string[];
    interactions: SurfInteraction[];
    /** Persona-matching guidance rendered into the surf prompt. */
    relevanceHint: string;
    /**
     * Fetch one stage-0 page. Without `backlogCursor` this is the normal
     * since-window fetch (items with createdAt >= sinceTs); with a cursor it
     * is a BACKLOG page continuing an earlier window whose first page
     * reported hasMore — the cursor alone pins the resume point, so
     * implementations must NOT send `since` alongside it (backlog items are
     * older than the watermark and would be filtered out server-side).
     */
    fetchFresh: (input: {
        sinceTs: number | null;
        limit: number;
        backlogCursor?: string | null;
    }) => Promise<SurfFreshPage>;
    search?: (input: {
        query: string;
        limit: number;
    }) => Promise<SurfItem[]>;
}
export type SurfProtocolOptions = {
    /** so.metaid.io override (METABOT_METAWEB_API_BASE_URL propagation). */
    baseUrl?: string;
};
/**
 * Freshness filter for fetchFresh implementations. `>=` (not `>`): a pin
 * created in the SAME second as the previous watermark must come back on the
 * next run — the seen ledger dedupes anything already presented, so the
 * boundary second costs one re-fetch at most, while a strict `>` skipped
 * same-second stragglers forever (IDBots review 2, item 2). R1's server-side
 * `since` is already inclusive; this is the belt-and-braces client-side layer.
 */
export declare const sinceFiltered: (items: SurfItem[], sinceTs: number | null, limit: number) => SurfItem[];
/**
 * Backlog-window split for the client-side freshness filter. A BACKLOG page
 * is resumed by the server cursor ALONE: its items are OLDER than the
 * watermark by construction, so the sinceTs filter must NOT run on them —
 * it would drop every backlog item while the cursor still advances, paging
 * past unseen content forever (the exact silent-loss class the backlog
 * mechanism exists to fix). Window pages keep the >= belt-and-braces filter.
 */
export declare const applyFreshWindowFilter: (items: SurfItem[], sinceTs: number | null, limit: number, isBacklog: boolean) => SurfItem[];
/** Build the default registry; `options.baseUrl` overrides the aggregation base. */
export declare function createSurfProtocols(options?: SurfProtocolOptions): SurfProtocolDescriptor[];
/** Default registry with production base URLs. */
export declare const DEFAULT_SURF_PROTOCOLS: SurfProtocolDescriptor[];
