import {
  type RatingDetailItem,
  type RatingDetailState,
  type RatingDetailStateStore,
} from './ratingDetailState';

const DEFAULT_CHAIN_API_BASE_URL = 'https://manapi.metaid.io';
const UNIX_SECONDS_MAX = 10_000_000_000;

export const CHAIN_SERVICE_RATING_PROTOCOL_PATH = '/protocols/skill-service-rate';
export const DEFAULT_CHAIN_SERVICE_RATING_PAGE_SIZE = 200;
export const DEFAULT_CHAIN_SERVICE_RATING_MAX_PAGES = 20;

export interface RatingDetailListPage {
  list: Array<Record<string, unknown>>;
  nextCursor: string | null;
}

export interface RefreshRatingDetailCacheInput {
  store: RatingDetailStateStore;
  fetchPage: (cursor?: string) => Promise<RatingDetailListPage>;
  maxPages?: number;
  now?: () => number;
}

export interface RefreshRatingDetailCacheFromChainInput {
  store: RatingDetailStateStore;
  chainApiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  pageSize?: number;
  maxPages?: number;
  now?: () => number;
}

export interface RefreshRatingDetailCacheResult {
  state: RatingDetailState;
  insertedCount: number;
  newestPinId: string | null;
  hitLatestPinId: boolean;
}

function toSafeString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value == null) return '';
  return String(value).trim();
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTextList(value: unknown): string[] {
  const rawItems = Array.isArray(value)
    ? value
    : toSafeString(value)
      ? [value]
      : [];
  return [...new Set(rawItems.map((entry) => toSafeString(entry)).filter(Boolean))];
}

function normalizeTimestampMs(value: unknown, fallbackNow: () => number): number {
  const parsed = normalizeNumber(value);
  if (parsed === null || parsed <= 0) {
    return fallbackNow();
  }
  return parsed < UNIX_SECONDS_MAX ? Math.trunc(parsed * 1000) : Math.trunc(parsed);
}

function parseContentSummary(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeBaseUrl(value: string | undefined): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return (normalized || DEFAULT_CHAIN_API_BASE_URL).replace(/\/$/, '');
}

function getFetchImpl(fetchImpl: typeof fetch | undefined): typeof fetch {
  return fetchImpl ?? fetch;
}

function sortRatingItemsDesc(left: RatingDetailItem, right: RatingDetailItem): number {
  const leftCreatedAt = Number.isFinite(left.createdAt) ? Number(left.createdAt) : 0;
  const rightCreatedAt = Number.isFinite(right.createdAt) ? Number(right.createdAt) : 0;
  if (leftCreatedAt !== rightCreatedAt) {
    return rightCreatedAt - leftCreatedAt;
  }
  return right.pinId.localeCompare(left.pinId);
}

function normalizeMaxPages(value: number | undefined): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.floor(value as number))
    : DEFAULT_CHAIN_SERVICE_RATING_MAX_PAGES;
}

function normalizePageSize(value: number | undefined): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.floor(value as number))
    : DEFAULT_CHAIN_SERVICE_RATING_PAGE_SIZE;
}

export function getRatingDetailListPage(payload: unknown): RatingDetailListPage {
  const data = payload && typeof payload === 'object'
    ? ((payload as { data?: unknown }).data as { list?: unknown; nextCursor?: unknown } | undefined)
    : undefined;

  return {
    list: Array.isArray(data?.list)
      ? data.list.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
      : [],
    nextCursor: typeof data?.nextCursor === 'string' ? data.nextCursor : null,
  };
}

export function parseRatingDetailItem(
  item: Record<string, unknown>,
  options: { now?: () => number } = {}
): RatingDetailItem | null {
  const pinId = toSafeString(item.id);
  if (!pinId) {
    return null;
  }

  const summary = parseContentSummary(item.contentSummary);
  if (!summary) {
    return null;
  }

  const serviceId = toSafeString(summary.serviceID);
  const rateValue = summary.rate;
  const rate = typeof rateValue === 'number'
    ? rateValue
    : typeof rateValue === 'string'
      ? Number.parseFloat(rateValue)
      : Number.NaN;

  if (!serviceId || !Number.isFinite(rate) || rate < 1 || rate > 5) {
    return null;
  }

  const now = options.now ?? Date.now;
  const comment = toSafeString(summary.comment) || null;

  return {
    pinId,
    serviceId,
    serviceOrderPinId: toSafeString(summary.serviceOrderPinId) || null,
    servicePaidTx: toSafeString(summary.servicePaidTx) || null,
    serviceSkills: normalizeTextList(summary.serviceSkills).length > 0
      ? normalizeTextList(summary.serviceSkills)
      : normalizeTextList(summary.serviceSkill),
    rate,
    comment,
    raterGlobalMetaId: toSafeString(item.globalMetaId) || null,
    raterMetaId: toSafeString(item.metaid) || toSafeString(item.createMetaId) || null,
    createdAt: normalizeTimestampMs(item.timestamp, now),
  };
}

