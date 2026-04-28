import { applyHeartbeatOnlineState, filterOnlineChainServices, isChainHeartbeatSemanticMiss, parseHeartbeatTimestamp, type ChainHeartbeatEntry } from '../discovery/chainHeartbeatDirectory';
import { normalizeComparableGlobalMetaId } from '../discovery/serviceDirectory';
import type { PublishedMasterRecord, MasterDirectoryItem } from './masterTypes';
import { MASTER_SERVICE_PROTOCOL_PATH } from './masterTypes';

const DEFAULT_CHAIN_API_BASE_URL = 'https://manapi.metaid.io';
const DEFAULT_CHAIN_MASTER_PAGE_SIZE = 200;
const DEFAULT_CHAIN_MASTER_MAX_PAGES = 20;
const DEFAULT_HEARTBEAT_FETCH_CONCURRENCY = 6;
const UNIX_SECONDS_MAX = 10_000_000_000;

export interface ParsedChainMasterRow {
  pinId: string;
  providerMetaId: string;
  providerGlobalMetaId: string;
  providerAddress: string;
  serviceName: string;
  displayName: string;
  description: string;
  masterKind: string;
  specialties: string[];
  hostModes: string[];
  modelInfo: Record<string, unknown> | null;
  style: string | null;
  pricingMode: string | null;
  price: string;
  currency: string;
  responseMode: string | null;
  contextPolicy: string | null;
  official: boolean;
  trustedTier: string | null;
  status: number;
  operation: string;
  path: string | null;
  originalId: string | null;
  sourceMasterPinId: string;
  available: number;
  updatedAt: number;
}

export interface ReadChainMasterDirectoryResult {
  masters: MasterDirectoryItem[];
  source: 'chain' | 'seeded';
  fallbackUsed: boolean;
}

export interface ReadChainMasterDirectoryOptions {
  chainApiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onlineOnly?: boolean;
  fetchSeededDirectoryMasters: () => Promise<MasterDirectoryItem[]>;
}

function toSafeString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value == null) return '';
  return String(value).trim();
}

function toSafeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toSafeBoolean(value: unknown): boolean {
  if (value === true || value === false) return value;
  const normalized = toSafeString(value).toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const normalized = [];
  for (const entry of value) {
    const text = toSafeString(entry);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    normalized.push(text);
  }
  return normalized;
}

function normalizeTimestampMs(value: unknown): number {
  const parsed = toSafeNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed < UNIX_SECONDS_MAX ? Math.trunc(parsed * 1000) : Math.trunc(parsed);
}

function normalizeOperation(value: unknown): string {
  const normalized = toSafeString(value).toLowerCase();
  return normalized || 'create';
}

function normalizePath(value: unknown): string | null {
  const normalized = toSafeString(value);
  return normalized || null;
}

function hasValidOperation(value: unknown): boolean {
  const normalized = normalizeOperation(value);
  return normalized === 'create' || normalized === 'modify' || normalized === 'revoke';
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
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
    return readObject(JSON.parse(value));
  } catch {
    return null;
  }
}

function extractSourceMasterPinId(input: {
  pinId: string;
  operation: string;
  path: string | null;
  originalId: string | null;
}): string {
  if (input.operation === 'create') {
    return input.pinId;
  }
  const pathTarget = input.path?.startsWith('@') ? input.path.slice(1).trim() : '';
  if (pathTarget) {
    return pathTarget;
  }
  if (input.originalId && !input.originalId.startsWith('/')) {
    return input.originalId;
  }
  return input.pinId;
}

function normalizePinId(row: ParsedChainMasterRow): string {
  return row.pinId.trim();
}

function normalizeSourceMasterPinId(row: ParsedChainMasterRow): string {
  return row.sourceMasterPinId.trim() || normalizePinId(row);
}

function compareRowsDesc(left: ParsedChainMasterRow, right: ParsedChainMasterRow): number {
  const updatedSort = right.updatedAt - left.updatedAt;
  if (updatedSort !== 0) return updatedSort;
  return normalizePinId(right).localeCompare(normalizePinId(left));
}

