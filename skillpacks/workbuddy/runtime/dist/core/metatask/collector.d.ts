/**
 * MetaTask chain-event collector (OAC port of the IDBots collector, M2).
 *
 * Walks all ten /protocols/metatask* pools (the nine event paths + the flat
 * /protocols/metatask-roster pool) via the MANAPI pin/path/list route with
 * cursor pagination to the empty page (protocol §10.8; an empty pool returns
 * `"list": null` and must be tolerated), dedups by pinId, and normalizes each
 * row into the engine's MetaTaskChainEvent shape (body parsed from
 * contentBody base64, falling back to contentSummary — same decoding order
 * as the reference Python engine).
 *
 * Content recovery (MAN-p2p f23e8ec): list rows now carry `contentSummary`
 * truncated to the first 4096 bytes of the body, an empty `contentBody`, and
 * `content` = a download URL serving the raw full body. A truncated body makes
 * the replay drop every node of a large tree pin, so rows whose inline body is
 * missing or visibly shorter than the row's declared `contentLength` are
 * recovered after the walk, in two tiers:
 *   1. the MAN content-download URL (concurrency 4, 8s timeout, 8MB cap) —
 *      the path the IDBots pilot proved against the live indexer;
 *   2. so.metaid.io `POST /api/metaweb/pins:batch` (50 pins per round trip,
 *      payload never truncated server-side) for rows that still have no body —
 *      pins missing from the MetaWeb layer answer as isolated {error} entries
 *      and simply stay degraded until a later sweep recovers them.
 */
import { type MetaTaskCollectedPath } from './engine/constants';
import type { MetaTaskChainEvent } from './engine/types';
export declare const DEFAULT_MANAPI_COLLECTOR_BASE_URL = "https://manapi.metaid.io";
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
/** One MAN indexer list row, exactly as the API returns it. */
export interface MetaTaskPoolRow {
    pinId: string;
    item: Record<string, unknown>;
    timestampMs: number | null;
}
export declare const normalizeChainEvent: (pinId: string, rawItem: Record<string, unknown>, fallbackTimestampMs: number | null) => MetaTaskChainEvent | null;
/**
 * Index collected roster pins by pinId for the engine's `rosterPins` option
 * (same-side review filtering). The body is the parsed pin content as-is:
 * `metatask publish` writes `{ groups: string[][], owner, createdAt }`, which
 * is exactly the shape `rosterGroupsFor` reads. Roster bodies are reference
 * data — a malformed one yields no groups and therefore no filtering.
 */
export declare const rosterPinsFromEvents: (events: MetaTaskChainEvent[]) => Record<string, unknown>;
export interface CollectMetaTaskEventsOptions {
    fetchImpl?: FetchLike;
    manapiBaseUrl?: string;
    /** so.metaid.io base for the pins:batch recovery tier (default: public host). */
    surfBaseUrl?: string;
    /** Disable the so.metaid.io recovery tier (tests that fake only MANAPI). */
    disableSurfRecovery?: boolean;
    pageSize?: number;
    maxPages?: number;
    timeoutMs?: number;
}
export interface CollectMetaTaskEventsResult {
    events: MetaTaskChainEvent[];
    perPath: {
        path: MetaTaskCollectedPath;
        count: number;
    }[];
}
export declare function collectMetaTaskEvents(options?: CollectMetaTaskEventsOptions): Promise<CollectMetaTaskEventsResult>;
export {};
