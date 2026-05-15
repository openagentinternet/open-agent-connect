import {
  LOOM_PROTOCOL_NAMES,
  LOOM_PROTOCOLS,
  resolveLoomProtocol,
  type LoomProtocolName,
} from './protocols';
import type { LoomCachedRecord } from './rawCache';
import { validateLoomPayload, type LoomValidationError } from './validation';

const DEFAULT_CHAIN_API_BASE_URL = 'https://manapi.metaid.io';
const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_MAX_PAGES = 20;
const UNIX_SECONDS_MAX = 10_000_000_000;

export interface ReadLoomRawChainOptions {
  chainApiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  pageSize?: number;
  maxPages?: number;
}

export interface ReadLoomRawChainResult {
  records: LoomCachedRecord[];
  byProtocol: Record<LoomProtocolName, number>;
}

interface LoomRawListPage {
  list: Record<string, unknown>[];
  nextCursor: string | null;
}

function normalizeBaseUrl(value: string | undefined): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return (normalized || DEFAULT_CHAIN_API_BASE_URL).replace(/\/$/, '');
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) > 0
    ? Math.floor(value as number)
    : fallback;
}

function toString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value == null) return '';
  return String(value).trim();
}

function normalizeTimestampMs(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric < UNIX_SECONDS_MAX ? Math.trunc(numeric * 1000) : Math.trunc(numeric);
}

function getListPage(payload: unknown): LoomRawListPage {
  const data = payload && typeof payload === 'object'
    ? (payload as { data?: unknown }).data
    : null;
  const dataObject = data && typeof data === 'object' && !Array.isArray(data)
    ? data as { list?: unknown; nextCursor?: unknown; cursor?: unknown }
    : {};
  return {
    list: Array.isArray(dataObject.list)
      ? dataObject.list.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
      : [],
    nextCursor: typeof dataObject.nextCursor === 'string'
      ? dataObject.nextCursor
      : typeof dataObject.cursor === 'string'
        ? dataObject.cursor
        : null,
  };
}

function parsePayload(row: Record<string, unknown>): {
  payload: unknown;
  parseErrors: LoomValidationError[];
} {
  const rawPayload = row.contentSummary ?? row.content ?? row.payload;
  if (rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)) {
    return { payload: rawPayload, parseErrors: [] };
  }
  if (typeof rawPayload === 'string' && rawPayload.trim()) {
    try {
      const parsed = JSON.parse(rawPayload) as unknown;
      return { payload: parsed, parseErrors: [] };
    } catch (error) {
      return {
        payload: {},
        parseErrors: [
          {
            path: '',
            code: 'invalid_json',
            message: error instanceof Error ? error.message : 'payload must be valid JSON.',
          },
        ],
      };
    }
  }
  return {
    payload: {},
    parseErrors: [
      {
        path: '',
        code: 'missing_payload',
        message: 'Loom record payload was not present in the chain row.',
      },
    ],
  };
}

function normalizePath(row: Record<string, unknown>, protocol: LoomProtocolName): string {
  const path = toString(row.path);
  return path || LOOM_PROTOCOLS[protocol].path;
}

function normalizeOperation(row: Record<string, unknown>): string {
  const operation = toString(row.operation ?? row.Operation).toLowerCase();
  return operation || 'create';
}

function normalizePinId(row: Record<string, unknown>): string {
  return toString(row.id ?? row.pinId ?? row.pinID ?? row.txid ?? row.txId);
}

function normalizeRecord(row: Record<string, unknown>, protocol: LoomProtocolName): LoomCachedRecord | null {
  const pinId = normalizePinId(row);
  if (!pinId) return null;
  const path = normalizePath(row, protocol);
  const resolvedProtocol = resolveLoomProtocol(path).name;
  const parsed = parsePayload(row);
  const validation = parsed.parseErrors.length
    ? {
      valid: false,
      errors: parsed.parseErrors,
    }
    : validateLoomPayload(resolvedProtocol, parsed.payload);

  return {
    pinId,
    protocol: resolvedProtocol,
    path,
    operation: normalizeOperation(row),
    contentType: toString(row.contentType ?? row.content_type) || 'application/json',
    timestamp: normalizeTimestampMs(row.timestamp ?? row.updatedAt ?? row.createdAt),
    creatorAddress: toString(row.createAddress ?? row.create_address ?? row.address),
    creatorMetaId: toString(row.metaid ?? row.metaId ?? row.createMetaId),
    globalMetaId: toString(row.globalMetaId ?? row.global_meta_id),
    payload: parsed.payload,
    payloadValid: validation.valid,
    validationErrors: validation.errors,
    raw: row,
  };
}

async function fetchProtocolRecords(input: {
  fetchImpl: typeof fetch;
  chainApiBaseUrl: string;
  protocol: LoomProtocolName;
  pageSize: number;
  maxPages: number;
}): Promise<LoomCachedRecord[]> {
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  const records: LoomCachedRecord[] = [];

  for (let page = 0; page < input.maxPages; page += 1) {
    const url = new URL(`${input.chainApiBaseUrl}/pin/path/list`);
    url.searchParams.set('path', LOOM_PROTOCOLS[input.protocol].path);
    url.searchParams.set('size', String(input.pageSize));
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const response = await input.fetchImpl(url.toString());
    if (!response.ok) {
      throw new Error(`loom_chain_reader_http_${response.status}`);
    }
    const payload = await response.json() as unknown;
    const pageRows = getListPage(payload);
    for (const row of pageRows.list) {
      const record = normalizeRecord(row, input.protocol);
      if (record) {
        records.push(record);
      }
    }

    if (!pageRows.nextCursor || seenCursors.has(pageRows.nextCursor)) {
      break;
    }
    seenCursors.add(pageRows.nextCursor);
    cursor = pageRows.nextCursor;
  }

  return records;
}

export async function readLoomRawChainRecords(options: ReadLoomRawChainOptions = {}): Promise<ReadLoomRawChainResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const chainApiBaseUrl = normalizeBaseUrl(options.chainApiBaseUrl);
  const pageSize = normalizePositiveInteger(options.pageSize, DEFAULT_PAGE_SIZE);
  const maxPages = normalizePositiveInteger(options.maxPages, DEFAULT_MAX_PAGES);
  const byProtocol = {
    task: 0,
    claim: 0,
    status: 0,
    delivery: 0,
    acceptance: 0,
    'claim-reject': 0,
  };
  const records: LoomCachedRecord[] = [];

  for (const protocol of LOOM_PROTOCOL_NAMES) {
    const protocolRecords = await fetchProtocolRecords({
      fetchImpl,
      chainApiBaseUrl,
      protocol,
      pageSize,
      maxPages,
    });
    byProtocol[protocol] = protocolRecords.length;
    records.push(...protocolRecords);
  }

  return { records, byProtocol };
}
