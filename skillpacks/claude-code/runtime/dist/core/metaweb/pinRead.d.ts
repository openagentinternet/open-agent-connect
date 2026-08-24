/**
 * Thin client for the metaso-p2p MetaWeb generic pin-read API:
 * GET /api/metaweb/pin/:pinId. Same conventions as the other aggregation
 * APIs: {code, data, message} envelope, HTTP always 200, business error codes
 * 40000/40400/50000. OAC port of the IDBots metawebPinService.
 *
 * The caller does not know the pin's protocol in advance: the server
 * dispatches across its local index namespaces and falls back to MANAPI
 * passthrough (`source: "remote"`) when the pin is not locally indexed. Any
 * version of a pin id is accepted; the response resolves `currentPinId` to
 * the latest known version.
 */
export declare const DEFAULT_METAWEB_PIN_BASE_URL = "https://so.metaid.io";
export type MetawebPinCreator = {
    globalMetaId: string;
    metaid: string;
    /** Best-effort profile enrichment; empty when unknown. */
    name: string;
    address: string;
};
export type MetawebPinAttachment = {
    /** Original metafile:// URI as stored in the payload. */
    uri: string;
    /** Absolute fetchable URL, resolved server-side. */
    url: string;
    contentType: string;
    /** Bytes; null when unknown. */
    size: number | null;
};
export type MetawebPinMeta = {
    title: string;
    summary: string;
    tags: string[];
};
export type MetawebPin = {
    /** The id as requested. */
    pinId: string;
    /** Latest known version in the modify chain. */
    currentPinId: string;
    /** Protocol key (e.g. 'simplenote'); for unknown remote paths, the last path segment. */
    protocol: string;
    /** Full on-chain path, e.g. '/protocols/simplenote'. */
    path: string;
    chainName: string;
    /** 'create' | 'modify' | 'revoke'. */
    operation: string;
    creator: MetawebPinCreator;
    /** Unix seconds. */
    createdAt: number;
    contentType: string;
    /** Decoded JSON object, raw string for plain-text bodies, or null (empty/binary/encrypted). */
    payload: unknown;
    /** LLM-ready normalized body (markdown); null when empty/binary/encrypted — skip such pins. */
    text: string | null;
    /** Present when text is non-null; true means the server capped the body (see totalLength). */
    truncated: boolean | null;
    /** Full body rune count; null when text is null. */
    totalLength: number | null;
    /** Same title/summary/tags extraction as unified search (shared server code path). */
    meta: MetawebPinMeta;
    attachments: MetawebPinAttachment[];
    /** 'local' = node index; 'remote' = MANAPI passthrough. */
    source: string;
};
export declare class MetawebPinNotFoundError extends Error {
    constructor(message: string);
}
export type MetawebPinServiceOptions = {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
};
/** GET /api/metaweb/pin/:pinId — generic pin read; any version id resolves to the latest known version. */
export declare function readMetawebPin(pinId: string, options?: MetawebPinServiceOptions): Promise<MetawebPin>;
