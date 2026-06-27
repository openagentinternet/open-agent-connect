import { buildMetaAppCanonicalUrl } from './share';
import { normalizeMetaAppPinId } from './pinId';

const DEFAULT_MAN_METAAPP_BASE_URL = 'https://manapi.metaid.io';
const MAN_METAAPP_BASE_URL_ENV = 'METABOT_METAAPP_MAN_BASE_URL';
const METAAPP_PATH = '/protocols/metaapp';

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

type FetchFn = (url: string) => Promise<FetchResponse>;

type MetaAppOwnerListCandidate = {
  raw: Record<string, unknown>;
  latest: Record<string, unknown>;
  groupKey: string;
  listIndex: number;
  historyIndex: number;
  timestamp: number | null;
  pinId: string;
  operation: string;
  content: Record<string, unknown>;
};

export interface MetaAppOwnerListRecord {
  pinId: string;
  firstPinId: string;
  operation: string;
  title: string;
  appName: string;
  prompt?: string;
  icon?: string;
  coverImg?: string;
  introImgs: string[];
  intro?: string;
  runtime: string;
  version: string;
  contentType: string;
  content?: string;
  indexFile?: string;
  code?: string;
  contentHash?: string;
  metadata?: Record<string, unknown>;
  tags: string[];
  disabled: boolean;
  codeType?: string;
  ownerAddress: string;
  timestamp: number | null;
  summary?: string;
  txid?: string;
  txids: string[];
  metaappUri: string;
  metawebUrl: string;
  runUrl: string;
  raw: Record<string, unknown>;
}

export interface MetaAppOwnerListResult {
  records: MetaAppOwnerListRecord[];
  nextCursor: string;
  total: number;
}

export interface MetaAppManOwnerClient {
  baseUrl: string;
  listByAddress(input: { address: string; cursor?: string; size?: number }): Promise<MetaAppOwnerListResult>;
}

function normalizeBaseUrl(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || DEFAULT_MAN_METAAPP_BASE_URL).replace(/\/+$/u, '') || DEFAULT_MAN_METAAPP_BASE_URL;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function normalizeOptionalText(value: unknown): string | undefined {
  const text = normalizeText(value);
  return text || undefined;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseObject(value: unknown): Record<string, unknown> {
  const object = readObject(value);
  if (object) {
    return object;
  }
  if (typeof value !== 'string') {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return readObject(parsed) ?? {};
  } catch {
    return {};
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }
  const text = normalizeText(value);
  return text ? [text] : [];
}

function normalizeTxids(raw: Record<string, unknown>, latest: Record<string, unknown>): string[] {
  const direct = normalizeStringArray(latest.txids ?? latest.txIds ?? raw.txids ?? raw.txIds);
  const txid = normalizeText(latest.txid ?? latest.txId ?? raw.txid ?? raw.txId);
  if (!txid) {
    return direct;
  }
  return direct.includes(txid) ? direct : [txid, ...direct];
}

function normalizeTags(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : normalizeText(value).split(',');
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of source) {
    const normalized = normalizeText(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeBoolean(value: unknown): boolean {
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
  return false;
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return Math.trunc(numeric);
    }
  }
  return null;
}

function pickFirstPinId(raw: Record<string, unknown>, pinId: string): string {
  return normalizeMetaAppPinId(normalizeText(
    raw.firstPinId
      ?? raw.first_pin_id
      ?? raw.originPinId
      ?? raw.origin_pin_id
      ?? raw.rootPinId
      ?? raw.root_pin_id
      ?? raw.originalId
      ?? raw.original_id,
  )) ?? pinId;
}

function pickExplicitRootPinId(raw: Record<string, unknown>, latest: Record<string, unknown>): string {
  return normalizeMetaAppPinId(normalizeText(
    latest.firstPinId
      ?? latest.first_pin_id
      ?? latest.originPinId
      ?? latest.origin_pin_id
      ?? latest.rootPinId
      ?? latest.root_pin_id
      ?? latest.originalId
      ?? latest.original_id
      ?? raw.firstPinId
      ?? raw.first_pin_id
      ?? raw.originPinId
      ?? raw.origin_pin_id
      ?? raw.rootPinId
      ?? raw.root_pin_id
      ?? raw.originalId
      ?? raw.original_id,
  )) ?? '';
}

function parseTargetPathPinId(raw: Record<string, unknown>, latest: Record<string, unknown>): string {
  const path = normalizeText(latest.path ?? raw.path);
  if (!path.startsWith('@')) {
    return '';
  }
  return normalizeMetaAppPinId(path.slice(1)) ?? '';
}

function pickEffectiveFirstPinId(
  raw: Record<string, unknown>,
  latest: Record<string, unknown>,
  pinId: string,
): string {
  const operation = normalizeOperation(latest.operation ?? raw.operation);
  const targetPinId = parseTargetPathPinId(raw, latest);
  if (isMutationOperation(operation) && targetPinId) {
    return targetPinId;
  }
  return pickExplicitRootPinId(raw, latest)
    || targetPinId
    || pickFirstPinId(raw, pinId);
}

function pickPinId(raw: Record<string, unknown>, latest: Record<string, unknown>): string {
  return normalizeMetaAppPinId(normalizeText(latest.id ?? latest.pinId ?? latest.pin_id ?? raw.id ?? raw.pinId ?? raw.pin_id)) ?? '';
}

function pickOwnerAddress(raw: Record<string, unknown>, latest: Record<string, unknown>, fallback: string): string {
  return normalizeText(
    latest.ownerAddress
      ?? latest.owner_address
      ?? latest.creatorAddress
      ?? latest.creator_address
      ?? raw.ownerAddress
      ?? raw.owner_address
      ?? raw.creatorAddress
      ?? raw.creator_address
      ?? latest.address
      ?? raw.address,
  ) || fallback;
}

function readHistory(raw: Record<string, unknown>): Record<string, unknown>[] {
  const history = raw.modify_history ?? raw.modifyHistory ?? raw.history;
  if (!Array.isArray(history)) {
    return [];
  }
  return history.map((item) => readObject(item)).filter((item): item is Record<string, unknown> => item !== null);
}

function normalizeMetadata(value: unknown): Record<string, unknown> | undefined {
  const object = parseObject(value);
  return Object.keys(object).length > 0 ? object : undefined;
}

function parseContent(raw: Record<string, unknown>, latest: Record<string, unknown>): Record<string, unknown> {
  return parseObject(
    latest.contentSummary
      ?? latest.content
      ?? raw.contentSummary
      ?? raw.content,
  );
}

function normalizeTotal(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return Math.trunc(numeric);
    }
  }
  return fallback;
}

