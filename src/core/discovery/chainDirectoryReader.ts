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
  decorateRecordsWithSocketPresence,
  type SocketPresenceFailureMode,
} from './socketPresenceProjection';

const DEFAULT_CHAIN_API_BASE_URL = 'https://manapi.metaid.io';
export type { SocketPresenceFailureMode } from './socketPresenceProjection';

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

  const decoratedServices = await decorateRecordsWithSocketPresence(
    services.map((service) => ({ ...(service as Record<string, unknown>) })),
    {
      fetchImpl,
      socketPresenceApiBaseUrl: options.socketPresenceApiBaseUrl,
      socketPresenceLimit: options.socketPresenceLimit,
      socketPresenceFailureMode: options.socketPresenceFailureMode,
      onlineOnly: options.onlineOnly === true,
    });

  return {
    services: decoratedServices,
    source,
    fallbackUsed,
  };
}
