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

export const DEFAULT_METAID_SEARCH_BASE_URL = 'https://so.metaid.io';
const METASO_P2P_BASE_URL_ENV = 'METASO_P2P_BASE_URL';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_PAGE_SIZE = 100;

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type MetaIdSearchFetchFn = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<FetchResponse>;

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

export class MetaIdSearchApiError extends Error {
  readonly apiCode: number;

  constructor(apiCode: number, message: string) {
    super(`MetaID search API error ${apiCode}: ${message}`);
    this.name = 'MetaIdSearchApiError';
    this.apiCode = apiCode;
  }
}

export class MetaIdSearchNotFoundError extends MetaIdSearchApiError {
  constructor(message: string) {
    super(40400, message);
    this.name = 'MetaIdSearchNotFoundError';
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

function flag(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

function normalizeItem(raw: unknown): MetaIdSearchItem {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    globalMetaId: text(record.globalMetaId),
    metaId: text(record.metaId),
    address: text(record.address),
    chainName: text(record.chainName),
    name: text(record.name),
    avatarId: text(record.avatarId),
    bio: text(record.bio),
    chatSkills: textList(record.chatSkills),
    hasChatPubkey: flag(record.hasChatPubkey),
    hasHomepage: flag(record.hasHomepage),
    createdAt: Number(record.createdAt) || 0,
    updatedAt: Number(record.updatedAt) || 0,
  };
}

function normalizeDetail(raw: unknown): MetaIdDetail {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fieldPins = (record.fieldPins && typeof record.fieldPins === 'object' && !Array.isArray(record.fieldPins)
    ? record.fieldPins
    : {}) as Record<string, unknown>;
  return {
    ...normalizeItem(record),
    avatarContentType: text(record.avatarContentType),
    role: text(record.role),
    soul: text(record.soul),
    goal: text(record.goal),
    persona: record.persona ?? null,
    llm: record.llm ?? null,
    homepage: record.homepage ?? null,
    background: text(record.background),
    chatPubkey: text(record.chatPubkey),
    fieldPins: Object.fromEntries(
      Object.entries(fieldPins).map(([key, value]) => [key, text(value)]).filter(([, value]) => Boolean(value)),
    ),
  };
}

function normalizePage(raw: unknown): MetaIdSearchPage {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const items = Array.isArray(record.items) ? record.items.map(normalizeItem) : [];
  return {
    items,
    nextCursor: text(record.nextCursor) || null,
    hasMore: record.hasMore === true,
  };
}

async function fetchApiData(
  url: string,
  fetchFn: MetaIdSearchFetchFn,
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
      throw new Error(`MetaID search API returned an invalid response (HTTP ${response.status}).`);
    }
    const code = Number(body.code);
    if (code === 0) {
      return (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>;
    }
    const message = text(body.message) || 'unknown error';
    if (code === 40400) {
      throw new MetaIdSearchNotFoundError(message);
    }
    throw new MetaIdSearchApiError(Number.isFinite(code) ? code : -1, message);
  } finally {
    clearTimeout(timer);
  }
}

export type MetaIdSearchApiOptions = {
  baseUrl?: string;
  fetchFn?: MetaIdSearchFetchFn;
  timeoutMs?: number;
};

function normalizeBaseUrl(value: unknown): string {
  const candidate = text(value);
  return (candidate || DEFAULT_METAID_SEARCH_BASE_URL).replace(/\/+$/u, '') || DEFAULT_METAID_SEARCH_BASE_URL;
}

function resolveOptions(options: MetaIdSearchApiOptions | undefined): {
  baseUrl: string;
  fetchFn: MetaIdSearchFetchFn;
  timeoutMs: number;
} {
  const fetchFn = options?.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('A fetch implementation is required for MetaID search.');
  }
  return {
    baseUrl: normalizeBaseUrl(options?.baseUrl ?? process.env[METASO_P2P_BASE_URL_ENV]),
    fetchFn,
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

/** GET /api/metaid/list — global user feed & intent search. */
export async function searchMetaIds(
  params: MetaIdSearchParams,
  options?: MetaIdSearchApiOptions,
): Promise<MetaIdSearchPage> {
  const { baseUrl, fetchFn, timeoutMs } = resolveOptions(options);
  const query = new URLSearchParams();
  if (params.keyword?.trim()) query.set('keyword', params.keyword.trim());
  if (params.skill?.trim()) query.set('skill', params.skill.trim());
  if (params.chainName?.trim()) query.set('chainName', params.chainName.trim());
  if (params.hasChatPubkey) query.set('hasChatPubkey', '1');
  if (params.hasHomepage) query.set('hasHomepage', '1');
  if (typeof params.since === 'number' && params.since > 0) query.set('since', String(Math.floor(params.since)));
  if (typeof params.until === 'number' && params.until > 0) query.set('until', String(Math.floor(params.until)));
  if (typeof params.size === 'number' && params.size > 0) query.set('size', String(Math.min(MAX_PAGE_SIZE, Math.floor(params.size))));
  if (params.cursor?.trim()) query.set('cursor', params.cursor.trim());
  const qs = query.toString();
  const data = await fetchApiData(`${baseUrl}/api/metaid/list${qs ? `?${qs}` : ''}`, fetchFn, timeoutMs);
  return normalizePage(data);
}

/** GET /api/metaid/detail/:identity — full profile of one identity. */
export async function getMetaIdDetail(
  identity: string,
  options?: MetaIdSearchApiOptions,
): Promise<MetaIdDetail> {
  const { baseUrl, fetchFn, timeoutMs } = resolveOptions(options);
  const trimmed = identity.trim();
  if (!trimmed) throw new Error('identity is required to read a MetaID detail.');
  const data = await fetchApiData(`${baseUrl}/api/metaid/detail/${encodeURIComponent(trimmed)}`, fetchFn, timeoutMs);
  return normalizeDetail(data);
}

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

export function trimMetaIdSearchItems(
  items: MetaIdSearchItem[],
  ownGlobalMetaIds: ReadonlySet<string>,
): TrimmedMetaIdSearchItem[] {
  const ownIds = new Set(
    [...ownGlobalMetaIds].map((id) => id.trim().toLowerCase()).filter(Boolean),
  );
  return items.map((item) => {
    const globalMetaId = item.globalMetaId;
    return {
      globalMetaId,
      metaId: item.metaId,
      address: item.address,
      chainName: item.chainName,
      name: item.name,
      avatarId: item.avatarId,
      bio: item.bio,
      chatSkills: item.chatSkills,
      hasChatPubkey: item.hasChatPubkey,
      hasHomepage: item.hasHomepage,
      updatedAt: item.updatedAt,
      isOwn: Boolean(globalMetaId) && ownIds.has(globalMetaId.trim().toLowerCase()),
    };
  });
}
