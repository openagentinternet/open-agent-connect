import {
  CHAIN_SERVICE_PROTOCOL_PATH,
  DEFAULT_CHAIN_SERVICE_MAX_PAGES,
  DEFAULT_CHAIN_SERVICE_PAGE_SIZE,
  getChainServiceListPage,
  isChainServiceListSemanticMiss,
  parseChainServiceItem,
  resolveCurrentChainServices,
  type ChainServiceDirectoryItem,
} from './chainServiceDirectory';
import {
  readOnlineMetaBotsFromSocketPresence,
  type OnlineMetaBotDirectoryItem,
} from './socketPresenceDirectory';
import { normalizeComparableGlobalMetaId } from './serviceDirectory';

const DEFAULT_CHAIN_API_BASE_URL = 'https://manapi.metaid.io';
const DEFAULT_SOCKET_PRESENCE_LIMIT = 100;
export type SocketPresenceFailureMode = 'throw' | 'assume_service_providers_online';

export interface ReadChainDirectoryResult {
  services: Array<Record<string, unknown>>;
  source: 'chain' | 'seeded';
  fallbackUsed: boolean;
}

export interface ReadChainDirectoryOptions {
  chainApiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  onlineOnly?: boolean;
  servicePageSize?: number;
  serviceMaxPages?: number;
  socketPresenceApiBaseUrl?: string;
  socketPresenceLimit?: number;
  socketPresenceFailureMode?: SocketPresenceFailureMode;
  fetchSeededDirectoryServices: () => Promise<Array<Record<string, unknown>>>;
}

function normalizeBaseUrl(value: string | undefined): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return (normalized || DEFAULT_CHAIN_API_BASE_URL).replace(/\/$/, '');
}

function getFetchImpl(fetchImpl: typeof fetch | undefined): typeof fetch {
  return fetchImpl ?? fetch;
}

async function fetchServicePages(input: {
  fetchImpl: typeof fetch;
  chainApiBaseUrl: string;
  servicePageSize: number;
  serviceMaxPages: number;
}): Promise<ChainServiceDirectoryItem[]> {
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  const rows = [];

  for (let page = 0; page < input.serviceMaxPages; page += 1) {
    const url = new URL(`${input.chainApiBaseUrl}/pin/path/list`);
    url.searchParams.set('path', CHAIN_SERVICE_PROTOCOL_PATH);
    url.searchParams.set('size', String(input.servicePageSize));
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const response = await input.fetchImpl(url.toString());
    if (!response.ok) {
      throw new Error(`chain_directory_http_${response.status}`);
    }
    const payload = await response.json() as unknown;
    if (page === 0 && isChainServiceListSemanticMiss(payload)) {
      throw new Error('chain_directory_semantic_miss');
    }

    const servicePage = getChainServiceListPage(payload);
    rows.push(...servicePage.list.map((item) => parseChainServiceItem(item)));

    if (!servicePage.nextCursor || seenCursors.has(servicePage.nextCursor)) {
      break;
    }
    seenCursors.add(servicePage.nextCursor);
    cursor = servicePage.nextCursor;
  }

  return resolveCurrentChainServices(rows);
}

function normalizeSocketPresenceLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SOCKET_PRESENCE_LIMIT;
  }
  return Math.min(DEFAULT_SOCKET_PRESENCE_LIMIT, Math.max(1, Math.floor(value as number)));
}

function normalizeLastSeenSec(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (value > 1e12) {
    return Math.floor(value / 1000);
  }
  return Math.floor(value);
}

function buildOnlineMetaBotIndex(
  bots: OnlineMetaBotDirectoryItem[],
): Map<string, OnlineMetaBotDirectoryItem> {
  const index = new Map<string, OnlineMetaBotDirectoryItem>();
  for (const bot of bots) {
    const globalMetaId = normalizeComparableGlobalMetaId(bot.globalMetaId);
    if (!globalMetaId || index.has(globalMetaId)) {
      continue;
    }
    index.set(globalMetaId, bot);
  }
  return index;
}

function buildSyntheticOnlineBotsFromServices(
  services: Array<Record<string, unknown>>,
): OnlineMetaBotDirectoryItem[] {
  const nowMs = Date.now();
  const seen = new Set<string>();
  const bots: OnlineMetaBotDirectoryItem[] = [];
  for (const service of services) {
    const globalMetaId = normalizeComparableGlobalMetaId(
      service.providerGlobalMetaId ?? service.globalMetaId,
    );
    if (!globalMetaId || seen.has(globalMetaId)) {
      continue;
    }
    seen.add(globalMetaId);
    bots.push({
      globalMetaId,
      lastSeenAt: nowMs,
      lastSeenAgoSeconds: 0,
      deviceCount: 1,
      online: true,
      name: '',
      goal: '',
    });
  }
  return bots;
}