function normalizeOperation(value: unknown): string {
  return normalizeText(value) || 'create';
}

function isHiddenOperation(value: string): boolean {
  return value === 'revoke' || value === 'delete' || value === 'deleted';
}

function isMutationOperation(value: string): boolean {
  return value === 'modify' || isHiddenOperation(value);
}

function shouldReplaceCandidate(
  current: MetaAppOwnerListCandidate,
  next: MetaAppOwnerListCandidate,
): boolean {
  if (current.timestamp !== null || next.timestamp !== null) {
    const currentTimestamp = current.timestamp ?? Number.NEGATIVE_INFINITY;
    const nextTimestamp = next.timestamp ?? Number.NEGATIVE_INFINITY;
    if (nextTimestamp !== currentTimestamp) {
      return nextTimestamp > currentTimestamp;
    }
  }
  if (next.listIndex !== current.listIndex) {
    return next.listIndex > current.listIndex;
  }
  return next.historyIndex > current.historyIndex;
}

function compareCandidates(a: MetaAppOwnerListCandidate, b: MetaAppOwnerListCandidate): number {
  const aTimestamp = a.timestamp ?? Number.NEGATIVE_INFINITY;
  const bTimestamp = b.timestamp ?? Number.NEGATIVE_INFINITY;
  if (aTimestamp !== bTimestamp) {
    return aTimestamp - bTimestamp;
  }
  if (a.listIndex !== b.listIndex) {
    return a.listIndex - b.listIndex;
  }
  return a.historyIndex - b.historyIndex;
}

function mergeContent(candidates: MetaAppOwnerListCandidate[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const candidate of [...candidates].sort(compareCandidates)) {
    Object.assign(merged, candidate.content);
  }
  return merged;
}

