/**
 * Thin client for the metaso-p2p metaprotocol authoritative registry API
 * (so.metaid.io, docs/metaid_protocols/metaprotocol-registry-agent-tools.md §3):
 *
 * - GET /api/metaweb/protocols           — authoritative registry list (v2)
 * - GET /api/metaweb/protocols/check     — publish precheck (path occupancy)
 * - GET /api/metaweb/protocols/detail    — record + payload + version list
 * - GET /api/metaweb/pin/:pinId/versions — modify-chain versions
 *
 * OAC port of the IDBots feat/metaprotocol-registry-tools service. Same
 * envelope conventions as the other so.metaid.io aggregation APIs ({code,
 * data, message}, HTTP always 200, business error codes 40000/40400/50000).
 * The core never reads the environment — callers pass { baseUrl } resolved
 * from METABOT_METAWEB_API_BASE_URL.
 *
 * Read-only MANAPI fallback (manapi.metaid.io): when the MetaSo projection is
 * unreachable, callers degrade to GET /pin/path/list?path=/protocols/metaprotocol
 * plus client-side contentSummary parsing, and to the source pin's
 * modify_history for version chains. The fallback lives here so the tool/CLI
 * layers only orchestrate; nothing in this file ever writes.
 */
export declare const DEFAULT_METAPROTOCOL_BASE_URL = "https://so.metaid.io";
export declare const DEFAULT_METAPROTOCOL_MANAPI_BASE_URL = "https://manapi.metaid.io";
/** On-chain directory of the protocol registry itself. */
export declare const METAPROTOCOL_REGISTRY_PATH = "/protocols/metaprotocol";
export type MetaProtocolAuthor = {
    address: string;
    metaid: string;
    globalMetaId: string;
    name: string;
};
export type MetaProtocolListItem = {
    protocolPath: string;
    title: string;
    protocolName: string;
    intro: string;
    version: string;
    chainName: string;
    /** Source pinId of the version chain (first-version create, never changes). */
    pinId: string;
    /** Latest version pinId. */
    currentPinId: string;
    /** Unix seconds. */
    createdAt: number;
    /** Unix seconds. */
    updatedAt: number;
    /** false while the registration is still unconfirmed (mempool). */
    confirmed: boolean;
    author: MetaProtocolAuthor;
    conflictsCount: number;
};
export type MetaProtocolListPage = {
    items: MetaProtocolListItem[];
    rejected: Array<{
        pinId: string;
        reason: string;
    }>;
    nextCursor: string | null;
    hasMore: boolean;
};
export type MetaProtocolExisting = {
    pinId: string;
    currentPinId: string;
    title: string;
    protocolName: string;
    version: string;
    createdAt: number;
    confirmed: boolean;
    author: MetaProtocolAuthor;
};
export type MetaProtocolCheckResult = {
    path: string;
    available: boolean;
    existing: MetaProtocolExisting | null;
};
export type MetaProtocolPayload = {
    title: string;
    path: string;
    version: string;
    authors: string;
    intro: string;
    protocolName: string;
    protocolAttachments: string[];
    metadata: unknown;
    /** JSON5 source of the protocol definition, verbatim. */
    protocolContent: string;
    protocolContentType: string;
};
export type MetaProtocolRecord = MetaProtocolListItem & {
    payload: MetaProtocolPayload;
};
export type MetaProtocolVersionEntry = {
    pinId: string;
    version: string;
    /** Unix seconds. */
    timestamp: number;
    author: MetaProtocolAuthor;
    /** 'chain' = evidence-grade (matches the on-chain modify history); 'local' = best-effort index. */
    attribution: 'chain' | 'local';
};
export type MetaProtocolDetail = {
    record: MetaProtocolRecord;
    /** Oldest → newest. */
    versions: MetaProtocolVersionEntry[];
    conflicts: unknown[];
    invalidModifies: unknown[];
};
export type MetaProtocolPinVersionEntry = {
    pinId: string;
    version: string;
    createdAt: number;
    operation: string;
    author: MetaProtocolAuthor;
};
export type MetaProtocolPinVersions = {
    pinId: string;
    latest: string;
    attribution: 'chain' | 'local';
    /** Oldest → newest. */
    versions: MetaProtocolPinVersionEntry[];
};
/** One /protocols/metaprotocol registration pin parsed client-side from MANAPI. */
export type MetaProtocolManapiRegistration = {
    pinId: string;
    /** Unix seconds (block time). */
    timestamp: number;
    operation: string;
    /** Outer 7-tuple version of the registration pin. */
    version: string;
    address: string;
    metaid: string;
    globalMetaId: string;
    /** Parsed pin payload (contentSummary, else decoded originalContentBody); null when unparseable. */
    payload: Record<string, unknown> | null;
};
export type MetaProtocolManapiVersion = {
    pinId: string;
    version: string;
    /** Unix seconds (block time). */
    timestamp: number;
    author: MetaProtocolAuthor;
};
export type MetaProtocolServiceOptions = {
    baseUrl?: string;
    manapiBaseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
};
/**
 * Business-resolution failure (not registered, ambiguous name, lookup
 * refused). Thrown by the resolver below so callers can tell it apart from a
 * transport error — which triggers the MANAPI degraded fallback instead.
 */
