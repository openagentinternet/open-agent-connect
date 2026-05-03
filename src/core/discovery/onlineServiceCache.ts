import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RatingDetailItem } from '../ratings/ratingDetailState';
import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';

export const ONLINE_SERVICE_CACHE_LIMIT = 1000;
export const DEFAULT_ONLINE_SERVICE_CACHE_SYNC_INTERVAL_MS = 10 * 60 * 1000;

export type OnlineServiceDiscoverySource = 'chain' | 'seeded' | 'cache';

export interface OnlineServiceCachePaths {
  servicesRoot: string;
  servicesPath: string;
}

export interface OnlineServiceCacheEntry {
  servicePinId: string;
  sourceServicePinId: string;
  chainPinIds: string[];
  providerGlobalMetaId: string;
  providerMetaId: string | null;
  providerAddress: string | null;
  providerName: string | null;
  providerSkill: string | null;
  providerDaemonBaseUrl: string | null;
  providerChatPublicKey: string | null;
  serviceName: string;
  displayName: string;
  description: string;
  price: string;
  currency: string;
  serviceIcon: string | null;
  skillDocument: string | null;
  inputType: string | null;
  outputType: string | null;
  endpoint: string | null;
  paymentAddress: string | null;
  available: boolean;
  online: boolean;
  lastSeenSec: number | null;
  lastSeenAt: number | null;
  lastSeenAgoSeconds: number | null;
  updatedAt: number;
  ratingAvg: number | null;
  ratingCount: number;
  cachedAt: number;
}

export interface OnlineServiceCacheState {
  version: 1;
  services: OnlineServiceCacheEntry[];
  totalServices: number;
  limit: number;
  discoverySource: OnlineServiceDiscoverySource;
  fallbackUsed: boolean;
  lastSyncedAt: number | null;
  lastError: string | null;
}

export interface BuildOnlineServiceCacheStateInput {
  services: Array<Record<string, unknown>>;
  ratingDetails?: RatingDetailItem[];
  discoverySource: OnlineServiceDiscoverySource;
  fallbackUsed: boolean;
  limit?: number;
  now?: () => number;
  lastError?: string | null;
}

export interface SearchOnlineServiceCacheOptions {
  query?: string | null;
  onlineOnly?: boolean;
  currency?: string | null;
  maxPrice?: string | number | null;
  minRating?: number | null;
  limit?: number | null;
}

