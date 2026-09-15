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
import { normalizePin, type MetawebPin } from '../metaweb/pinRead.js';

export const DEFAULT_METAWEB_SURF_READS_BASE_URL = 'https://so.metaid.io';
const DEFAULT_TIMEOUT_MS = 10_000;
/** R2 hard cap on pinIds per batch request. */
export const METAWEB_PINS_BATCH_MAX = 50;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const numOrNull = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export class MetawebPinVersionsNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetawebPinVersionsNotFoundError';
  }
}

export type MetawebSurfReadsOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function resolveOptions(options: MetawebSurfReadsOptions | undefined): Required<MetawebSurfReadsOptions> {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required for MetaWeb surf reads.');
  }
  return {
    baseUrl: (options?.baseUrl ?? DEFAULT_METAWEB_SURF_READS_BASE_URL).replace(/\/+$/, ''),
    fetchImpl,
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

type Envelope = Record<string, unknown>;

async function requestEnvelope(
  url: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Envelope> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: init.method,
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch (error) {
      // Map the raw AbortError to an actionable timeout message — the model
      // sees this text verbatim in the tool result / section error.
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`MetaWeb surf-reads API timed out after ${Math.round(timeoutMs / 1000)}s — try again later.`);
      }
      throw error;
    }
    const body = await response.json().catch(() => null) as Envelope | null;
    if (!body || typeof body !== 'object') {
      throw new Error(`MetaWeb surf-reads API returned an invalid response (HTTP ${response.status}).`);
    }
    const code = Number(body.code);
    if (code === 0) {
      return (body.data && typeof body.data === 'object' ? body.data : {}) as Envelope;
    }
    const message = text(body.message) || 'unknown error';
    if (code === 40400) {
      throw new MetawebPinVersionsNotFoundError(message);
    }
    throw new Error(`MetaWeb surf-reads API error ${code}: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

const getEnvelope = (
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Envelope> => requestEnvelope(url, { method: 'GET' }, fetchImpl, timeoutMs);

// ---------------- R1: fresh feed ----------------

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

function normalizeFreshAuthor(raw: unknown): MetawebFreshAuthor {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    address: text(record.address),
    metaid: text(record.metaid ?? record.metaId),
    globalMetaId: text(record.globalMetaId),
    name: text(record.name),
  };
}

function normalizeFreshItem(raw: unknown): MetawebFreshItem {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pinId = text(record.pinId);
  const duplicates = Number(record.duplicates);
  return {
    pinId,
    currentPinId: text(record.currentPinId) || pinId,
    protocol: text(record.protocol),
    path: text(record.path),
    chainName: text(record.chainName),
    createdAt: Number(record.createdAt) || 0,
    author: normalizeFreshAuthor(record.author),
    title: text(record.title),
    summary: text(record.summary),
    likeCount: numOrNull(record.likeCount),
    commentCount: numOrNull(record.commentCount),
    duplicates: Number.isFinite(duplicates) && duplicates > 0 ? Math.floor(duplicates) : null,
  };
}

/**
 * R1 — deterministic fresh-items feed. `since` is INCLUSIVE (unix seconds);
 * `cursor` is an opaque server token from a previous page (pins the exact
 * index key, so paging is gap-free and duplicate-free).
 */
export async function metawebFresh(
  input: {
    protocols: string[];
    since?: number;
    size?: number;
    cursor?: string;
    dedupe?: 'identical';
    maxPerAuthor?: number;
  },
  options?: MetawebSurfReadsOptions,
): Promise<MetawebFreshPage> {
  const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
  const protocols = (input.protocols ?? []).map((key) => String(key ?? '').trim()).filter(Boolean);
  if (protocols.length === 0) {
    throw new Error('metawebFresh requires at least one protocol.');
  }
  const url = new URL(`${baseUrl}/api/metaweb/fresh`);
  url.searchParams.set('protocols', protocols.join(','));
  if (input.since !== undefined) url.searchParams.set('since', String(Math.floor(input.since)));
  if (input.size !== undefined) url.searchParams.set('size', String(Math.floor(input.size)));
  if (input.cursor) url.searchParams.set('cursor', input.cursor);
  if (input.dedupe) url.searchParams.set('dedupe', input.dedupe);
  if (input.maxPerAuthor !== undefined) url.searchParams.set('maxPerAuthor', String(Math.floor(input.maxPerAuthor)));
  const data = await getEnvelope(url.toString(), fetchImpl, timeoutMs);
  const suppressedRaw = (data.suppressed && typeof data.suppressed === 'object' ? data.suppressed : null) as Record<string, unknown> | null;
  return {
    items: Array.isArray(data.items) ? data.items.map(normalizeFreshItem) : [],
    hasMore: data.hasMore === true,
    nextCursor: text(data.nextCursor) || null,
    suppressed: suppressedRaw
      ? {
          duplicates: Number(suppressedRaw.duplicates) || 0,
          throttled: Number(suppressedRaw.throttled) || 0,
        }
      : null,
  };
}

// ---------------- R2: batch pin read ----------------

export type MetawebBatchPin = MetawebPin & {
  version: { latest: string; count: number | null };
};

/** Per-pin failure entries are isolated server-side: {pinId, error}. */
export type MetawebBatchEntry = MetawebBatchPin | { pinId: string; error: string };

export const isBatchErrorEntry = (entry: MetawebBatchEntry): entry is { pinId: string; error: string } =>
  'error' in entry && typeof (entry as { error?: unknown }).error === 'string';

function normalizeBatchEntry(pinId: string, raw: unknown): MetawebBatchEntry {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error.trim()) {
    return { pinId: text(record.pinId) || pinId, error: record.error.trim() };
  }
  const versionRaw = (record.version && typeof record.version === 'object' ? record.version : {}) as Record<string, unknown>;
  const count = Number(versionRaw.count);
  const pin = normalizePin(record);
  return {
    ...pin,
    pinId: pin.pinId || pinId,
    version: {
      latest: text(versionRaw.latest) || pin.currentPinId || pin.pinId,
      count: Number.isFinite(count) && count >= 0 ? Math.floor(count) : null,
    },
  };
}

/**
 * R2 — read up to 50 pins in one round trip. The response is a map keyed by
 * the requested pinId; entries are full pin objects (same shape as
 * GET /api/metaweb/pin/:id plus version info) or isolated {error} entries.
 * `text` is capped at 8000 runes per pin (truncated/totalLength say so);
 * `payload` is NEVER truncated.
 */
export async function metawebPinsBatch(
  pinIds: string[],
  options?: MetawebSurfReadsOptions,
): Promise<Record<string, MetawebBatchEntry>> {
  const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
  const ids = (pinIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new Error('metawebPinsBatch requires at least one pinId.');
  }
  if (ids.length > METAWEB_PINS_BATCH_MAX) {
    throw new Error(`metawebPinsBatch accepts at most ${METAWEB_PINS_BATCH_MAX} pinIds per call (got ${ids.length}).`);
  }
  const data = await requestEnvelope(
    `${baseUrl}/api/metaweb/pins:batch`,
    { method: 'POST', body: { pinIds: ids } },
    fetchImpl,
    timeoutMs,
  );
  const pinsRaw = (data.pins && typeof data.pins === 'object' ? data.pins : {}) as Record<string, unknown>;
  const out: Record<string, MetawebBatchEntry> = {};
  for (const requestedId of ids) {
    if (requestedId in pinsRaw) {
      out[requestedId] = normalizeBatchEntry(requestedId, pinsRaw[requestedId]);
    } else {
      out[requestedId] = { pinId: requestedId, error: 'pin missing from batch response' };
    }
  }
  return out;
}

// ---------------- R3: interactions (deterministic inbox) ----------------

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

function normalizeInteraction(raw: unknown): MetawebInteractionItem {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    type: text(record.type),
    pinId: text(record.pinId),
    targetPinId: text(record.targetPinId),
    actor: normalizeFreshAuthor(record.actor),
    createdAt: Number(record.createdAt) || 0,
    excerpt: text(record.excerpt),
  };
}

/**
 * R3 — the deterministic inbox: likes/comments on the owner's pins plus
 * answers to the owner's questions. `owner` is an address, metaId or
 * globalMetaId (any case). `since` is unix seconds, inclusive.
 */
export async function metawebInteractions(
  input: {
    owner: string;
    since?: number;
    types?: string;
    size?: number;
    cursor?: string;
  },
  options?: MetawebSurfReadsOptions,
): Promise<MetawebInteractionsPage> {
  const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
  const owner = text(input.owner);
  if (!owner) {
    throw new Error('metawebInteractions requires an owner (address, metaId or globalMetaId).');
  }
  const url = new URL(`${baseUrl}/api/metaweb/interactions`);
  url.searchParams.set('owner', owner);
  if (input.since !== undefined) url.searchParams.set('since', String(Math.floor(input.since)));
  if (input.types) url.searchParams.set('types', input.types);
  if (input.size !== undefined) url.searchParams.set('size', String(Math.floor(input.size)));
  if (input.cursor) url.searchParams.set('cursor', input.cursor);
  const data = await getEnvelope(url.toString(), fetchImpl, timeoutMs);
  return {
    items: Array.isArray(data.items) ? data.items.map(normalizeInteraction) : [],
    hasMore: data.hasMore === true,
    nextCursor: text(data.nextCursor) || null,
  };
}

// ---------------- R4: pin versions ----------------

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
export async function metawebPinVersions(
  pinId: string,
  options?: MetawebSurfReadsOptions,
): Promise<MetawebPinVersions> {
  const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
  const trimmed = text(pinId);
  if (!trimmed) throw new Error('pinId is required to read MetaWeb pin versions.');
  const data = await getEnvelope(
    `${baseUrl}/api/metaweb/pin/${encodeURIComponent(trimmed)}/versions`,
    fetchImpl,
    timeoutMs,
  );
  const attribution = text(data.attribution);
  return {
    pinId: text(data.pinId) || trimmed,
    latest: text(data.latest),
    attribution: attribution === 'local' ? 'local' : 'chain',
    versions: Array.isArray(data.versions)
      ? data.versions.map((raw) => {
          const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
          return {
            pinId: text(record.pinId),
            // The server sends `version` as a JSON NUMBER (1, 2, …) — the
            // text() helper would blank it; stringify explicitly.
            version: record.version === undefined || record.version === null ? '' : String(record.version),
            createdAt: Number(record.createdAt) || 0,
            operation: text(record.operation),
            author: normalizeFreshAuthor(record.author),
          };
        })
      : [],
  };
}

// ---------------- R6: protocol radar ----------------

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
  rejected: Array<{ pinId: string; reason: string }>;
  hasMore: boolean;
  nextCursor: string | null;
};

function normalizeProtocolRadarItem(raw: unknown): MetawebProtocolRadarItem {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pinId = text(record.pinId);
  return {
    pinId,
    currentPinId: text(record.currentPinId) || pinId,
    chainName: text(record.chainName),
    createdAt: Number(record.createdAt) || 0,
    author: normalizeFreshAuthor(record.author),
    path: text(record.path),
    title: text(record.title),
    protocolName: text(record.protocolName),
    intro: text(record.intro),
    version: text(record.version),
  };
}

/** R6 — validated registry of /protocols/* declarations, newest first. */
export async function metawebProtocols(
  input: { size?: number; cursor?: string } = {},
  options?: MetawebSurfReadsOptions,
): Promise<MetawebProtocolRadarPage> {
  const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
  const url = new URL(`${baseUrl}/api/metaweb/protocols`);
  if (input.size !== undefined) url.searchParams.set('size', String(Math.floor(input.size)));
  if (input.cursor) url.searchParams.set('cursor', input.cursor);
  const data = await getEnvelope(url.toString(), fetchImpl, timeoutMs);
  return {
    items: Array.isArray(data.items) ? data.items.map(normalizeProtocolRadarItem) : [],
    rejected: Array.isArray(data.rejected)
      ? data.rejected.map((raw) => {
          const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
          return { pinId: text(record.pinId), reason: text(record.reason) };
        })
      : [],
    hasMore: data.hasMore === true,
    nextCursor: text(data.nextCursor) || null,
  };
}
