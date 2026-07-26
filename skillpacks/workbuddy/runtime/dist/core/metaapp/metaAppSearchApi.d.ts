/**
 * Thin client for the metaso-p2p MetaApp aggregation API
 * (metaso-p2p docs/metaapp-api-downstream-guide.md and
 * docs/specs/2026-07-26-metaapp-query-api.md): GET /api/metaapp/list and
 * GET /api/metaapp/forks/:pinId. Keeps callers decoupled from the envelope
 * shape ({code, data, message}, HTTP always 200) and item normalization.
 *
 * Ported from the IDBots reference client
 * (IDBots/src/main/services/metaAppSearchService.ts).
 */
export declare const DEFAULT_METAAPP_SEARCH_BASE_URL = "https://so.metaid.io";
type FetchResponse = {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
};
export type MetaAppSearchFetchFn = (url: string, init?: {
    signal?: AbortSignal;
    headers?: Record<string, string>;
}) => Promise<FetchResponse>;
export type MetaAppSearchItem = {
    pinId: string;
    sourcePinId: string;
    chainName: string;
    title: string;
    appName: string;
    intro: string;
    tags: string[];
    runtime: string;
    version: string;
    content: string;
    indexFile: string;
    forkedFrom: string;
    disabled: boolean;
    publisherGlobalMetaId: string;
    publisherMetaId: string;
    publisherAddress: string;
    /** Publisher display name (aggregation API; not in the written contract but present in production). */
    publisherName: string;
    /** Publisher avatar pin id (metafile reference), when indexed. */
    publisherAvatarId: string;
    createdAt: number;
    updatedAt: number;
};
export type MetaAppSearchPage = {
    items: MetaAppSearchItem[];
    nextCursor: string | null;
    hasMore: boolean;
};
export type MetaAppSearchParams = {
    keyword?: string;
    tag?: string;
    chainName?: string;
    runtime?: string;
    publisher?: string;
    since?: number;
    until?: number;
    includeDisabled?: boolean;
    size?: number;
    cursor?: string;
};
export declare class MetaAppSearchApiError extends Error {
    readonly apiCode: number;
    constructor(apiCode: number, message: string);
}
export declare class MetaAppSearchNotFoundError extends MetaAppSearchApiError {
    constructor(message: string);
}
export type MetaAppSearchApiOptions = {
    baseUrl?: string;
    fetchFn?: MetaAppSearchFetchFn;
    timeoutMs?: number;
};
/** GET /api/metaapp/list — global feed & intent search. */
export declare function searchMetaApps(params: MetaAppSearchParams, options?: MetaAppSearchApiOptions): Promise<MetaAppSearchPage>;
/** GET /api/metaapp/forks/:pinId — direct remix children of an app. */
export declare function listMetaAppForks(input: {
    pinId: string;
    size?: number;
    cursor?: string;
}, options?: MetaAppSearchApiOptions): Promise<MetaAppSearchPage>;
/**
 * CLI/skill-facing projection of a search item (design spec §6): only the
 * fields an agent needs to render candidates, plus `isOwn` marking items
 * published by a local Bot registry identity.
 */
export type TrimmedMetaAppSearchItem = {
    pinId: string;
    title: string;
    appName: string;
    intro: string;
    tags: string[];
    runtime: string;
    version: string;
    updatedAt: number;
    publisherGlobalMetaId: string;
    publisherName: string;
    publisherAvatarId: string;
    forkedFrom: string;
    isOwn: boolean;
};
export declare function trimMetaAppSearchItems(items: MetaAppSearchItem[], ownGlobalMetaIds: ReadonlySet<string>): TrimmedMetaAppSearchItem[];
export {};
