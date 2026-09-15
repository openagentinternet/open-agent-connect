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

export const DEFAULT_MANAPI_BASE_URL = 'https://manapi.metaid.io';
const DEFAULT_TIMEOUT_MS = 10_000;

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

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeItem(raw: unknown): ManapiPathListItem {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    pinId: text(record.id),
    timestamp: Number(record.timestamp) || 0,
    seenTime: Number(record.seenTime) || 0,
    globalMetaId: text(record.globalMetaId),
    address: text(record.address),
    path: text(record.path),
    contentType: text(record.contentType),
    contentSummary: typeof record.contentSummary === 'string' ? record.contentSummary : '',
    operation: text(record.operation),
  };
}

function resolveOptions(options?: ManapiPinServiceOptions) {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required for MANAPI pin reads.');
  }
  return {
    baseUrl: (options?.baseUrl || DEFAULT_MANAPI_BASE_URL).replace(/\/+$/, ''),
    fetchImpl,
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

/** GET /api/pin/path/list?path=…&size=… — newest first. */
export async function listPinsByPath(
  params: { path: string; size?: number; cursor?: string },
  options?: ManapiPinServiceOptions,
): Promise<ManapiPathListPage> {
  const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
  const path = params.path.trim();
  if (!path) throw new Error('path is required to list pins by path.');
  const query = new URLSearchParams({ path });
  if (typeof params.size === 'number' && params.size > 0) {
    query.set('size', String(Math.min(100, Math.floor(params.size))));
  }
  if (params.cursor?.trim()) query.set('cursor', params.cursor.trim());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/api/pin/path/list?${query.toString()}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      throw new Error(`MANAPI returned an invalid response (HTTP ${response.status}).`);
    }
    // MANAPI success code is 1; anything else is an error envelope.
    if (Number(body.code) !== 1) {
      throw new Error(`MANAPI error ${Number(body.code) || '?'}: ${text(body.message) || 'unknown error'}`);
    }
    const data = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>;
    const items = Array.isArray(data.list) ? data.list.map(normalizeItem) : [];
    const nextCursor = text(data.nextCursor) || null;
    return { items, nextCursor, hasMore: Boolean(nextCursor) };
  } finally {
    clearTimeout(timer);
  }
}