function decorateServicesWithSocketPresence<T extends object>(input: {
  services: T[];
  onlineBots: OnlineMetaBotDirectoryItem[];
  onlineOnly: boolean;
}): Array<T & { online: boolean; lastSeenSec: number | null; lastSeenAt: number | null }> {
  const onlineIndex = buildOnlineMetaBotIndex(input.onlineBots);
  const decorated = input.services.map((service) => {
    const serviceRecord = service as Record<string, unknown>;
    const globalMetaId = normalizeComparableGlobalMetaId(
      serviceRecord.providerGlobalMetaId ?? serviceRecord.globalMetaId,
    );
    const onlineBot = globalMetaId ? onlineIndex.get(globalMetaId) : undefined;
    const lastSeenAt = typeof onlineBot?.lastSeenAt === 'number' && Number.isFinite(onlineBot.lastSeenAt)
      ? Math.max(0, Math.floor(onlineBot.lastSeenAt))
      : null;
    return {
      ...service,
      online: Boolean(onlineBot),
      lastSeenSec: normalizeLastSeenSec(lastSeenAt),
      lastSeenAt,
    };
  });

  if (input.onlineOnly) {
    return decorated.filter((service) => service.online);
  }
  return decorated;
}

async function applySocketPresenceToServices<T extends object>(input: {
  services: T[];
  fetchImpl: typeof fetch;
  socketPresenceApiBaseUrl?: string;
  socketPresenceLimit: number;
  socketPresenceFailureMode?: SocketPresenceFailureMode;
  onlineOnly: boolean;
}): Promise<Array<T & { online: boolean; lastSeenSec: number | null; lastSeenAt: number | null }>> {
  let onlineBots: OnlineMetaBotDirectoryItem[] = [];
  try {
    const onlineDirectory = await readOnlineMetaBotsFromSocketPresence({
      fetchImpl: input.fetchImpl,
      apiBaseUrl: input.socketPresenceApiBaseUrl,
      limit: input.socketPresenceLimit,
    });
    onlineBots = onlineDirectory.bots;
  } catch (error) {
    if (input.socketPresenceFailureMode === 'assume_service_providers_online') {
      onlineBots = buildSyntheticOnlineBotsFromServices(
        input.services.map((service) => ({ ...(service as Record<string, unknown>) })),
      );
    } else if (input.onlineOnly) {
      throw error;
    }
  }

  return decorateServicesWithSocketPresence({
    services: input.services,
    onlineBots,
    onlineOnly: input.onlineOnly,
  });
}

export async function readChainDirectoryWithFallback(
  options: ReadChainDirectoryOptions
): Promise<ReadChainDirectoryResult> {
  const fetchImpl = getFetchImpl(options.fetchImpl);
  const chainApiBaseUrl = normalizeBaseUrl(options.chainApiBaseUrl);
  const servicePageSize = Number.isFinite(options.servicePageSize)
    ? Math.max(1, Math.floor(options.servicePageSize as number))
    : DEFAULT_CHAIN_SERVICE_PAGE_SIZE;
  const serviceMaxPages = Number.isFinite(options.serviceMaxPages)
    ? Math.max(1, Math.floor(options.serviceMaxPages as number))
    : DEFAULT_CHAIN_SERVICE_MAX_PAGES;
  const socketPresenceLimit = normalizeSocketPresenceLimit(options.socketPresenceLimit);

  let source: 'chain' | 'seeded' = 'chain';
  let fallbackUsed = false;
  let services: Array<ChainServiceDirectoryItem | Record<string, unknown>>;
  try {
    services = await fetchServicePages({
      fetchImpl,
      chainApiBaseUrl,
      servicePageSize,
      serviceMaxPages,
    });
  } catch {
    source = 'seeded';
    fallbackUsed = true;
    services = await options.fetchSeededDirectoryServices();
  }

  const decoratedServices = await applySocketPresenceToServices({
    services: services.map((service) => ({ ...(service as Record<string, unknown>) })),
    fetchImpl,
    socketPresenceApiBaseUrl: options.socketPresenceApiBaseUrl,
    socketPresenceLimit,
    socketPresenceFailureMode: options.socketPresenceFailureMode,
    onlineOnly: options.onlineOnly === true,
  });

  return {
    services: decoratedServices,
    source,
    fallbackUsed,
  };
}
