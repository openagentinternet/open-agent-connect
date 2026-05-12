import { normalizeComparableGlobalMetaId } from './serviceDirectory';

const UNIX_SECONDS_MAX = 10_000_000_000;

export const CHAIN_SERVICE_PROTOCOL_PATH = '/protocols/skill-service';
export const DEFAULT_CHAIN_SERVICE_PAGE_SIZE = 200;
export const DEFAULT_CHAIN_SERVICE_MAX_PAGES = 20;

export interface ChainServiceDirectoryItem {
  servicePinId: string;
  sourceServicePinId: string;
  chainPinIds: string[];
  providerGlobalMetaId: string;
  providerMetaId: string;
  providerAddress: string;
  serviceName: string;
  displayName: string;
  description: string;
  price: string;
  currency: string;
  paymentChain: string | null;
  settlementKind: string | null;
  mrc20Ticker: string | null;
  mrc20Id: string | null;
  serviceIcon: string | null;
  providerSkill: string | null;
  skillDocument: string | null;
  inputType: string | null;
  outputType: string | null;
  endpoint: string | null;
  paymentAddress: string | null;
  available: boolean;
  updatedAt: number;
}

export interface ParsedChainServiceRow {
  pinId: string;
  providerMetaId: string;
  providerGlobalMetaId: string;
  providerAddress: string;
  serviceName: string;
  displayName: string;
  description: string;
  price: string;
  currency: string;
  paymentChain: string | null;
  settlementKind: string | null;
  mrc20Ticker: string | null;
  mrc20Id: string | null;
  serviceIcon: string | null;
  providerSkill: string | null;
  skillDocument: string | null;
  inputType: string | null;
  outputType: string | null;
  endpoint: string | null;
  paymentAddress: string | null;
  status: number;
  operation: string;
  path: string | null;
  originalId: string | null;
  sourceServicePinId: string;
  available: number;
  updatedAt: number;
}

