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
  CHAIN_HEARTBEAT_PROTOCOL_PATH,
  filterOnlineChainServices,
  isChainHeartbeatSemanticMiss,
  parseHeartbeatTimestamp,
  type ChainHeartbeatEntry,
} from './chainHeartbeatDirectory';

const DEFAULT_CHAIN_API_BASE_URL = 'https://manapi.metaid.io';
const DEFAULT_HEARTBEAT_FETCH_CONCURRENCY = 6;

export interface ReadChainDirectoryResult {
  services: Array<Record<string, unknown>>;
  source: 'chain' | 'seeded';
  fallbackUsed: boolean;
}

export interface ReadChainDirectoryOptions {
  chainApiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onlineOnly?: boolean;
  servicePageSize?: number;
  serviceMaxPages?: number;
  heartbeatFetchConcurrency?: number;
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

async function fetchLatestHeartbeat(input: {
  fetchImpl: typeof fetch;
  chainApiBaseUrl: string;
  address: string;
}): Promise<ChainHeartbeatEntry> {
  const url = new URL(`${input.chainApiBaseUrl}/address/pin/list/${encodeURIComponent(input.address)}`);
  url.searchParams.set('cursor', '0');
  url.searchParams.set('size', '1');
  url.searchParams.set('path', CHAIN_HEARTBEAT_PROTOCOL_PATH);

  try {
    const response = await input.fetchImpl(url.toString());
    if (!response.ok) {
      return {
        address: input.address,
        timestamp: null,
        source: 'chain',
        error: `status_${response.status}`,
      };
    }
    const payload = await response.json() as unknown;
    if (isChainHeartbeatSemanticMiss(payload)) {
      return {
        address: input.address,
        timestamp: null,
        source: 'chain',
        error: 'semantic_miss',
      };
    }
    return {
      address: input.address,
      timestamp: parseHeartbeatTimestamp(payload),
      source: 'chain',
      error: null,
    };
  } catch (error) {
    return {
      address: input.address,
      timestamp: null,
      source: 'chain',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  const concurrency = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) {
          return;
        }
        results[index] = await worker(items[index]);
      }
    })
  );

  return results;
}

async function fetchHeartbeatsForServices(input: {
  services: ChainServiceDirectoryItem[];
  fetchImpl: typeof fetch;
  chainApiBaseUrl: string;
  heartbeatFetchConcurrency: number;
}): Promise<ChainHeartbeatEntry[]> {
  const addresses = [...new Set(
    input.services
      .map((service) => service.providerAddress?.trim())
      .filter((address): address is string => Boolean(address))
  )];

  return mapWithConcurrency(
    addresses,
    input.heartbeatFetchConcurrency,
    async (address) => fetchLatestHeartbeat({
      fetchImpl: input.fetchImpl,
      chainApiBaseUrl: input.chainApiBaseUrl,
      address,
    })
  );
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
  const heartbeatFetchConcurrency = Number.isFinite(options.heartbeatFetchConcurrency)
    ? Math.max(1, Math.floor(options.heartbeatFetchConcurrency as number))
    : DEFAULT_HEARTBEAT_FETCH_CONCURRENCY;

  try {
    const services = await fetchServicePages({
      fetchImpl,
      chainApiBaseUrl,
      servicePageSize,
      serviceMaxPages,
    });
    const heartbeats = await fetchHeartbeatsForServices({
      services,
      fetchImpl,
      chainApiBaseUrl,
      heartbeatFetchConcurrency,
    });
    const decoratedServices = options.onlineOnly === true
      ? filterOnlineChainServices(services, heartbeats, { now: options.now })
      : services.map((service) => ({
          ...service,
          ...filterOnlineChainServices([service], heartbeats, { now: options.now })[0],
        }));

    return {
      services: options.onlineOnly === true
        ? decoratedServices
        : services.map((service) => {
            const onlineService = decoratedServices.find((entry) => entry.servicePinId === service.servicePinId);
            return {
              ...service,
              online: Boolean(onlineService?.online),
              lastSeenSec: typeof onlineService?.lastSeenSec === 'number' ? onlineService.lastSeenSec : null,
            };
          }),
      source: 'chain',
      fallbackUsed: false,
    };
  } catch {
    return {
      services: await options.fetchSeededDirectoryServices(),
      source: 'seeded',
      fallbackUsed: true,
    };
  }
}
