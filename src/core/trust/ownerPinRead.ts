// Chain read for /info/owner pins: resolves the LATEST binding pin at
// /info/owner for an arbitrary subject GlobalMetaID. Two public indexers,
// split by what each actually serves (the omni-read convention):
//   1. GET {infoBase}/api/v1/info/globalmetaid/:globalMetaId
//      -> the subject's MVC address. The metafile-indexer is the ONLY public
//      indexer serving globalmetaid user info — manapi's /api/info/metaid
//      route answers a globalmetaid with an empty record (isInit:false,
//      address:""), which silently resolved every subject to "unbound".
//   2. GET {base}/api/address/pin/list/:address?path=/info/owner -> newest pin row
//   3. GET {base}/content/:pinId                            -> full (untruncated) payload
//      Steps 2-3 stay on the MANAPI base (the same endpoints the rest of the
//      codebase reads: `lookupPeerChatPublicKey` / `manOwnerList`).
// `contentSummary` in list rows is a truncated JSON preview, so the payload
// is always re-fetched by pinId. All reads are read-only HTTP GETs.
import { OWNER_BINDING_PATH } from '../owner/ownerBinding';

export const DEFAULT_OWNER_PIN_MANAPI_BASE_URL = 'https://manapi.metaid.io';
export const DEFAULT_OWNER_PIN_INFO_BASE_URL = 'https://file.metaid.io/metafile-indexer';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_LIST_SIZE = 20;

export interface LatestOwnerPin {
  pinId: string;
  /** Full pin payload string; null when the pin body is empty (unbound). */
  payload: string | null;
}

/** Injectable read seam: latest /info/owner pin for a subject GlobalMetaID, or null. */
export type OwnerPinReader = (globalMetaId: string) => Promise<LatestOwnerPin | null>;