export function parseManMetaAppListResponse(
  response: unknown,
  input: { ownerAddress?: string } = {},
): MetaAppOwnerListResult {
  const root = parseObject(response);
  if (root.code !== 1) {
    throw new Error(`MAN MetaAPP list failed: ${normalizeText(root.message) || 'unknown error'}`);
  }

  const data = parseObject(root.data);
  const list = Array.isArray(data.list) ? data.list : [];
  const queryOwnerAddress = normalizeText(input.ownerAddress ?? data.address ?? data.ownerAddress ?? data.owner_address ?? root.address);
  const latestByGroup = new Map<string, MetaAppOwnerListCandidate>();
  const grouped = new Map<string, MetaAppOwnerListCandidate[]>();
  const records: MetaAppOwnerListRecord[] = [];

  for (const [listIndex, item] of list.entries()) {
    const raw = readObject(item);
    if (!raw) {
      continue;
    }

    const events = [raw, ...readHistory(raw)];
    for (const [historyIndex, latest] of events.entries()) {
      const pinId = pickPinId(raw, latest);
      if (!pinId) {
        continue;
      }

      const operation = normalizeOperation(latest.operation ?? raw.operation);
      const groupKey = pickEffectiveFirstPinId(raw, latest, pinId);
      const candidate: MetaAppOwnerListCandidate = {
        raw,
        latest,
        groupKey,
        listIndex,
        historyIndex,
        timestamp: normalizeTimestamp(latest.timestamp ?? raw.timestamp),
        pinId,
        operation,
        content: parseContent(raw, latest),
      };
      const group = grouped.get(groupKey) ?? [];
      group.push(candidate);
      grouped.set(groupKey, group);
      const current = latestByGroup.get(groupKey);
      if (!current || shouldReplaceCandidate(current, candidate)) {
        latestByGroup.set(groupKey, candidate);
      }
    }
  }

  for (const candidate of latestByGroup.values()) {
    const { raw, latest } = candidate;
    const operation = candidate.operation;
    if (isHiddenOperation(operation)) {
      continue;
    }

    const pinId = candidate.pinId;
    const content = mergeContent(grouped.get(candidate.groupKey) ?? [candidate]);
    const title = normalizeText(content.title ?? content.appName) || 'MetaAPP';
    const appName = normalizeText(content.appName ?? content.title) || 'MetaAPP';
    const txids = normalizeTxids(raw, latest);

    records.push({
      pinId,
      firstPinId: pickEffectiveFirstPinId(raw, latest, pinId),
      operation,
      title,
      appName,
      prompt: normalizeOptionalText(content.prompt),
      icon: normalizeOptionalText(content.icon),
      coverImg: normalizeOptionalText(content.coverImg),
      introImgs: normalizeStringArray(content.introImgs),
      intro: normalizeOptionalText(content.intro),
      runtime: normalizeText(content.runtime),
      version: normalizeText(content.version),
      contentType: normalizeText(content.contentType ?? content.content_type),
      content: normalizeOptionalText(content.content),
      indexFile: normalizeOptionalText(content.indexFile ?? content.index_file),
      code: normalizeOptionalText(content.code),
      contentHash: normalizeOptionalText(content.contentHash ?? content.content_hash),
      metadata: normalizeMetadata(content.metadata),
      tags: normalizeTags(content.tags),
      disabled: normalizeBoolean(content.disabled),
      codeType: normalizeOptionalText(content.codeType ?? content.code_type),
      ownerAddress: pickOwnerAddress(raw, latest, queryOwnerAddress),
      timestamp: normalizeTimestamp(latest.timestamp ?? raw.timestamp),
      summary: normalizeOptionalText(latest.summary ?? latest.contentSummaryText ?? raw.summary ?? raw.contentSummaryText ?? content.summary ?? content.intro),
      txid: normalizeOptionalText(latest.txid ?? latest.txId ?? raw.txid ?? raw.txId),
      txids,
      metaappUri: `metaapp://${pinId}`,
      metawebUrl: buildMetaAppCanonicalUrl(pinId),
      runUrl: `/browser/metaapp/${pinId}`,
      raw,
    });
  }

  return {
    records,
    nextCursor: normalizeText(data.nextCursor ?? data.next_cursor),
    total: normalizeTotal(data.total, records.length),
  };
}

export function createMetaAppManOwnerClient(input: {
  baseUrl?: string;
  fetchFn?: FetchFn;
} = {}): MetaAppManOwnerClient {
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? process.env[MAN_METAAPP_BASE_URL_ENV]);
  const fetchFn = input.fetchFn ?? fetch;

  return {
    baseUrl,
    async listByAddress(listInput) {
      const size = Number.isFinite(listInput.size) && Number(listInput.size) > 0
        ? Math.trunc(Number(listInput.size))
        : 12;
      const cursor = normalizeText(listInput.cursor);
      const url = new URL(`${baseUrl}/address/pin/list/${encodeURIComponent(listInput.address)}`);
      url.searchParams.set('cursor', cursor);
      url.searchParams.set('size', String(size));
      url.searchParams.set('path', METAAPP_PATH);

      const response = await fetchFn(url.toString());
      if (!response.ok) {
        throw new Error(`MAN MetaAPP list HTTP ${response.status}`);
      }

      return parseManMetaAppListResponse(await response.json(), { ownerAddress: listInput.address });
    },
  };
}
