import {
  SERVICE_REFUND_FINALIZE_PATH,
  SERVICE_REFUND_REQUEST_PATH,
  parseServiceRefundFinalizePin,
  parseServiceRefundRequestPin,
  type ParsedServiceRefundFinalize,
  type ParsedServiceRefundRequest,
} from './serviceRefundProtocol';

const DEFAULT_CHAIN_API_BASE_URL = 'https://manapi.metaid.io';
const DEFAULT_REFUND_CHAIN_PAGE_SIZE = 100;
const DEFAULT_REFUND_CHAIN_MAX_PAGES = 10;
const UNIX_SECONDS_MAX = 10_000_000_000;

export interface RefundChainListOptions {
  pageSize?: number;
  maxPages?: number;
  buyerGlobalMetaId?: string;
  sellerGlobalMetaId?: string;
  sinceMs?: number;
}

export interface ServiceRefundChainReaderDeps {
  chainApiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  pageSize?: number;
  maxPages?: number;
}

export interface ServiceRefundChainReader {
  listRefundRequests(options: RefundChainListOptions): Promise<ParsedServiceRefundRequest[]>;
  listRefundFinalizations(options: RefundChainListOptions): Promise<ParsedServiceRefundFinalize[]>;
}

interface RefundChainListPage {
  list: Record<string, unknown>[];
  nextCursor: string | null;
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function normalizeBaseUrl(value: string | undefined): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return (normalized || DEFAULT_CHAIN_API_BASE_URL).replace(/\/$/, '');
}

function getFetchImpl(fetchImpl: typeof fetch | undefined): typeof fetch {
  return fetchImpl ?? fetch;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.floor(value as number))
    : fallback;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readRecordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)))
    : [];
}

function readNextCursor(value: Record<string, unknown> | null): string | null {
  const nextCursor = normalizeText(value?.nextCursor);
  if (nextCursor) {
    return nextCursor;
  }
  const cursor = normalizeText(value?.cursor);
  return cursor || null;
}

function getRefundChainListPage(payload: unknown): RefundChainListPage {
  const root = readObject(payload);
  const data = readObject(root?.data);
  const source = data ?? root;
  return {
    list: readRecordList(source?.list)
      .concat(readRecordList(source?.rows))
      .concat(readRecordList(source?.items)),
    nextCursor: readNextCursor(source),
  };
}

function normalizeTimestampMs(value: unknown): number | null {
  const parsed = Number(normalizeText(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed < UNIX_SECONDS_MAX ? Math.trunc(parsed * 1000) : Math.trunc(parsed);
}

function readRowTimestampMs(row: Record<string, unknown>): number | null {
  return normalizeTimestampMs(
    row.timestamp
    ?? row.timestampMs
    ?? row.createdAt
    ?? row.createTime
    ?? row.created_at
    ?? row.createdTime
  );
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    return readObject(JSON.parse(value));
  } catch {
    return null;
  }
}

function readProtocolContentObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    return parseJsonObject(value);
  }
  const object = readObject(value);
  if (!object) {
    return null;
  }
  const data = readObject(object.data);
  const summary = object.contentSummary ?? data?.contentSummary ?? object.content;
  if (typeof summary === 'string') {
    return parseJsonObject(summary);
  }
  const summaryObject = readObject(summary);
  return summaryObject ?? object;
}

function writeProtocolContentObject(original: unknown, content: Record<string, unknown>): unknown {
  if (typeof original === 'string') {
    return JSON.stringify(content);
  }
  const object = readObject(original);
  if (!object) {
    return content;
  }
  const data = readObject(object.data);
  if (typeof object.contentSummary === 'string' || readObject(object.contentSummary)) {
    return {
      ...object,
      contentSummary: typeof object.contentSummary === 'string'
        ? JSON.stringify(content)
        : content,
    };
  }
  if (data && (typeof data.contentSummary === 'string' || readObject(data.contentSummary))) {
    return {
      ...object,
      data: {
        ...data,
        contentSummary: typeof data.contentSummary === 'string'
          ? JSON.stringify(content)
          : content,
      },
    };
  }
  return {
    ...object,
    ...content,
  };
}