export interface OwnerPinReadOptions {
  /** MANAPI base for the address-scoped routes (steps 2-3). */
  baseUrl?: string;
  /** metafile-indexer base for the globalmetaid user-info route (step 1). */
  infoBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface ResolvedOwnerPinReadOptions {
  baseUrl: string;
  infoBaseUrl: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}

function resolveOptions(options: OwnerPinReadOptions | undefined): ResolvedOwnerPinReadOptions {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required for owner pin reads.');
  }
  return {
    baseUrl: (options?.baseUrl ?? DEFAULT_OWNER_PIN_MANAPI_BASE_URL).replace(/\/+$/, ''),
    infoBaseUrl: (options?.infoBaseUrl ?? DEFAULT_OWNER_PIN_INFO_BASE_URL).replace(/\/+$/, ''),
    fetchImpl,
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function fetchJson(url: string, options: ResolvedOwnerPinReadOptions): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    return readObject(await response.json().catch(() => null));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Step 1: the subject's on-chain info record; the address drives the per-author pin list. */
export async function resolveMetaIdOwnerAddress(
  globalMetaId: string,
  options?: OwnerPinReadOptions,
): Promise<string | null> {
  const resolved = resolveOptions(options);
  const normalized = text(globalMetaId).toLowerCase();
  if (!normalized) return null;
  const body = await fetchJson(
    `${resolved.infoBaseUrl}/api/v1/info/globalmetaid/${encodeURIComponent(normalized)}`,
    resolved,
  );
  const data = readObject(body?.data) ?? body ?? {};
  return text(data.address) || null;
}

export interface AuthorPinListRow {
  pinId: string;
  operation: string;
  timestamp: number;
  path: string;
  globalMetaId: string;
}

function normalizeListRow(raw: unknown): AuthorPinListRow | null {
  const record = readObject(raw);
  if (!record) return null;
  const pinId = text(record.id ?? record.pinId ?? record.pin_id);
  if (!pinId) return null;
  return {
    pinId,
    operation: text(record.operation).toLowerCase(),
    timestamp: Number(record.timestamp) || 0,
    path: text(record.path),
    globalMetaId: text(record.globalMetaId ?? record.global_meta_id),
  };
}

/**
 * Step 2: the effective (latest, non-revoked) pin row the subject published
 * at `path`, newest first. Revoked rows mean "unbound" and are skipped;
 * malformed envelopes yield null instead of throwing (a read failure makes
 * the caller treat the subject as unbound — the conservative direction).
 */
export async function listLatestAuthorPin(
  address: string,
  path: string,
  options?: OwnerPinReadOptions,
): Promise<AuthorPinListRow | null> {
  const resolved = resolveOptions(options);
  const normalizedAddress = text(address);
  const normalizedPath = text(path);
  if (!normalizedAddress || !normalizedPath) return null;
  const url = new URL(`${resolved.baseUrl}/api/address/pin/list/${encodeURIComponent(normalizedAddress)}`);
  url.searchParams.set('path', normalizedPath);
  url.searchParams.set('size', String(DEFAULT_LIST_SIZE));
  const body = await fetchJson(url.toString(), resolved);
  if (!body) return null;
  const data = readObject(body.data);
  if (!data || Number(body.code) !== 1) return null;
  const rows = (Array.isArray(data.list) ? data.list : [])
    .map(normalizeListRow)
    .filter((row): row is AuthorPinListRow => row !== null && row.path === normalizedPath)
    .filter((row) => row.operation !== 'revoke' && row.operation !== 'delete' && row.operation !== 'deleted');
  if (rows.length === 0) return null;
  rows.sort((a, b) => (b.timestamp - a.timestamp) || a.pinId.localeCompare(b.pinId));
  return rows[0];
}

/** Step 3: the full pin body; an empty body means unbound (payload null). */
export async function fetchOwnerPinContent(
  pinId: string,
  options?: OwnerPinReadOptions,
): Promise<string | null> {
  const resolved = resolveOptions(options);
  const normalized = text(pinId);
  if (!normalized) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), resolved.timeoutMs);
  try {
    const response = await resolved.fetchImpl(`${resolved.baseUrl}/content/${encodeURIComponent(normalized)}`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = await response.text();
    return body.trim() ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Default OwnerPinReader: address -> latest /info/owner row -> full payload.
 * Any failed/empty step yields null (treated as "no verifiable binding").
 */
export function createOwnerPinReader(options?: OwnerPinReadOptions): OwnerPinReader {
  return async (globalMetaId: string): Promise<LatestOwnerPin | null> => {
    const address = await resolveMetaIdOwnerAddress(globalMetaId, options);
    if (!address) return null;
    const row = await listLatestAuthorPin(address, OWNER_BINDING_PATH, options);
    if (!row) return null;
    const payload = await fetchOwnerPinContent(row.pinId, options);
    return { pinId: row.pinId, payload };
  };
}

// ---------------------------------------------------------------------------
// Paged author-pin listing (P2): the trust-grant resolution needs ALL pins an
// author published at one path (grants AND revoke pins), newest first —
// unlike the single-latest-pin reader above.
// ---------------------------------------------------------------------------

const DEFAULT_LIST_PAGE_SIZE = 100;
const DEFAULT_LIST_MAX_PAGES = 5;

export interface AuthorPathPin {
  pinId: string;
  operation: string;
  /** Unix seconds; 0 when unknown. */
  timestamp: number;
  /** Full pin body; null when empty/unreadable (callers treat as absent). */
  payload: string | null;
}

/** Injectable seam: every pin `globalMetaId` published at `path`, newest first. */
export type OwnerPathPinLister = (globalMetaId: string, path: string) => Promise<AuthorPathPin[]>;

async function listAuthorPinRows(
  address: string,
  path: string,
  options: OwnerPathPinListOptions | undefined,
  resolved: ResolvedOwnerPinReadOptions,
): Promise<AuthorPinListRow[]> {
  const rows: AuthorPinListRow[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  const size = Math.max(1, Math.min(100, Math.floor(options?.pageSize ?? DEFAULT_LIST_PAGE_SIZE)));
  const maxPages = Math.max(1, Math.floor(options?.maxPages ?? DEFAULT_LIST_MAX_PAGES));
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`${resolved.baseUrl}/api/address/pin/list/${encodeURIComponent(address)}`);
    url.searchParams.set('path', path);
    url.searchParams.set('size', String(size));
    if (cursor) url.searchParams.set('cursor', cursor);
    const body = await fetchJson(url.toString(), resolved);
    if (!body) break;
    const data = readObject(body.data);
    if (!data || Number(body.code) !== 1) break;
    const list = Array.isArray(data.list) ? data.list : [];
    if (list.length === 0) break;
    for (const raw of list) {
      const row = normalizeListRow(raw);
      if (!row || row.path !== path) continue;
      if (row.operation === 'revoke' || row.operation === 'delete' || row.operation === 'deleted') continue;
      if (seen.has(row.pinId)) continue;
      seen.add(row.pinId);
      rows.push(row);
    }
    const nextCursor = text(data.nextCursor);
    cursor = nextCursor || undefined;
    if (!cursor) break;
  }
  return rows;
}

export interface OwnerPathPinListOptions extends OwnerPinReadOptions {
  pageSize?: number;
  maxPages?: number;
}

/**
 * All pins an author published at `path` (grants and revoke payloads alike;
 * operation-level revoked rows carry no payload and are skipped), each with
 * its full body fetched by pinId. Read failures degrade to fewer pins —
 * resolution treats a failed read as "nothing more to fold", same as an
 * absent author.
 */
export async function listAuthorPathPins(
  globalMetaId: string,
  path: string,
  options?: OwnerPathPinListOptions,
): Promise<AuthorPathPin[]> {
  const resolved = resolveOptions(options);
  const normalizedPath = text(path);
  const normalizedGmid = text(globalMetaId).toLowerCase();
  if (!normalizedPath || !normalizedGmid) return [];
  const address = await resolveMetaIdOwnerAddress(normalizedGmid, options);
  if (!address) return [];
  const rows = await listAuthorPinRows(address, normalizedPath, options, resolved);
  const pins: AuthorPathPin[] = [];
  for (const row of rows) {
    const payload = await fetchOwnerPinContent(row.pinId, options);
    pins.push({ pinId: row.pinId, operation: row.operation, timestamp: row.timestamp, payload });
  }
  return pins;
}

/** Default OwnerPathPinLister delegating to listAuthorPathPins. */
export function createOwnerPathPinLister(options?: OwnerPathPinListOptions): OwnerPathPinLister {
  return (globalMetaId: string, path: string) => listAuthorPathPins(globalMetaId, path, options);
}