export interface ChainServiceListPage {
  list: Record<string, unknown>[];
  nextCursor: string | null;
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

function extractSourceServicePinId(input: {
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

function normalizePinId(row: ParsedChainServiceRow): string {
  return row.pinId.trim();
}

function normalizeSourceServicePinId(row: ParsedChainServiceRow): string {
  return row.sourceServicePinId.trim() || normalizePinId(row);
}

function compareRowsDesc(left: ParsedChainServiceRow, right: ParsedChainServiceRow): number {
  const updatedSort = right.updatedAt - left.updatedAt;
  if (updatedSort !== 0) return updatedSort;
  return normalizePinId(right).localeCompare(normalizePinId(left));
}

function compareRowsAsc(left: ParsedChainServiceRow, right: ParsedChainServiceRow): number {
  return compareRowsDesc(right, left);
}

function isServiceRowVisible(row: ParsedChainServiceRow): boolean {
  if (row.operation === 'revoke') return false;
  if (row.available === 0) return false;
  const normalizedStatus = Math.trunc(row.status);
  return normalizedStatus === 0 || normalizedStatus === 1;
}

function resolveCanonicalSourcePinId(
  row: ParsedChainServiceRow,
  rowByPinId: Map<string, ParsedChainServiceRow>
): string {
  let currentPinId = normalizePinId(row);
  let nextPinId = normalizeSourceServicePinId(row);
  const visited = new Set<string>([currentPinId]);
  while (nextPinId && nextPinId !== currentPinId && !visited.has(nextPinId)) {
    const nextRow = rowByPinId.get(nextPinId);
    if (!nextRow) {
      return nextPinId;
    }
    visited.add(nextPinId);
    currentPinId = nextPinId;
    nextPinId = normalizeSourceServicePinId(nextRow);
  }
  return nextPinId || currentPinId;
}

export function getChainServiceListPage(payload: unknown): ChainServiceListPage {
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

export function isChainServiceListSemanticMiss(payload: unknown): boolean {
  const { list } = getChainServiceListPage(payload);
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

export function parseChainServiceItem(item: Record<string, unknown>): ParsedChainServiceRow | null {
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
  const sourceServicePinId = extractSourceServicePinId({
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
    if (operation !== 'revoke' || !sourceServicePinId) {
      return null;
    }
    return {
      pinId: pinId || sourceServicePinId,
      providerMetaId,
      providerGlobalMetaId,
      providerAddress,
      serviceName: sourceServicePinId,
      displayName: 'Revoked service',
      description: '',
      price: '0',
      currency: '',
      paymentChain: null,
      settlementKind: null,
      mrc20Ticker: null,
      mrc20Id: null,
      serviceIcon: null,
      providerSkill: null,
      skillDocument: null,
      inputType: null,
      outputType: null,
      endpoint: null,
      paymentAddress: providerAddress || null,
      status,
      operation,
      path,
      originalId,
      sourceServicePinId,
      available: 0,
      updatedAt,
    };
  }

  const serviceName = toSafeString(summary.serviceName);
  if (!serviceName || !providerMetaId || !providerAddress) {
    return null;
  }

  return {
    pinId: pinId || sourceServicePinId || serviceName,
    providerMetaId,
    providerGlobalMetaId,
    providerAddress,
    serviceName,
    displayName: toSafeString(summary.displayName) || serviceName || 'Service',
    description: toSafeString(summary.description),
    price: toSafeString(summary.price),
    currency: toSafeString(summary.currency ?? summary.priceUnit),
    paymentChain: toSafeString(summary.paymentChain) || null,
    settlementKind: toSafeString(summary.settlementKind) || null,
    mrc20Ticker: toSafeString(summary.mrc20Ticker) || null,
    mrc20Id: toSafeString(summary.mrc20Id) || null,
    serviceIcon: toSafeString(summary.serviceIcon) || null,
    providerSkill: toSafeString(summary.providerSkill) || null,
    skillDocument: toSafeString(summary.skillDocument) || null,
    inputType: toSafeString(summary.inputType) || null,
    outputType: toSafeString(summary.outputType) || null,
    endpoint: toSafeString(summary.endpoint) || null,
    paymentAddress: toSafeString(summary.paymentAddress) || providerAddress || null,
    status,
    operation,
    path,
    originalId,
    sourceServicePinId,
    available: operation === 'revoke' || status < 0 ? 0 : 1,
    updatedAt,
  };
}

export function resolveCurrentChainServices(
  rows: Array<ParsedChainServiceRow | null | undefined>
): ChainServiceDirectoryItem[] {
  const normalizedRows = rows
    .filter((row): row is ParsedChainServiceRow => Boolean(row && normalizePinId(row)))
    .map((row) => ({ ...row }));
  const rowByPinId = new Map<string, ParsedChainServiceRow>(
    normalizedRows.map((row) => [normalizePinId(row), row] as const)
  );
  const rowsBySourcePinId = new Map<string, ParsedChainServiceRow[]>();

  for (const row of normalizedRows) {
    const canonicalSourcePinId = resolveCanonicalSourcePinId(row, rowByPinId);
    const list = rowsBySourcePinId.get(canonicalSourcePinId) ?? [];
    list.push(row);
    rowsBySourcePinId.set(canonicalSourcePinId, list);
  }

  const currentServices = [...rowsBySourcePinId.entries()]
    .map(([sourceServicePinId, sourceRows]) => {
      const sortedRows = [...sourceRows].sort(compareRowsDesc);
      const latestRow = sortedRows[0];
      if (!latestRow || latestRow.operation === 'revoke') {
        return null;
      }
      const currentRow = sortedRows.find((row) => isServiceRowVisible(row));
      if (!currentRow) {
        return null;
      }
      const chainPinIds = [...new Set(
        [...sourceRows]
          .sort(compareRowsAsc)
          .filter((row) => row.operation !== 'revoke')
          .map((row) => normalizePinId(row))
          .filter(Boolean)
      )];
      return {
        servicePinId: normalizePinId(currentRow),
        sourceServicePinId,
        chainPinIds,
        providerGlobalMetaId: currentRow.providerGlobalMetaId,
        providerMetaId: currentRow.providerMetaId,
        providerAddress: currentRow.providerAddress,
        serviceName: currentRow.serviceName,
        displayName: currentRow.displayName,
        description: currentRow.description,
        price: currentRow.price,
        currency: currentRow.currency,
        paymentChain: currentRow.paymentChain,
        settlementKind: currentRow.settlementKind,
        mrc20Ticker: currentRow.mrc20Ticker,
        mrc20Id: currentRow.mrc20Id,
        serviceIcon: currentRow.serviceIcon,
        providerSkill: currentRow.providerSkill,
        skillDocument: currentRow.skillDocument,
        inputType: currentRow.inputType,
        outputType: currentRow.outputType,
        endpoint: currentRow.endpoint,
        paymentAddress: currentRow.paymentAddress,
        available: Boolean(currentRow.available),
        updatedAt: currentRow.updatedAt,
      } as ChainServiceDirectoryItem;
    })
    .filter((row): row is ChainServiceDirectoryItem => row !== null);

  return currentServices
    .sort((left, right) => right.updatedAt - left.updatedAt || right.servicePinId.localeCompare(left.servicePinId));
}
