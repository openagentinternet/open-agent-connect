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

import {
  METATASK_COLLECTED_PATHS,
  METATASK_ROSTER_SEGMENT,
  metataskPoolPath,
  type MetaTaskCollectedPath,
} from './engine/constants';
import type { MetaTaskChainEvent } from './engine/types';
import { metawebPinsBatch, isBatchErrorEntry } from '../surf/surfReads';

/** manapi silently falls back to 20 rows/page for size > 100. */
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_TIMEOUT_MS = 8_000;

/** Extra content downloads per sweep (rows needing recovery only). */
const CONTENT_RECOVERY_CONCURRENCY = 4;
const CONTENT_FETCH_TIMEOUT_MS = 8_000;
/** Refuse a pathological download rather than buffering it in memory. */
const CONTENT_MAX_BYTES = 8 * 1024 * 1024;
/**
 * The indexer truncates `contentSummary` to the first 4096 bytes, but JSON
 * escaping can legitimately shift the byte count, so a declared length only
 * counts as "longer than what we have" past this margin.
 */
const TRUNCATION_MARGIN_BYTES = 16;

export const DEFAULT_MANAPI_COLLECTOR_BASE_URL = 'https://manapi.metaid.io';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const CONTENT_URL_RE = /^https?:\/\/[^/\s]+\/content\//i;

/** True when `value` looks like a MAN content-download URL (not a JSON body). */
const looksLikeContentUrl = (value: unknown): boolean =>
  typeof value === 'string' && CONTENT_URL_RE.test(value.trim());

const parseBody = (item: Record<string, unknown>): Record<string, unknown> => {
  const contentBody = item.contentBody;
  if (typeof contentBody === 'string' && contentBody) {
    try {
      const parsed = JSON.parse(Buffer.from(contentBody, 'base64').toString('utf-8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through to contentSummary
    }
  }
  const contentSummary = item.contentSummary;
  if (typeof contentSummary === 'string' && contentSummary) {
    try {
      const parsed = JSON.parse(contentSummary);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through to empty body
    }
  }
  return {};
};

const normalizeTimestampMs = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed >= 10_000_000_000 ? Math.floor(parsed) : Math.floor(parsed * 1000);
};

const isEmptyBody = (body: Record<string, unknown>): boolean => Object.keys(body).length === 0;

/** Byte length of the inline summary exactly as the indexer would count it. */
const inlineSummaryByteLength = (item: Record<string, unknown>): number =>
  typeof item.contentSummary === 'string' ? Buffer.byteLength(item.contentSummary, 'utf8') : 0;

const declaredContentLength = (item: Record<string, unknown>): number | null => {
  const value = Number(item.contentLength);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
};

/**
 * The download URL to refetch when this row's inline body may be truncated,
 * or null when the inline body is complete (a healthy small pin must never
 * cost a request).
 *
 *  - no usable body at all ({} = parse failure or absent) + a content URL → refetch;
 *  - the row declares more bytes than the inline summary holds (beyond the
 *    escaping margin) → refetch even though the summary parsed. A non-empty
 *    `contentBody` is the full payload by contract (pre-f23e8ec list format), so
 *    such rows never qualify.
 */
const contentRecoveryUrl = (
  item: Record<string, unknown>,
  body: Record<string, unknown>
): string | null => {
  const url = typeof item.content === 'string' ? item.content.trim() : '';
  // A content-download URL is never the body.
  if (!looksLikeContentUrl(url)) return null;
  if (isEmptyBody(body)) return url;
  const contentBody = item.contentBody;
  if (typeof contentBody === 'string' && contentBody.trim()) return null;
  const declared = declaredContentLength(item);
  if (declared === null) return null;
  return declared > inlineSummaryByteLength(item) + TRUNCATION_MARGIN_BYTES ? url : null;
};

/**
 * Fetch a pin's full body from its content URL (plain text → JSON object).
 * Any failure — non-2xx, timeout, transport error, non-object JSON, oversized
 * body — returns null so the caller keeps whatever it parsed inline.
 */
const fetchContentBody = async (
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number
): Promise<Record<string, unknown> | null> => {
  const init: RequestInit = {};
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    init.signal = AbortSignal.timeout(timeoutMs);
  }
  try {
    const response = await fetchImpl(url, init);
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > CONTENT_MAX_BYTES) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

/** One MAN indexer list row, exactly as the API returns it. */
export interface MetaTaskPoolRow {
  pinId: string;
  item: Record<string, unknown>;
  timestampMs: number | null;
}

/**
 * Page one pool to the empty page (cursor pagination). A failed pool must not
 * fail the whole sweep — the caller catches and records per-path counts.
 */
async function fetchPoolRows(
  poolPath: string,
  options: Required<Pick<CollectMetaTaskEventsOptions, 'pageSize' | 'maxPages' | 'timeoutMs' | 'fetchImpl'>> & {
    baseUrl: string;
  }
): Promise<MetaTaskPoolRow[]> {
  const rows: MetaTaskPoolRow[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < options.maxPages; page += 1) {
    const url = new URL(`${options.baseUrl}/api/pin/path/list`);
    url.searchParams.set('path', poolPath);
    url.searchParams.set('size', String(options.pageSize));
    if (cursor) url.searchParams.set('cursor', cursor);
    const init: RequestInit = {};
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      init.signal = AbortSignal.timeout(options.timeoutMs);
    }
    let payload: unknown;
    try {
      const response = await options.fetchImpl(url.toString(), init);
      if (!response.ok) break;
      payload = await response.json();
    } catch {
      break;
    }
    if (!payload || typeof payload !== 'object') break;
    // MANAPI success code is 1; anything else is an error envelope.
    if ((payload as { code?: unknown }).code !== 1) break;
    const data = (payload as { data?: unknown }).data;
    if (!data || typeof data !== 'object') break;
    const list = (data as { list?: unknown }).list;
    if (!Array.isArray(list)) break; // empty pool returns "list": null
    for (const raw of list) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const item = raw as Record<string, unknown>;
      const pinId = typeof item.id === 'string' ? item.id.trim() : '';
      if (!pinId || seen.has(pinId)) continue;
      seen.add(pinId);
      rows.push({ pinId, item, timestampMs: normalizeTimestampMs(item.timestamp) || null });
    }
    const nextCursor = (data as { nextCursor?: unknown }).nextCursor;
    cursor = typeof nextCursor === 'string' && nextCursor.trim() ? nextCursor : undefined;
    if (!cursor) break;
  }
  return rows;
}