export declare class MetaprotocolResolveError extends Error {
    constructor(message: string);
}
/** Transport-error test: 40400 is the registry's not-found business code. */
export declare function isMetaprotocolNotFoundError(error: unknown): boolean;
/** §3.1 — authoritative registry list, createdAt desc (newest registrations first). */
export declare function listMetaProtocols(params?: {
    query?: string;
    publisher?: string;
    path?: string;
    includeConflicts?: boolean;
    size?: number;
    cursor?: string;
}, options?: MetaProtocolServiceOptions): Promise<MetaProtocolListPage>;
/** §3.2 — path occupancy precheck. Unconfirmed (mempool) registrations count as occupied. */
export declare function checkMetaProtocolPath(path: string, options?: MetaProtocolServiceOptions): Promise<MetaProtocolCheckResult>;
/** §3.3 — one record's authoritative latest version. `path` wins over `pinId` when both are given. */
export declare function getMetaProtocolDetail(input: {
    path?: string;
    pinId?: string;
}, options?: MetaProtocolServiceOptions): Promise<MetaProtocolDetail>;
/** §3.4 — modify-chain versions of a pin (any pinId in the chain resolves to its record's chain). */
export declare function getMetaProtocolPinVersions(pinId: string, options?: MetaProtocolServiceOptions): Promise<MetaProtocolPinVersions>;
export declare function notRegisteredText(locator: string): string;
/**
 * Resolve one protocol to its authoritative record (§4.3 order:
 * protocolPath → protocolName exact display-name match → pinId). Throws
 * MetaprotocolResolveError for business failures (the caller surfaces the
 * message verbatim) and rethrows transport errors so the caller can degrade
 * to the MANAPI fallback.
 */
export declare function resolveMetaProtocolRecord(input: {
    protocolPath?: string;
    protocolName?: string;
    pinId?: string;
}, options?: MetaProtocolServiceOptions): Promise<MetaProtocolRecord>;
/** Locate fallback registrations by payload path/name (case-insensitive). */
export declare function matchManapiRegistrations(registrations: MetaProtocolManapiRegistration[], locator: {
    protocolPath?: string;
    protocolName?: string;
}): MetaProtocolManapiRegistration[];
/**
 * Degraded registry scan: every /protocols/metaprotocol registration pin
 * (newest first), payloads parsed client-side. Only first-version create pins
 * carry the /protocols/metaprotocol path — modify pins live at @<sourcePinId>
 * — so version chains are NOT included here (see getMetaProtocolVersionsViaManapi).
 */
export declare function listMetaProtocolRegistrationsViaManapi(options?: MetaProtocolServiceOptions): Promise<MetaProtocolManapiRegistration[]>;
/**
 * Degraded version chain: the source pin's modify_history (chain order) with
 * per-version body versions, best-effort — a version pin that cannot be read
 * is skipped rather than failing the chain.
 */
export declare function getMetaProtocolVersionsViaManapi(sourcePinId: string, options?: MetaProtocolServiceOptions): Promise<MetaProtocolManapiVersion[]>;