export interface OnlineServiceCacheStore {
  paths: OnlineServiceCachePaths;
  ensureLayout(): Promise<OnlineServiceCachePaths>;
  read(): Promise<OnlineServiceCacheState>;
  write(nextState: OnlineServiceCacheState): Promise<OnlineServiceCacheState>;
  update(
    updater: (
      currentState: OnlineServiceCacheState
    ) => OnlineServiceCacheState | Promise<OnlineServiceCacheState>
  ): Promise<OnlineServiceCacheState>;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function normalizeComparable(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeInteger(value: unknown): number | null {
  const parsed = normalizeNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function normalizeLimit(value: unknown): number {
  const parsed = normalizeInteger(value);
  if (parsed === null) {
    return ONLINE_SERVICE_CACHE_LIMIT;
  }
  return Math.max(1, Math.min(ONLINE_SERVICE_CACHE_LIMIT, parsed));
}

function uniqueTexts(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeNullableText(value: unknown): string | null {
  return normalizeText(value) || null;
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return fallback;
}

function compareCacheEntries(left: OnlineServiceCacheEntry, right: OnlineServiceCacheEntry): number {
  if (left.online !== right.online) {
    return left.online ? -1 : 1;
  }
  if ((right.ratingAvg ?? -1) !== (left.ratingAvg ?? -1)) {
    return (right.ratingAvg ?? -1) - (left.ratingAvg ?? -1);
  }
  if (right.ratingCount !== left.ratingCount) {
    return right.ratingCount - left.ratingCount;
  }
  if (right.updatedAt !== left.updatedAt) {
    return right.updatedAt - left.updatedAt;
  }
  return left.servicePinId.localeCompare(right.servicePinId);
}

function buildRatingAggregate(
  service: Record<string, unknown>,
  ratingDetails: RatingDetailItem[] | undefined,
): { ratingAvg: number | null; ratingCount: number } {
  const serviceIds = new Set(
    uniqueTexts([
      service.servicePinId,
      service.pinId,
      service.sourceServicePinId,
      ...(Array.isArray(service.chainPinIds) ? service.chainPinIds : []),
    ]),
  );
  let sum = 0;
  let count = 0;
  for (const rating of ratingDetails ?? []) {
    if (!serviceIds.has(normalizeText(rating.serviceId))) {
      continue;
    }
    const rate = normalizeNumber(rating.rate);
    if (rate === null || rate < 1 || rate > 5) {
      continue;
    }
    sum += rate;
    count += 1;
  }

  if (count > 0) {
    return {
      ratingAvg: sum / count,
      ratingCount: count,
    };
  }

  const existingAvg = normalizeNumber(service.ratingAvg ?? service.rating_avg);
  const existingCount = normalizeInteger(service.ratingCount ?? service.rating_count) ?? 0;
  return {
    ratingAvg: existingCount > 0 && existingAvg !== null ? existingAvg : null,
    ratingCount: Math.max(0, existingCount),
  };
}

function normalizeCacheEntry(
  service: Record<string, unknown>,
  ratingDetails: RatingDetailItem[] | undefined,
  cachedAt: number,
): OnlineServiceCacheEntry | null {
  const servicePinId = normalizeText(service.servicePinId ?? service.pinId);
  const providerGlobalMetaId = normalizeText(service.providerGlobalMetaId ?? service.globalMetaId);
  const serviceName = normalizeText(service.serviceName) || servicePinId;
  if (!servicePinId || !providerGlobalMetaId || !serviceName) {
    return null;
  }

  const sourceServicePinId = normalizeText(service.sourceServicePinId) || servicePinId;
  const chainPinIds = uniqueTexts([
    ...(Array.isArray(service.chainPinIds) ? service.chainPinIds : []),
    sourceServicePinId,
    servicePinId,
  ]);
  const rating = buildRatingAggregate(service, ratingDetails);
  const updatedAt = normalizeInteger(service.updatedAt ?? service.updated_at) ?? cachedAt;

  return {
    servicePinId,
    sourceServicePinId,
    chainPinIds,
    providerGlobalMetaId,
    providerMetaId: normalizeNullableText(service.providerMetaId ?? service.metaid),
    providerAddress: normalizeNullableText(service.providerAddress ?? service.createAddress ?? service.address),
    providerName: normalizeNullableText(service.providerName ?? service.providerMetaBot),
    providerSkill: normalizeNullableText(service.providerSkill),
    providerDaemonBaseUrl: normalizeNullableText(service.providerDaemonBaseUrl),
    providerChatPublicKey: normalizeNullableText(service.providerChatPublicKey ?? service.chatPublicKey),
    serviceName,
    displayName: normalizeText(service.displayName) || serviceName,
    description: normalizeText(service.description),
    price: normalizeText(service.price),
    currency: normalizeText(service.currency),
    serviceIcon: normalizeNullableText(service.serviceIcon),
    skillDocument: normalizeNullableText(service.skillDocument),
    inputType: normalizeNullableText(service.inputType),
    outputType: normalizeNullableText(service.outputType),
    endpoint: normalizeNullableText(service.endpoint),
    paymentAddress: normalizeNullableText(service.paymentAddress),
    available: normalizeBoolean(service.available, true),
    online: normalizeBoolean(service.online, false),
    lastSeenSec: normalizeInteger(service.lastSeenSec),
    lastSeenAt: normalizeInteger(service.lastSeenAt),
    lastSeenAgoSeconds: normalizeInteger(service.lastSeenAgoSeconds),
    updatedAt,
    ratingAvg: rating.ratingAvg,
    ratingCount: rating.ratingCount,
    cachedAt,
  };
}

function createEmptyState(): OnlineServiceCacheState {
  return {
    version: 1,
    services: [],
    totalServices: 0,
    limit: ONLINE_SERVICE_CACHE_LIMIT,
    discoverySource: 'cache',
    fallbackUsed: false,
    lastSyncedAt: null,
    lastError: null,
  };
}

function normalizeCacheState(value: OnlineServiceCacheState | null | undefined): OnlineServiceCacheState {
  if (!value || typeof value !== 'object') {
    return createEmptyState();
  }

  const cachedAt = normalizeInteger(value.lastSyncedAt) ?? Date.now();
  const services = Array.isArray(value.services)
    ? value.services
        .map((service) => normalizeCacheEntry(service as unknown as Record<string, unknown>, undefined, cachedAt))
        .filter((service): service is OnlineServiceCacheEntry => service !== null)
        .sort(compareCacheEntries)
        .slice(0, normalizeLimit(value.limit))
    : [];

  const source = value.discoverySource === 'chain' || value.discoverySource === 'seeded' || value.discoverySource === 'cache'
    ? value.discoverySource
    : 'cache';

  return {
    version: 1,
    services,
    totalServices: services.length,
    limit: normalizeLimit(value.limit),
    discoverySource: source,
    fallbackUsed: normalizeBoolean(value.fallbackUsed, false),
    lastSyncedAt: normalizeInteger(value.lastSyncedAt),
    lastError: normalizeNullableText(value.lastError),
  };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function resolvePaths(homeDirOrPaths: string | MetabotPaths): OnlineServiceCachePaths {
  const metabotPaths = typeof homeDirOrPaths === 'string'
    ? resolveMetabotPaths(homeDirOrPaths)
    : homeDirOrPaths;
  const servicesRoot = path.join(metabotPaths.metabotRoot, 'services');
  return {
    servicesRoot,
    servicesPath: path.join(servicesRoot, 'services.json'),
  };
}

export function buildOnlineServiceCacheState(input: BuildOnlineServiceCacheStateInput): OnlineServiceCacheState {
  const cachedAt = Math.trunc((input.now ?? Date.now)());
  const limit = normalizeLimit(input.limit);
  const services = input.services
    .map((service) => normalizeCacheEntry(service, input.ratingDetails, cachedAt))
    .filter((service): service is OnlineServiceCacheEntry => service !== null)
    .sort(compareCacheEntries)
    .slice(0, limit);

  return {
    version: 1,
    services,
    totalServices: services.length,
    limit,
    discoverySource: input.discoverySource,
    fallbackUsed: input.fallbackUsed,
    lastSyncedAt: cachedAt,
    lastError: normalizeNullableText(input.lastError),
  };
}

export function createOnlineServiceCacheStore(homeDirOrPaths: string | MetabotPaths): OnlineServiceCacheStore {
  const paths = resolvePaths(homeDirOrPaths);

  return {
    paths,
    async ensureLayout() {
      await fs.mkdir(paths.servicesRoot, { recursive: true });
      return paths;
    },
    async read() {
      await this.ensureLayout();
      return normalizeCacheState(await readJsonFile<OnlineServiceCacheState>(paths.servicesPath));
    },
    async write(nextState) {
      await this.ensureLayout();
      const normalized = normalizeCacheState(nextState);
      await fs.writeFile(paths.servicesPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
      return normalized;
    },
    async update(updater) {
      const currentState = await this.read();
      const nextState = await updater(currentState);
      return this.write(nextState);
    },
  };
}

function tokenizeQuery(value: string): string[] {
  return uniqueTexts(
    value
      .toLowerCase()
      .split(/[\s,.;:!?()[\]{}"'`|/\\，。！？；：（）【】《》、]+/u)
      .filter((token) => token.length > 0),
  );
}

function scoreTextField(input: {
  query: string;
  tokens: string[];
  field: string | null;
  exactWeight: number;
  tokenWeight: number;
}): number {
  const field = normalizeComparable(input.field);
  if (!field) {
    return 0;
  }

  let score = 0;
  if (field === input.query) {
    score += input.exactWeight * 2;
  } else if (field.includes(input.query) || input.query.includes(field)) {
    score += input.exactWeight;
  }

  for (const token of input.tokens) {
    if (field.includes(token)) {
      score += input.tokenWeight;
    }
  }

  return score;
}

function parsePrice(value: unknown): number | null {
  const text = normalizeText(value);
  if (!text) {
    return 0;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreServiceForQuery(service: OnlineServiceCacheEntry, query: string): number {
  if (!query) {
    return 0;
  }
  const tokens = tokenizeQuery(query);
  let score = 0;
  score += scoreTextField({ query, tokens, field: service.displayName, exactWeight: 80, tokenWeight: 16 });
  score += scoreTextField({ query, tokens, field: service.serviceName, exactWeight: 50, tokenWeight: 10 });
  score += scoreTextField({ query, tokens, field: service.description, exactWeight: 40, tokenWeight: 8 });
  score += scoreTextField({ query, tokens, field: service.providerSkill, exactWeight: 30, tokenWeight: 6 });
  score += scoreTextField({ query, tokens, field: service.providerName, exactWeight: 20, tokenWeight: 4 });
  return score;
}

export function searchOnlineServiceCacheServices(
  services: OnlineServiceCacheEntry[],
  options: SearchOnlineServiceCacheOptions = {},
): OnlineServiceCacheEntry[] {
  const query = normalizeComparable(options.query);
  const limit = options.limit == null ? null : Math.max(1, Math.trunc(Number(options.limit)));
  const currency = normalizeComparable(options.currency);
  const maxPrice = options.maxPrice == null ? null : parsePrice(options.maxPrice);
  const minRating = options.minRating == null ? null : normalizeNumber(options.minRating);

  const ranked = services
    .filter((service) => {
      if (options.onlineOnly === true && !service.online) {
        return false;
      }
      if (!service.available) {
        return false;
      }
      if (currency && normalizeComparable(service.currency) !== currency) {
        return false;
      }
      if (maxPrice !== null) {
        const servicePrice = parsePrice(service.price);
        if (servicePrice === null || servicePrice > maxPrice) {
          return false;
        }
      }
      if (minRating !== null && (service.ratingAvg ?? 0) < minRating) {
        return false;
      }
      return true;
    })
    .map((service) => {
      const queryScore = scoreServiceForQuery(service, query);
      return {
        service,
        queryScore,
        score:
          queryScore
          + (service.online ? 20 : 0)
          + (service.ratingAvg ?? 0)
          + Math.log1p(service.ratingCount),
      };
    })
    .filter((entry) => !query || entry.queryScore > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return compareCacheEntries(left.service, right.service);
    })
    .map((entry) => entry.service);

  return limit === null ? ranked : ranked.slice(0, limit);
}