function isMasterRowVisible(row: ParsedChainMasterRow): boolean {
  if (row.operation === 'revoke') return false;
  if (row.available === 0) return false;
  const normalizedStatus = Math.trunc(row.status);
  return normalizedStatus === 0 || normalizedStatus === 1;
}

function resolveCanonicalSourcePinId(
  row: ParsedChainMasterRow,
  rowByPinId: Map<string, ParsedChainMasterRow>
): string {
  let currentPinId = normalizePinId(row);
  let nextPinId = normalizeSourceMasterPinId(row);
  const visited = new Set<string>([currentPinId]);
  while (nextPinId && nextPinId !== currentPinId && !visited.has(nextPinId)) {
    const nextRow = rowByPinId.get(nextPinId);
    if (!nextRow) {
      return nextPinId;
    }
    visited.add(nextPinId);
    currentPinId = nextPinId;
    nextPinId = normalizeSourceMasterPinId(nextRow);
  }
  return nextPinId || currentPinId;
}

function getChainMasterListPage(payload: unknown): {
  list: Record<string, unknown>[];
  nextCursor: string | null;
} {
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

function isChainMasterListSemanticMiss(payload: unknown): boolean {
  const { list } = getChainMasterListPage(payload);
  if (list.length === 0) {
    return true;
  }
  const sample = list.slice(0, Math.min(list.length, 5));
  return !sample.some((item) => {
    const operation = item.operation ?? item.Operation;
    const status = item.status ?? item.Status;
    return hasValidOperation(operation) && Number.isFinite(Number(status));
  });
}

function parseModelInfo(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return readObject(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return readObject(value);
}

function normalizeCurrency(value: unknown): string {
  const normalized = toSafeString(value).toUpperCase();
  return normalized === 'MVC' ? 'SPACE' : normalized;
}

export function parseChainMasterItem(item: Record<string, unknown>): ParsedChainMasterRow | null {
  const pinId = toSafeString(item.id);
  const operation = normalizeOperation(item.operation ?? item.Operation);
  const status = Math.trunc(toSafeNumber(item.status ?? item.Status));
  const path = normalizePath(item.path);
  const originalId = normalizePath(
    item.originalId
    ?? item.originalID
    ?? item.originalPinId
    ?? item.original_pin_id
  );
  const providerMetaId = toSafeString(item.metaid ?? item.createMetaId);
  const providerAddress = toSafeString(item.createAddress ?? item.create_address ?? item.address);
  const updatedAt = normalizeTimestampMs(item.timestamp) || Date.now();
  const sourceMasterPinId = extractSourceMasterPinId({
    pinId,
    operation,
    path,
    originalId,
  });
  const summary = parseContentSummary(item.contentSummary);
  const providerGlobalMetaId = normalizeComparableGlobalMetaId(
    item.globalMetaId
    ?? summary?.providerMetaBot
  );

  if (!summary) {
    if (operation !== 'revoke' || !sourceMasterPinId) {
      return null;
    }
    return {
      pinId: pinId || sourceMasterPinId,
      providerMetaId,
      providerGlobalMetaId,
      providerAddress,
      serviceName: sourceMasterPinId,
      displayName: 'Revoked master',
      description: '',
      masterKind: '',
      specialties: [],
      hostModes: [],
      modelInfo: null,
      style: null,
      pricingMode: null,
      price: '0',
      currency: '',
      responseMode: null,
      contextPolicy: null,
      official: false,
      trustedTier: null,
      status,
      operation,
      path,
      originalId,
      sourceMasterPinId,
      available: 0,
      updatedAt,
    };
  }

  const serviceName = toSafeString(summary.serviceName);
  const masterKind = toSafeString(summary.masterKind);
  if (!serviceName || !masterKind || !providerMetaId || !providerAddress) {
    return null;
  }

  return {
    pinId: pinId || sourceMasterPinId || serviceName,
    providerMetaId,
    providerGlobalMetaId,
    providerAddress,
    serviceName,
    displayName: toSafeString(summary.displayName) || serviceName || 'Master',
    description: toSafeString(summary.description),
    masterKind,
    specialties: normalizeStringArray(summary.specialties),
    hostModes: normalizeStringArray(summary.hostModes),
    modelInfo: parseModelInfo(summary.modelInfo),
    style: toSafeString(summary.style) || null,
    pricingMode: toSafeString(summary.pricingMode) || null,
    price: toSafeString(summary.price) || '0',
    currency: normalizeCurrency(summary.currency ?? summary.priceUnit),
    responseMode: toSafeString(summary.responseMode) || null,
    contextPolicy: toSafeString(summary.contextPolicy) || null,
    official: toSafeBoolean(summary.official),
    trustedTier: toSafeString(summary.trustedTier) || null,
    status,
    operation,
    path,
    originalId,
    sourceMasterPinId,
    available: operation === 'revoke' || status < 0 ? 0 : 1,
    updatedAt,
  };
}

export function resolveCurrentChainMasters(
  rows: Array<ParsedChainMasterRow | null | undefined>
): MasterDirectoryItem[] {
  const normalizedRows = rows
    .filter((row): row is ParsedChainMasterRow => Boolean(row && normalizePinId(row)))
    .map((row) => ({ ...row }));
  const rowByPinId = new Map<string, ParsedChainMasterRow>(
    normalizedRows.map((row) => [normalizePinId(row), row] as const)
  );
  const rowsBySourcePinId = new Map<string, ParsedChainMasterRow[]>();

  for (const row of normalizedRows) {
    const canonicalSourcePinId = resolveCanonicalSourcePinId(row, rowByPinId);
    const list = rowsBySourcePinId.get(canonicalSourcePinId) ?? [];
    list.push(row);
    rowsBySourcePinId.set(canonicalSourcePinId, list);
  }

  const items: Array<MasterDirectoryItem | null> = [...rowsBySourcePinId.entries()]
    .map(([sourceMasterPinId, sourceRows]) => {
      const sortedRows = [...sourceRows].sort(compareRowsDesc);
      const latestRow = sortedRows[0];
      if (!latestRow || latestRow.operation === 'revoke') {
        return null;
      }
      const currentRow = sortedRows.find((row) => isMasterRowVisible(row));
      if (!currentRow) {
        return null;
      }

      const item: MasterDirectoryItem = {
        masterPinId: normalizePinId(currentRow),
        sourceMasterPinId,
        chainPinIds: [...new Set(sourceRows.map((row) => normalizePinId(row)).filter(Boolean))].sort(),
        providerGlobalMetaId: currentRow.providerGlobalMetaId,
        providerMetaId: currentRow.providerMetaId,
        providerAddress: currentRow.providerAddress,
        serviceName: currentRow.serviceName,
        displayName: currentRow.displayName,
        description: currentRow.description,
        masterKind: currentRow.masterKind,
        specialties: [...currentRow.specialties],
        hostModes: [...currentRow.hostModes],
        modelInfo: currentRow.modelInfo ? { ...currentRow.modelInfo } : null,
        style: currentRow.style,
        pricingMode: currentRow.pricingMode,
        price: currentRow.price,
        currency: currentRow.currency,
        responseMode: currentRow.responseMode,
        contextPolicy: currentRow.contextPolicy,
        official: currentRow.official,
        trustedTier: currentRow.trustedTier,
        available: currentRow.available === 1,
        online: false,
        updatedAt: currentRow.updatedAt,
      };
      return item;
    });

  return items
    .filter((entry): entry is MasterDirectoryItem => entry !== null)
    .sort((left, right) => right.updatedAt - left.updatedAt || right.masterPinId.localeCompare(left.masterPinId));
}

function parseModelInfoJson(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    return readObject(JSON.parse(value));
  } catch {
    return null;
  }
}

export function summarizePublishedMaster(record: PublishedMasterRecord): MasterDirectoryItem {
  const chainPinIds = [...new Set([
    record.sourceMasterPinId,
    record.currentPinId,
  ].filter(Boolean))];

  return {
    masterPinId: record.currentPinId,
    sourceMasterPinId: record.sourceMasterPinId,
    chainPinIds,
    providerGlobalMetaId: record.providerGlobalMetaId,
    providerMetaId: '',
    providerAddress: record.providerAddress,
    serviceName: record.serviceName,
    displayName: record.displayName,
    description: record.description,
    masterKind: record.masterKind,
    specialties: [...record.specialties],
    hostModes: [...record.hostModes],
    modelInfo: parseModelInfoJson(record.modelInfoJson),
    style: record.style,
    pricingMode: record.pricingMode,
    price: record.price,
    currency: record.currency,
    responseMode: record.responseMode,
    contextPolicy: record.contextPolicy,
    official: record.official === 1,
    trustedTier: record.trustedTier,
    available: record.available === 1,
    online: false,
    updatedAt: record.updatedAt,
  };
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

async function fetchLatestHeartbeat(input: {
  fetchImpl: typeof fetch;
  chainApiBaseUrl: string;
  address: string;
}): Promise<ChainHeartbeatEntry> {
  const url = new URL(`${input.chainApiBaseUrl}/address/pin/list/${encodeURIComponent(input.address)}`);
  url.searchParams.set('cursor', '0');
  url.searchParams.set('size', '1');
  url.searchParams.set('path', '/protocols/metabot-heartbeat');

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

async function fetchHeartbeatsForMasters(input: {
  masters: MasterDirectoryItem[];
  fetchImpl: typeof fetch;
  chainApiBaseUrl: string;
}): Promise<ChainHeartbeatEntry[]> {
  const addresses = [...new Set(
    input.masters
      .map((master) => master.providerAddress?.trim())
      .filter((address): address is string => Boolean(address))
  )];

  return mapWithConcurrency(
    addresses,
    DEFAULT_HEARTBEAT_FETCH_CONCURRENCY,
    async (address) => fetchLatestHeartbeat({
      fetchImpl: input.fetchImpl,
      chainApiBaseUrl: input.chainApiBaseUrl,
      address,
    })
  );
}

export function listMasters(input: {
  entries: Array<Record<string, unknown> | MasterDirectoryItem>;
  onlineOnly?: boolean;
  host?: string;
  masterKind?: string;
  official?: boolean;
}): MasterDirectoryItem[] {
  const host = toSafeString(input.host).toLowerCase();
  const masterKind = toSafeString(input.masterKind).toLowerCase();
  const deduped = new Map<string, MasterDirectoryItem>();

  for (const entry of input.entries) {
    const normalized = readObject(entry);
    const masterPinId = toSafeString(normalized?.masterPinId);
    const sourceMasterPinId = toSafeString(normalized?.sourceMasterPinId) || masterPinId;
    const providerGlobalMetaId = normalizeComparableGlobalMetaId(normalized?.providerGlobalMetaId);
    const entryMasterKind = toSafeString(normalized?.masterKind);
    if (!masterPinId || !sourceMasterPinId || !providerGlobalMetaId || !entryMasterKind) {
      continue;
    }

    const entryHostModes = normalizeStringArray(normalized?.hostModes);
    if (host && entryHostModes.length > 0 && !entryHostModes.some((value) => value.toLowerCase() === host)) {
      continue;
    }
    if (masterKind && entryMasterKind.toLowerCase() !== masterKind) {
      continue;
    }
    const official = toSafeBoolean(normalized?.official);
    if (input.official === true && !official) {
      continue;
    }
    if (input.onlineOnly === true && !toSafeBoolean(normalized?.online)) {
      continue;
    }

    const key = `${providerGlobalMetaId}::${sourceMasterPinId}`;
    const normalizedEntry: MasterDirectoryItem = {
      masterPinId,
      sourceMasterPinId,
      chainPinIds: normalizeStringArray(normalized?.chainPinIds).length > 0
        ? normalizeStringArray(normalized?.chainPinIds)
        : [sourceMasterPinId, masterPinId].filter(Boolean),
      providerGlobalMetaId,
      providerMetaId: toSafeString(normalized?.providerMetaId),
      providerAddress: toSafeString(normalized?.providerAddress),
      serviceName: toSafeString(normalized?.serviceName),
      displayName: toSafeString(normalized?.displayName) || masterPinId,
      description: toSafeString(normalized?.description),
      masterKind: entryMasterKind,
      specialties: normalizeStringArray(normalized?.specialties),
      hostModes: entryHostModes,
      modelInfo: parseModelInfo(normalized?.modelInfo),
      style: toSafeString(normalized?.style) || null,
      pricingMode: toSafeString(normalized?.pricingMode) || null,
      price: toSafeString(normalized?.price),
      currency: normalizeCurrency(normalized?.currency),
      responseMode: toSafeString(normalized?.responseMode) || null,
      contextPolicy: toSafeString(normalized?.contextPolicy) || null,
      official,
      trustedTier: toSafeString(normalized?.trustedTier) || null,
      available: normalized?.available !== false,
      online: toSafeBoolean(normalized?.online),
      updatedAt: normalizeTimestampMs(normalized?.updatedAt ?? 0),
      lastSeenSec: Number.isFinite(Number(normalized?.lastSeenSec)) ? Number(normalized?.lastSeenSec) : null,
      providerDaemonBaseUrl: toSafeString(normalized?.providerDaemonBaseUrl) || null,
      directorySeedLabel: toSafeString(normalized?.directorySeedLabel) || null,
    };

    const current = deduped.get(key);
    if (!current || normalizedEntry.updatedAt >= current.updatedAt) {
      deduped.set(key, normalizedEntry);
    }
  }

  return [...deduped.values()].sort(
    (left, right) => right.updatedAt - left.updatedAt || right.masterPinId.localeCompare(left.masterPinId)
  );
}

export async function readChainMasterDirectoryWithFallback(
  options: ReadChainMasterDirectoryOptions
): Promise<ReadChainMasterDirectoryResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const chainApiBaseUrlInput = typeof options.chainApiBaseUrl === 'string'
    ? options.chainApiBaseUrl.trim()
    : '';
  const chainApiBaseUrl = (chainApiBaseUrlInput || DEFAULT_CHAIN_API_BASE_URL).replace(/\/$/, '');

  try {
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    const rows: Array<ParsedChainMasterRow | null> = [];

    for (let page = 0; page < DEFAULT_CHAIN_MASTER_MAX_PAGES; page += 1) {
      const url = new URL(`${chainApiBaseUrl}/pin/path/list`);
      url.searchParams.set('path', MASTER_SERVICE_PROTOCOL_PATH);
      url.searchParams.set('size', String(DEFAULT_CHAIN_MASTER_PAGE_SIZE));
      if (cursor) {
        url.searchParams.set('cursor', cursor);
      }

      const response = await fetchImpl(url.toString());
      if (!response.ok) {
        throw new Error(`chain_directory_http_${response.status}`);
      }
      const payload = await response.json() as unknown;
      if (page === 0 && isChainMasterListSemanticMiss(payload)) {
        throw new Error('chain_directory_semantic_miss');
      }

      const pageData = getChainMasterListPage(payload);
      rows.push(...pageData.list.map((item) => parseChainMasterItem(item)));
      if (!pageData.nextCursor || seenCursors.has(pageData.nextCursor)) {
        break;
      }
      seenCursors.add(pageData.nextCursor);
      cursor = pageData.nextCursor;
    }

    const masters = resolveCurrentChainMasters(rows);
    const heartbeats = await fetchHeartbeatsForMasters({
      masters,
      fetchImpl,
      chainApiBaseUrl,
    });
    const decoratedMasters = options.onlineOnly === true
      ? filterOnlineChainServices(masters, heartbeats, { now: options.now })
      : applyHeartbeatOnlineState(masters, heartbeats, { now: options.now });

    return {
      masters: decoratedMasters,
      source: 'chain',
      fallbackUsed: false,
    };
  } catch {
    return {
      masters: await options.fetchSeededDirectoryMasters(),
      source: 'seeded',
      fallbackUsed: true,
    };
  }
}