function normalizePinRecord(row: Record<string, unknown>, path: string): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    ...row,
    pinId: normalizeText(row.pinId)
      || normalizeText(row.id)
      || normalizeText(row.pinid)
      || normalizeText(row.PINID),
    path: normalizeText(row.path) || path,
  };

  const timestampMs = readRowTimestampMs(row);
  if (!timestampMs || path !== SERVICE_REFUND_REQUEST_PATH) {
    return normalized;
  }

  const contentSource = row.content ?? row.payload ?? row.data ?? row;
  const content = readProtocolContentObject(contentSource);
  if (!content) {
    return normalized;
  }
  if (
    normalizeText(content.requestedAt)
    || normalizeText(content.createdAt)
    || normalizeText(content.failureDetectedAt)
  ) {
    return normalized;
  }

  const contentWithTimestamp = {
    ...content,
    requestedAt: new Date(timestampMs).toISOString(),
  };
  if (row.content !== undefined) {
    normalized.content = writeProtocolContentObject(row.content, contentWithTimestamp);
  } else if (row.payload !== undefined) {
    normalized.payload = writeProtocolContentObject(row.payload, contentWithTimestamp);
  } else if (row.data !== undefined) {
    normalized.data = writeProtocolContentObject(row.data, contentWithTimestamp);
  } else {
    normalized.content = contentWithTimestamp;
  }
  return normalized;
}

function requestedAtMs(entry: ParsedServiceRefundRequest): number | null {
  const parsed = Date.parse(entry.payload.requestedAt);
  return Number.isNaN(parsed) ? null : parsed;
}

function isParsedRefundRequest(
  entry: ParsedServiceRefundRequest | ParsedServiceRefundFinalize
): entry is ParsedServiceRefundRequest {
  return 'serviceOrderPinId' in entry.payload;
}

function shouldKeepByFilters(
  entry: ParsedServiceRefundRequest | ParsedServiceRefundFinalize,
  options: RefundChainListOptions
): boolean {
  const buyerGlobalMetaId = normalizeText(options.buyerGlobalMetaId);
  if (buyerGlobalMetaId && normalizeText(entry.payload.buyerGlobalMetaId) !== buyerGlobalMetaId) {
    return false;
  }

  const sellerGlobalMetaId = normalizeText(options.sellerGlobalMetaId);
  if (sellerGlobalMetaId && normalizeText(entry.payload.sellerGlobalMetaId) !== sellerGlobalMetaId) {
    return false;
  }

  if (isParsedRefundRequest(entry) && Number.isFinite(options.sinceMs)) {
    const timestamp = requestedAtMs(entry);
    if (timestamp !== null && timestamp < (options.sinceMs as number)) {
      return false;
    }
  }

  return true;
}

async function listProtocolPins<T extends ParsedServiceRefundRequest | ParsedServiceRefundFinalize>(
  deps: ServiceRefundChainReaderDeps,
  options: RefundChainListOptions,
  path: string,
  parsePin: (pin: unknown) => T | null
): Promise<T[]> {
  const fetchImpl = getFetchImpl(deps.fetchImpl);
  const chainApiBaseUrl = normalizeBaseUrl(deps.chainApiBaseUrl);
  const pageSize = normalizePositiveInteger(options.pageSize ?? deps.pageSize, DEFAULT_REFUND_CHAIN_PAGE_SIZE);
  const maxPages = normalizePositiveInteger(options.maxPages ?? deps.maxPages, DEFAULT_REFUND_CHAIN_MAX_PAGES);
  const seenCursors = new Set<string>();
  const rows: T[] = [];
  let cursor: string | null = null;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const url = new URL(`${chainApiBaseUrl}/pin/path/list`);
    url.searchParams.set('path', path);
    url.searchParams.set('size', String(pageSize));
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const response = await fetchImpl(url.toString());
    if (!response.ok) {
      throw new Error(`service_refund_chain_http_${response.status}`);
    }

    const page = getRefundChainListPage(await response.json() as unknown);
    for (const row of page.list) {
      const parsed = parsePin(normalizePinRecord(row, path));
      if (parsed && normalizeText(parsed.pinId) && shouldKeepByFilters(parsed, options)) {
        rows.push(parsed);
      }
    }

    if (page.list.length === 0 || !page.nextCursor) {
      break;
    }
    if (seenCursors.has(page.nextCursor)) {
      break;
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  return rows;
}

export function createServiceRefundChainReader(
  deps: ServiceRefundChainReaderDeps
): ServiceRefundChainReader {
  return {
    async listRefundRequests(options: RefundChainListOptions = {}) {
      return listProtocolPins(
        deps,
        options,
        SERVICE_REFUND_REQUEST_PATH,
        parseServiceRefundRequestPin
      );
    },
    async listRefundFinalizations(options: RefundChainListOptions = {}) {
      return listProtocolPins(
        deps,
        options,
        SERVICE_REFUND_FINALIZE_PATH,
        parseServiceRefundFinalizePin
      );
    },
  };
}
