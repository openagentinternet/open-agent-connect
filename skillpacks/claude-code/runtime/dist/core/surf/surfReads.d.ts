/**
 * Thin client for the metaso-p2p MetaWeb "surf reads" API family served from
 * the same so.metaid.io aggregation backend. OAC port of the IDBots
 * metawebSurfReadsService:
 *
 * - R1  GET /api/metaweb/fresh          — deterministic fresh-items feed per
 *   protocol with strict total ordering (createdAt DESC, then
 *   chain/path/pinId ASC), gap-free cursor paging, inclusive `since`,
 *   byte-identical dedupe and per-author throttling.
 * - R2  POST /api/metaweb/pins:batch    — up to 50 pins in one round trip;
 *   per-pin failures are isolated as {error} entries.
 * - R3  GET /api/metaweb/interactions   — the deterministic inbox: likes and
 *   comments on my pins plus answers to my questions, one call.
 * - R4  GET /api/metaweb/pin/:id/versions — modify-chain versions with an
 *   evidence-grade ("chain") or best-effort ("local") attribution.
 * - R6  GET /api/metaweb/protocols      — validated registry of
 *   /protocols/* declarations (the protocol radar).
 *
 * Same conventions as metaweb/pinRead: {code, data, message} envelope, HTTP
 * always 200, business error codes 40000/40400, AbortController timeout with
 * a mapped message. Cursors are OPAQUE server tokens — stored and forwarded
 * verbatim, never parsed client-side.
 */
import { type MetawebPin } from '../metaweb/pinRead.js';
export declare const DEFAULT_METAWEB_SURF_READS_BASE_URL = "https://so.metaid.io";
/** R2 hard cap on pinIds per batch request. */
export declare const METAWEB_PINS_BATCH_MAX = 50;
export declare class MetawebPinVersionsNotFoundError extends Error {
    constructor(message: string);
}
export type MetawebSurfReadsOptions = {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
};
export type MetawebFreshAuthor = {
    address: string;
    metaid: string;
    globalMetaId: string;
    name: string;
};
export type MetawebFreshItem = {
    pinId: string;
    currentPinId: string;
    protocol: string;
    path: string;
    chainName: string;
    createdAt: number;
    author: MetawebFreshAuthor;
    title: string;
    summary: string;
    likeCount: number | null;
    commentCount: number | null;
    /** Present when dedupe=identical collapsed byte-identical copies onto this newest one. */
    duplicates: number | null;
};
export type MetawebFreshSuppressed = {
    duplicates: number;
    throttled: number;
} | null;
export type MetawebFreshPage = {
    items: MetawebFreshItem[];
    hasMore: boolean;
    nextCursor: string | null;
    suppressed: MetawebFreshSuppressed;
};
/**
 * R1 — deterministic fresh-items feed. `since` is INCLUSIVE (unix seconds);
 * `cursor` is an opaque server token from a previous page (pins the exact
 * index key, so paging is gap-free and duplicate-free).
 */
export declare function metawebFresh(input: {
    protocols: string[];
    since?: number;
    size?: number;
    cursor?: string;
    dedupe?: 'identical';
    maxPerAuthor?: number;
}, options?: MetawebSurfReadsOptions): Promise<MetawebFreshPage>;
export type MetawebBatchPin = MetawebPin & {
    version: {
        latest: string;
        count: number | null;
    };
};
/** Per-pin failure entries are isolated server-side: {pinId, error}. */
export type MetawebBatchEntry = MetawebBatchPin | {
    pinId: string;
    error: string;
};
export declare const isBatchErrorEntry: (entry: MetawebBatchEntry) => entry is {
    pinId: string;
    error: string;
};
/**
 * R2 — read up to 50 pins in one round trip. The response is a map keyed by
 * the requested pinId; entries are full pin objects (same shape as
 * GET /api/metaweb/pin/:id plus version info) or isolated {error} entries.
 * `text` is capped at 8000 runes per pin (truncated/totalLength say so);
 * `payload` is NEVER truncated.
 */
export declare function metawebPinsBatch(pinIds: string[], options?: MetawebSurfReadsOptions): Promise<Record<string, MetawebBatchEntry>>;
export type MetawebInteractionItem = {
    type: string;
    pinId: string;
    targetPinId: string;
    actor: MetawebFreshAuthor;
    createdAt: number;
    excerpt: string;
};
export type MetawebInteractionsPage = {
    items: MetawebInteractionItem[];
    hasMore: boolean;
    nextCursor: string | null;
};
/**
 * R3 — the deterministic inbox: likes/comments on the owner's pins plus
 * answers to the owner's questions. `owner` is an address, metaId or
 * globalMetaId (any case). `since` is unix seconds, inclusive.
 */
export declare function metawebInteractions(input: {
    owner: string;
    since?: number;
    types?: string;
    size?: number;
    cursor?: string;
}, options?: MetawebSurfReadsOptions): Promise<MetawebInteractionsPage>;
export type MetawebPinVersionEntry = {
    pinId: string;
    version: string;
    createdAt: number;
    operation: string;
    author: MetawebFreshAuthor;
};
export type MetawebPinVersions = {
    pinId: string;
    latest: string;
    /** 'chain' = evidence-grade (matches the chain projection); 'local' = best-effort index, may be partial after indexer gaps. */
    attribution: 'chain' | 'local';
    /** Oldest → newest. */
    versions: MetawebPinVersionEntry[];
};
/**
 * R4 — modify-chain versions of a pin. Unknown pins raise
 * MetawebPinVersionsNotFoundError (business 40400).
 */
export declare function metawebPinVersions(pinId: string, options?: MetawebSurfReadsOptions): Promise<MetawebPinVersions>;
export type MetawebProtocolRadarItem = {
    pinId: string;
    currentPinId: string;
    chainName: string;
    createdAt: number;
    author: MetawebFreshAuthor;
    path: string;
    title: string;
    protocolName: string;
    intro: string;
    version: string;
};
export type MetawebProtocolRadarPage = {
    items: MetawebProtocolRadarItem[];
    rejected: Array<{
        pinId: string;
        reason: string;
    }>;
    hasMore: boolean;
    nextCursor: string | null;
};
/** R6 — validated registry of /protocols/* declarations, newest first. */
export declare function metawebProtocols(input?: {
    size?: number;
    cursor?: string;
}, options?: MetawebSurfReadsOptions): Promise<MetawebProtocolRadarPage>;
