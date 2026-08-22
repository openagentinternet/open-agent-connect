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

export const DEFAULT_METAAPP_SEARCH_BASE_URL = 'https://so.metaid.io';
const METASO_P2P_BASE_URL_ENV = 'METASO_P2P_BASE_URL';
const DEFAULT_TIMEOUT_MS = 15_000;
const SEARCH_RETRY_ATTEMPTS = 2;
const SEARCH_RETRY_DELAY_MS = 400;
const MAX_PAGE_SIZE = 100;

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type MetaAppSearchFetchFn = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<FetchResponse>;

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

export class MetaAppSearchApiError extends Error {
  readonly apiCode: number;

  constructor(apiCode: number, message: string) {
    super(`MetaApp search API error ${apiCode}: ${message}`);
    this.name = 'MetaAppSearchApiError';
    this.apiCode = apiCode;
  }
}

export class MetaAppSearchNotFoundError extends MetaAppSearchApiError {
  constructor(message: string) {
    super(40400, message);
    this.name = 'MetaAppSearchNotFoundError';
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

function normalizeItem(raw: unknown): MetaAppSearchItem {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    pinId: text(record.pinId),
    sourcePinId: text(record.sourcePinId),
    chainName: text(record.chainName),
    title: text(record.title),
    appName: text(record.appName),
    intro: text(record.intro),
    tags: textList(record.tags),
    runtime: text(record.runtime),
    version: text(record.version),
    content: text(record.content),
    indexFile: text(record.indexFile) || 'index.html',
    forkedFrom: text(record.forkedFrom),
    disabled: record.disabled === true || record.disabled === 'true',
    publisherGlobalMetaId: text(record.publisherGlobalMetaId),
    publisherMetaId: text(record.publisherMetaId),
    publisherAddress: text(record.publisherAddress),
    publisherName: text(record.publisherName),
    publisherAvatarId: text(record.publisherAvatarId),
    createdAt: Number(record.createdAt) || 0,
    updatedAt: Number(record.updatedAt) || 0,
  };
}

function normalizePage(raw: unknown): MetaAppSearchPage {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const items = Array.isArray(record.items) ? record.items.map(normalizeItem) : [];
  return {
    items,
    nextCursor: text(record.nextCursor) || null,
    hasMore: record.hasMore === true,
  };
}

function isTransientSearchError(error: unknown): boolean {
  if (error instanceof MetaAppSearchApiError) {
    return false;
  }
  const name = error && typeof error === 'object' ? String((error as { name?: unknown }).name || '') : '';
  if (name === 'AbortError' || name === 'TimeoutError') {
    return true;
  }
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('aborted')
    || message.includes('fetch failed')
    || message.includes('failed to fetch')
    || message.includes('timed out')
    || message.includes('timeout')
    || message.includes('network')
    || message.includes('econnreset')
    || message.includes('etimedout');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchApiDataOnce(
  url: string,
  fetchFn: MetaAppSearchFetchFn,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      throw new Error(`MetaApp search API returned an invalid response (HTTP ${response.status}).`);
    }
    const code = Number(body.code);
    if (code === 0) {
      return (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>;
    }
    const message = text(body.message) || 'unknown error';
    if (code === 40400) {
      throw new MetaAppSearchNotFoundError(message);
    }
    throw new MetaAppSearchApiError(Number.isFinite(code) ? code : -1, message);
  } catch (error) {
    if (error instanceof MetaAppSearchApiError) {
      throw error;
    }
    if (controller.signal.aborted || (error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError')) {
      throw new Error(`MetaApp search timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchApiData(
  url: string,
  fetchFn: MetaAppSearchFetchFn,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SEARCH_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await fetchApiDataOnce(url, fetchFn, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt >= SEARCH_RETRY_ATTEMPTS || !isTransientSearchError(error)) {
        throw error;
      }
      await delay(SEARCH_RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

export type MetaAppSearchApiOptions = {
  baseUrl?: string;
  fetchFn?: MetaAppSearchFetchFn;
  timeoutMs?: number;
};

function normalizeBaseUrl(value: unknown): string {
  const candidate = text(value);
  return (candidate || DEFAULT_METAAPP_SEARCH_BASE_URL).replace(/\/+$/u, '') || DEFAULT_METAAPP_SEARCH_BASE_URL;
}

function resolveOptions(options: MetaAppSearchApiOptions | undefined): {
  baseUrl: string;
  fetchFn: MetaAppSearchFetchFn;
  timeoutMs: number;
} {
  const fetchFn = options?.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('A fetch implementation is required for MetaApp search.');
  }
  return {
    baseUrl: normalizeBaseUrl(options?.baseUrl ?? process.env[METASO_P2P_BASE_URL_ENV]),
    fetchFn,
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

/** GET /api/metaapp/list — global feed & intent search. */
export async function searchMetaApps(
  params: MetaAppSearchParams,
  options?: MetaAppSearchApiOptions,
): Promise<MetaAppSearchPage> {
  const { baseUrl, fetchFn, timeoutMs } = resolveOptions(options);
  const query = new URLSearchParams();
  if (params.keyword?.trim()) query.set('keyword', params.keyword.trim());
  if (params.tag?.trim()) query.set('tag', params.tag.trim());
  if (params.chainName?.trim()) query.set('chainName', params.chainName.trim());
  if (params.runtime?.trim()) query.set('runtime', params.runtime.trim());
  if (params.publisher?.trim()) query.set('publisher', params.publisher.trim());
  if (typeof params.since === 'number' && params.since > 0) query.set('since', String(Math.floor(params.since)));
  if (typeof params.until === 'number' && params.until > 0) query.set('until', String(Math.floor(params.until)));
  if (params.includeDisabled) query.set('includeDisabled', '1');
  if (typeof params.size === 'number' && params.size > 0) query.set('size', String(Math.min(MAX_PAGE_SIZE, Math.floor(params.size))));
  if (params.cursor?.trim()) query.set('cursor', params.cursor.trim());
  const qs = query.toString();
  const data = await fetchApiData(`${baseUrl}/api/metaapp/list${qs ? `?${qs}` : ''}`, fetchFn, timeoutMs);
  return normalizePage(data);
}

/** GET /api/metaapp/forks/:pinId — direct remix children of an app. */
export async function listMetaAppForks(
  input: { pinId: string; size?: number; cursor?: string },
  options?: MetaAppSearchApiOptions,
): Promise<MetaAppSearchPage> {
  const { baseUrl, fetchFn, timeoutMs } = resolveOptions(options);
  const pinId = input.pinId.trim().toLowerCase();
  if (!pinId) throw new Error('pinId is required to list MetaApp forks.');
  const query = new URLSearchParams();
  if (typeof input.size === 'number' && input.size > 0) query.set('size', String(Math.min(MAX_PAGE_SIZE, Math.floor(input.size))));
  if (input.cursor?.trim()) query.set('cursor', input.cursor.trim());
  const qs = query.toString();
  const data = await fetchApiData(`${baseUrl}/api/metaapp/forks/${encodeURIComponent(pinId)}${qs ? `?${qs}` : ''}`, fetchFn, timeoutMs);
  return normalizePage(data);
}

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

export function trimMetaAppSearchItems(
  items: MetaAppSearchItem[],
  ownGlobalMetaIds: ReadonlySet<string>,
): TrimmedMetaAppSearchItem[] {
  const ownIds = new Set(
    [...ownGlobalMetaIds].map((id) => id.trim().toLowerCase()).filter(Boolean),
  );
  return items.map((item) => {
    const publisherGlobalMetaId = item.publisherGlobalMetaId;
    return {
      pinId: item.pinId,
      title: item.title,
      appName: item.appName,
      intro: item.intro,
      tags: item.tags,
      runtime: item.runtime,
      version: item.version,
      updatedAt: item.updatedAt,
      publisherGlobalMetaId,
      publisherName: item.publisherName,
      publisherAvatarId: item.publisherAvatarId,
      forkedFrom: item.forkedFrom,
      isOwn: Boolean(publisherGlobalMetaId) && ownIds.has(publisherGlobalMetaId.trim().toLowerCase()),
    };
  });
}