export const normalizeChainEvent = (
  pinId: string,
  rawItem: Record<string, unknown>,
  fallbackTimestampMs: number | null
): MetaTaskChainEvent | null => {
  const path = String(rawItem.path ?? '').split('/').pop() ?? '';
  const heightRaw = Number(rawItem.genesisHeight);
  const height = Number.isFinite(heightRaw) ? Math.floor(heightRaw) : -1;
  if (!pinId || !path) return null;
  return {
    pinId,
    path: path as MetaTaskCollectedPath,
    author: typeof rawItem.globalMetaId === 'string' ? rawItem.globalMetaId : '',
    height,
    txIndex: Number.isFinite(Number(rawItem.txIndex)) ? Number(rawItem.txIndex) : 0,
    timestampMs: normalizeTimestampMs(rawItem.timestamp) || (fallbackTimestampMs ?? 0),
    body: parseBody(rawItem),
  };
};

/**
 * Index collected roster pins by pinId for the engine's `rosterPins` option
 * (same-side review filtering). The body is the parsed pin content as-is:
 * `metatask publish` writes `{ groups: string[][], owner, createdAt }`, which
 * is exactly the shape `rosterGroupsFor` reads. Roster bodies are reference
 * data — a malformed one yields no groups and therefore no filtering.
 */
export const rosterPinsFromEvents = (
  events: MetaTaskChainEvent[]
): Record<string, unknown> => {
  const pins: Record<string, unknown> = {};
  for (const event of events) {
    if (event.path === METATASK_ROSTER_SEGMENT) pins[event.pinId] = event.body;
  }
  return pins;
};

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
  perPath: { path: MetaTaskCollectedPath; count: number }[];
}

export async function collectMetaTaskEvents(
  options: CollectMetaTaskEventsOptions = {}
): Promise<CollectMetaTaskEventsResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const events: MetaTaskChainEvent[] = [];
  const perPath: { path: MetaTaskCollectedPath; count: number }[] = [];
  // Rows whose inline body looks truncated; recovered once, after the walk.
  const pendingRecoveries: { event: MetaTaskChainEvent; url: string | null; raw: Record<string, unknown> }[] = [];

  for (const segment of METATASK_COLLECTED_PATHS) {
    let rows: MetaTaskPoolRow[] = [];
    try {
      rows = await fetchPoolRows(metataskPoolPath(segment), {
        baseUrl: (options.manapiBaseUrl ?? DEFAULT_MANAPI_COLLECTOR_BASE_URL).replace(/\/+$/, ''),
        fetchImpl,
        pageSize,
        maxPages,
        timeoutMs,
      });
    } catch {
      rows = []; // a failed path must not fail the whole sweep
    }
    let count = 0;
    for (const row of rows) {
      const event = normalizeChainEvent(row.pinId, row.item, row.timestampMs);
      if (event && event.path === segment) {
        events.push(event);
        // The content URL is absolute — fetch it as-is regardless of the
        // manapi base the row was listed from.
        const recoveryUrl = contentRecoveryUrl(row.item, event.body);
        if (recoveryUrl !== null || isEmptyBody(event.body)) {
          pendingRecoveries.push({ event, url: recoveryUrl, raw: row.item });
        }
        count += 1;
      }
    }
    perPath.push({ path: segment, count });
  }

  // Tier 1: content-download URLs, bounded concurrency.
  const urlPending = pendingRecoveries.filter((entry) => entry.url !== null);
  if (urlPending.length > 0) {
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(CONTENT_RECOVERY_CONCURRENCY, urlPending.length) },
      async () => {
        while (cursor < urlPending.length) {
          const index = cursor;
          cursor += 1;
          const entry = urlPending[index];
          const body = await fetchContentBody(entry.url as string, fetchImpl, timeoutMs);
          if (body) entry.event.body = body; // else keep the inline (possibly empty) body
        }
      }
    );
    await Promise.all(workers);
  }

  // Tier 2: so.metaid.io pins:batch for rows that still have no body at all.
  if (!options.disableSurfRecovery) {
    const stillEmpty = pendingRecoveries.filter((entry) => isEmptyBody(entry.event.body));
    for (let offset = 0; offset < stillEmpty.length; offset += 50) {
      const slice = stillEmpty.slice(offset, offset + 50);
      let entries: Awaited<ReturnType<typeof metawebPinsBatch>> | null = null;
      try {
        entries = await metawebPinsBatch(
          slice.map((entry) => entry.event.pinId),
          { baseUrl: options.surfBaseUrl, fetchImpl, timeoutMs }
        );
      } catch {
        continue; // the MetaWeb layer is optional resilience, never a dependency
      }
      for (const entry of slice) {
        const found = entries?.[entry.event.pinId];
        if (found && !isBatchErrorEntry(found)) {
          const payload = found.payload;
          if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            entry.event.body = payload as Record<string, unknown>;
          }
        }
      }
    }
  }

  return { events, perPath };
}
