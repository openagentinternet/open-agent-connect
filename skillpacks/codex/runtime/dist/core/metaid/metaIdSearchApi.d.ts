/**
 * Thin client for the metaso-p2p MetaID aggregated search API
 * (metaso-p2p docs/specs/2026-07-28-metaid-search-api.md): GET /api/metaid/list
 * and GET /api/metaid/detail/:identity. Keeps callers decoupled from the
 * envelope shape ({code, data, message}, HTTP always 200) and item
 * normalization.
 *
 * Mirrors the MetaApp aggregation client (core/metaapp/metaAppSearchApi.ts):
 * the downstream LLM learns one convention for both directories.
 */
export declare const DEFAULT_METAID_SEARCH_BASE_URL = "https://so.metaid.io";
type FetchResponse = {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
};
export type MetaIdSearchFetchFn = (url: string, init?: {
    signal?: AbortSignal;
    headers?: Record<string, string>;
}) => Promise<FetchResponse>;
export type MetaIdSearchItem = {
    globalMetaId: string;
    metaId: string;
    address: string;
    chainName: string;
    name: string;
    avatarId: string;
    bio: string;
    chatSkills: string[];
    hasChatPubkey: boolean;
    hasHomepage: boolean;
    createdAt: number;
    updatedAt: number;
};
export type MetaIdSearchPage = {
    items: MetaIdSearchItem[];
    nextCursor: string | null;
    hasMore: boolean;
};
export type MetaIdSearchParams = {
    keyword?: string;
    skill?: string;
    chainName?: string;
    hasChatPubkey?: boolean;
    hasHomepage?: boolean;
    since?: number;
    until?: number;
    size?: number;
    cursor?: string;
};
/**
 * Detail record: every list-item field plus the profile-only fields the list
 * endpoint omits (size/readability). Raw on-chain JSON fields such as
 * persona/homepage are passed through untouched, matching the API contract.
 */
export type MetaIdDetail = MetaIdSearchItem & {
    avatarContentType: string;
    role: string;
    soul: string;
    goal: string;
    persona: unknown;
    llm: unknown;
    homepage: unknown;
    background: string;
    chatPubkey: string;
    fieldPins: Record<string, string>;
};
export declare class MetaIdSearchApiError extends Error {
    readonly apiCode: number;
    constructor(apiCode: number, message: string);
}
export declare class MetaIdSearchNotFoundError extends MetaIdSearchApiError {
    constructor(message: string);
}
export type MetaIdSearchApiOptions = {
    baseUrl?: string;
    fetchFn?: MetaIdSearchFetchFn;
    timeoutMs?: number;
};
/** GET /api/metaid/list — global user feed & intent search. */
export declare function searchMetaIds(params: MetaIdSearchParams, options?: MetaIdSearchApiOptions): Promise<MetaIdSearchPage>;
/** GET /api/metaid/detail/:identity — full profile of one identity. */
export declare function getMetaIdDetail(identity: string, options?: MetaIdSearchApiOptions): Promise<MetaIdDetail>;
/**
 * CLI/skill-facing projection of a search item: only the fields an agent
 * needs to render candidates, plus `isOwn` marking identities that belong to
 * a local Bot registry profile.
 */
export type TrimmedMetaIdSearchItem = {
    globalMetaId: string;
    metaId: string;
    address: string;
    chainName: string;
    name: string;
    avatarId: string;
    bio: string;
    chatSkills: string[];
    hasChatPubkey: boolean;
    hasHomepage: boolean;
    updatedAt: number;
    isOwn: boolean;
};
export declare function trimMetaIdSearchItems(items: MetaIdSearchItem[], ownGlobalMetaIds: ReadonlySet<string>): TrimmedMetaIdSearchItem[];
export {};
