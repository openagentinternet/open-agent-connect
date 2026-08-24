/**
 * Thin client for the metaso-p2p MetaWeb unified search API:
 * GET /api/metaweb/search. Same conventions as the other aggregation APIs:
 * {code, data, message} envelope, HTTP always 200, business error codes
 * 40000/40400/50000. OAC port of the IDBots metawebSearchService.
 *
 * One keyword query fans out over every knowledge-bearing protocol the node
 * indexes (simplenote, simplebuzz, metaapp, metabot-skill, skill-service,
 * metaprotocol) and returns a relevance-ranked candidate list with
 * title/summary/pinId. This list is the search-engine results page, not the
 * content — the bot opens chosen pins via the pin-read API (./pinRead).
 */
export declare const DEFAULT_METAWEB_SEARCH_BASE_URL = "https://so.metaid.io";
/** Production wiring override: METABOT_METAWEB_API_BASE_URL. */
export declare const METAWEB_API_BASE_URL_ENV = "METABOT_METAWEB_API_BASE_URL";
/** Protocol keys the unified search can filter by (phase-1 coverage). */
export type MetawebSearchProtocol = 'simplenote' | 'simplebuzz' | 'metaapp' | 'metabot-skill' | 'skill-service' | 'metaprotocol';
export type MetawebSearchPublisher = {
    globalMetaId: string;
    metaid: string;
    name: string;
    /** Raw metafile:// URI (unresolved); the pin-read API resolves attachments server-side instead. */
    avatar: string;
};
export type MetawebSearchItem = {
    /** Protocol key from the spec's table, e.g. 'simplenote'. */
    protocol: string;
    /** Source PIN of the record's version chain. */
    pinId: string;
    /** Latest version PIN in the modify chain — open this one via the pin-read API. */
    currentPinId: string;
    chainName: string;
    title: string;
    summary: string;
    tags: string[];
    publisher: MetawebSearchPublisher;
    /** Unix seconds. */
    createdAt: number;
    /** Relevance score; 0 when sort=newest. */
    score: number;
    /** Protocol-specific highlights (metaapp runtime, service price, …); may be empty. */
    extra: Record<string, unknown>;
};
export type MetawebSearchPage = {
    items: MetawebSearchItem[];
    nextCursor: string | null;
    hasMore: boolean;
};
export type MetawebSearchParams = {
    /** Keyword query; CJK-aware tokenization server-side. Required. */
    q: string;
    /** Restrict to these protocol keys; default searches every indexed protocol. */
    protocols?: MetawebSearchProtocol[];
    /** Publisher filter: GlobalMetaID or MetaID, exact match. */
    publisher?: string;
    since?: number;
    until?: number;
    /** `relevance` (default, scored) or `newest` (createdAt desc, scoring bypassed). */
    sort?: 'relevance' | 'newest';
    /** Page size; the server clamps > 50 to 50. */
    size?: number;
    cursor?: string;
};
export type MetawebSearchServiceOptions = {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
};
/** GET /api/metaweb/search — unified cross-protocol knowledge search. */
export declare function searchMetaweb(params: MetawebSearchParams, options?: MetawebSearchServiceOptions): Promise<MetawebSearchPage>;