export async function fetchRatingDetailPageFromChain(
  input: {
    chainApiBaseUrl?: string;
    fetchImpl?: typeof fetch;
    pageSize?: number;
  },
  cursor?: string
): Promise<RatingDetailListPage> {
  const url = new URL(`${normalizeBaseUrl(input.chainApiBaseUrl)}/pin/path/list`);
  url.searchParams.set('path', CHAIN_SERVICE_RATING_PROTOCOL_PATH);
  url.searchParams.set('size', String(normalizePageSize(input.pageSize)));
  if (typeof cursor === 'string' && cursor.trim()) {
    url.searchParams.set('cursor', cursor.trim());
  }

  const response = await getFetchImpl(input.fetchImpl)(url.toString());
  if (!response.ok) {
    throw new Error(`rating_detail_http_${response.status}`);
  }

  return getRatingDetailListPage(await response.json() as unknown);
}

export function findRatingDetailByServicePayment(
  source: RatingDetailState | RatingDetailItem[],
  lookup: {
    serviceId: string;
    serviceOrderPinId?: string | null;
    servicePaidTx?: string | null;
  }
): RatingDetailItem | null {
  const serviceId = toSafeString(lookup.serviceId);
  const serviceOrderPinId = toSafeString(lookup.serviceOrderPinId);
  const servicePaidTx = toSafeString(lookup.servicePaidTx);
  if (!serviceId || (!serviceOrderPinId && !servicePaidTx)) {
    return null;
  }

  const items = Array.isArray(source) ? source : source.items;
  const matchingServiceItems = items.filter((item) => (
    toSafeString(item.serviceId) === serviceId
  ));
  if (serviceOrderPinId) {
    const orderMatch = matchingServiceItems.find((item) => (
      toSafeString(item.serviceOrderPinId) === serviceOrderPinId
    ));
    if (orderMatch) return orderMatch;
  }
  if (!servicePaidTx) {
    return null;
  }
  return matchingServiceItems.find((item) => (
    !toSafeString(item.serviceOrderPinId)
    && toSafeString(item.servicePaidTx) === servicePaidTx
  )) ?? null;
}

export async function refreshRatingDetailCache(
  input: RefreshRatingDetailCacheInput
): Promise<RefreshRatingDetailCacheResult> {
  const now = input.now ?? Date.now;
  const maxPages = normalizeMaxPages(input.maxPages);
  const currentState = await input.store.read();
  const items = [...currentState.items];
  const seenPinIds = new Set(items.map((item) => item.pinId));
  const currentLatestPinId = toSafeString(currentState.latestPinId) || null;

  let insertedCount = 0;
  let newestPinId: string | null = null;
  let hitLatestPinId = currentLatestPinId === null;
  let headNextCursor: string | null = null;
  let pagesRemaining = maxPages;
  let cursor: string | undefined;

  while (pagesRemaining > 0) {
    const page = await input.fetchPage(cursor);
    pagesRemaining -= 1;
    headNextCursor = page.nextCursor ?? null;

    let stopAtLatest = false;
    for (const rawItem of page.list) {
      const rawPinId = toSafeString(rawItem.id);
      if (currentLatestPinId && rawPinId === currentLatestPinId) {
        hitLatestPinId = true;
        stopAtLatest = true;
        break;
      }

      const parsed = parseRatingDetailItem(rawItem, { now });
      if (!parsed) {
        continue;
      }
      if (!newestPinId) {
        newestPinId = parsed.pinId;
      }
      if (seenPinIds.has(parsed.pinId)) {
        continue;
      }

      seenPinIds.add(parsed.pinId);
      items.push(parsed);
      insertedCount += 1;
    }

    if (stopAtLatest || !page.nextCursor || currentLatestPinId === null && pagesRemaining <= 0) {
      break;
    }

    cursor = page.nextCursor ?? undefined;
  }

  let backfillCursor = currentState.backfillCursor;
  if (currentLatestPinId === null) {
    backfillCursor = headNextCursor;
  } else if (hitLatestPinId) {
    let nextBackfillCursor = currentState.backfillCursor;
    while (pagesRemaining > 0 && nextBackfillCursor) {
      const page = await input.fetchPage(nextBackfillCursor);
      pagesRemaining -= 1;
      nextBackfillCursor = page.nextCursor ?? null;

      for (const rawItem of page.list) {
        const parsed = parseRatingDetailItem(rawItem, { now });
        if (!parsed || seenPinIds.has(parsed.pinId)) {
          continue;
        }
        seenPinIds.add(parsed.pinId);
        items.push(parsed);
        insertedCount += 1;
      }
    }
    backfillCursor = nextBackfillCursor;
  }

  const nextState: RatingDetailState = {
    items: items.sort(sortRatingItemsDesc),
    latestPinId: hitLatestPinId && newestPinId
      ? newestPinId
      : currentLatestPinId,
    backfillCursor: backfillCursor ? toSafeString(backfillCursor) || null : null,
    lastSyncedAt: now(),
  };
  const persistedState = await input.store.write(nextState);

  return {
    state: persistedState,
    insertedCount,
    newestPinId,
    hitLatestPinId,
  };
}

export async function refreshRatingDetailCacheFromChain(
  input: RefreshRatingDetailCacheFromChainInput
): Promise<RefreshRatingDetailCacheResult> {
  return refreshRatingDetailCache({
    store: input.store,
    maxPages: input.maxPages,
    now: input.now,
    fetchPage: (cursor) => fetchRatingDetailPageFromChain({
      chainApiBaseUrl: input.chainApiBaseUrl,
      fetchImpl: input.fetchImpl,
      pageSize: input.pageSize,
    }, cursor),
  });
}
