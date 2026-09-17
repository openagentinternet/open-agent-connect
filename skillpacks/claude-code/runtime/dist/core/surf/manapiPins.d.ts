/**
 * Thin client for the public MANAPI indexer (manapi.metaid.io). OAC port of
 * the IDBots manapiPinService.
 *
 * Wraps `GET /api/pin/path/list` — newest-first paging of pins under one
 * MetaID protocol path. Used by the MetaWeb surf protocol registry for
 * protocols that have no aggregated "latest" feed on the so.metaid.io layer
 * (agentpedia revs today). MANAPI answers the shared envelope
 * `{code, data, message}` with `code === 1` meaning success.
 */
export declare const DEFAULT_MANAPI_BASE_URL = "https://manapi.metaid.io";
export type ManapiPathListItem = {
    pinId: string;
    /** Unix seconds (block time). */
    timestamp: number;
    /** Unix seconds (relay first-seen time). */
    seenTime: number;
    globalMetaId: string;
    address: string;
    path: string;
    contentType: string;
    /** Truncated JSON string of the pin payload; may be cut mid-string. */
    contentSummary: string;
    operation: string;
};
export type ManapiPathListPage = {
    items: ManapiPathListItem[];
    nextCursor: string | null;
    hasMore: boolean;
};
export type ManapiPinServiceOptions = {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
};
/** GET /api/pin/path/list?path=…&size=… — newest first. */
export declare function listPinsByPath(params: {
    path: string;
    size?: number;
    cursor?: string;
}, options?: ManapiPinServiceOptions): Promise<ManapiPathListPage>;
