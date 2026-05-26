import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';
import type { MetaAppCacheState, MetaAppGalleryRecord, MetaAppOperation } from './types';

export interface MetaAppLocalCacheStore {
  localCachePath: string;
  indexerCachePath: string;
  readLocal(): Promise<MetaAppCacheState>;
  writeLocal(state: MetaAppCacheState): Promise<MetaAppCacheState>;
  upsertLocal(record: MetaAppGalleryRecord): Promise<MetaAppCacheState>;
  readIndexer(): Promise<MetaAppCacheState>;
  writeIndexer(state: MetaAppCacheState): Promise<MetaAppCacheState>;
  listMerged(): Promise<MetaAppGalleryRecord[]>;
}

function resolvePaths(pathsOrHomeDir: string | MetabotPaths): MetabotPaths {
  return typeof pathsOrHomeDir === 'string' ? resolveMetabotPaths(pathsOrHomeDir) : pathsOrHomeDir;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeOperation(value: unknown): MetaAppOperation | null {
  return value === 'create' || value === 'modify' ? value : null;
}

function normalizeSource(value: unknown): 'local' | 'indexer' | null {
  return value === 'local' || value === 'indexer' ? value : null;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const normalized = normalizeText(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeRaw(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  return undefined;
}

function normalizeStatus(value: unknown): string | number | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function normalizeRecord(value: unknown): MetaAppGalleryRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const pinId = normalizeText(record.pinId);
  const firstPinId = normalizeText(record.firstPinId);
  const operation = normalizeOperation(record.operation);
  const source = normalizeSource(record.source);
  const updatedAt = normalizeNumber(record.updatedAt);
  const title = normalizeText(record.title);
  const appName = normalizeText(record.appName);
  const version = normalizeText(record.version);
  const runtime = normalizeText(record.runtime);
  const indexFile = normalizeText(record.indexFile);
  const contentType = normalizeText(record.contentType);
  const codeType = normalizeText(record.codeType);
  const ownerGlobalMetaId = normalizeText(record.ownerGlobalMetaId);
  const ownerAddress = normalizeText(record.ownerAddress);
  const network = normalizeText(record.network);
  const metawebUrl = normalizeText(record.metawebUrl);

  if (
    !pinId
    || !firstPinId
    || operation === null
    || !title
    || !appName
    || !version
    || !runtime
    || !indexFile
    || !contentType
    || !codeType
    || !ownerGlobalMetaId
    || !ownerAddress
    || !network
    || !metawebUrl
    || updatedAt === null
    || source === null
  ) {
    return null;
  }

  const normalized: MetaAppGalleryRecord = {
    pinId,
    firstPinId,
    operation,
    title,
    appName,
    version,
    runtime,
    indexFile,
    code: normalizeText(record.code),
    content: normalizeText(record.content),
    contentType,
    codeType,
    tags: normalizeTags(record.tags),
    ownerGlobalMetaId,
    ownerAddress,
    network,
    metawebUrl,
    updatedAt,
    source,
  };

  const localUiUrl = normalizeText(record.localUiUrl);
  if (localUiUrl) normalized.localUiUrl = localUiUrl;
  const disabled = normalizeBoolean(record.disabled);
  if (disabled !== undefined) normalized.disabled = disabled;
  const status = normalizeStatus(record.status);
  if (status !== undefined) normalized.status = status;
  const runUrl = normalizeText(record.runUrl);
  if (runUrl) normalized.runUrl = runUrl;
  const downloadUrl = normalizeText(record.downloadUrl);
  if (downloadUrl) normalized.downloadUrl = downloadUrl;
  const raw = normalizeRaw(record.raw);
  if (raw) normalized.raw = raw;

  return normalized;
}

function createEmptyState(): MetaAppCacheState {
  return {
    version: 1,
    records: [],
    updatedAt: null,
  };
}

function normalizeState(value: unknown): MetaAppCacheState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createEmptyState();
  }

  const state = value as Record<string, unknown>;
  return {
    version: 1,
    records: Array.isArray(state.records)
      ? state.records
          .map((record) => normalizeRecord(record))
          .filter((record): record is MetaAppGalleryRecord => record !== null)
      : [],
    updatedAt: normalizeNumber(state.updatedAt),
  };
}

async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
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

async function writeState(filePath: string, state: MetaAppCacheState): Promise<MetaAppCacheState> {
  const normalized = normalizeState(state);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

export function createMetaAppLocalCacheStore(pathsOrHomeDir: string | MetabotPaths): MetaAppLocalCacheStore {
  const paths = resolvePaths(pathsOrHomeDir);
  const metaappsRoot = path.join(paths.stateRoot, 'metaapps');
  const localCachePath = path.join(metaappsRoot, 'local-cache.json');
  const indexerCachePath = path.join(metaappsRoot, 'indexer-cache.json');

  return {
    localCachePath,
    indexerCachePath,
    async readLocal() {
      await fs.mkdir(metaappsRoot, { recursive: true });
      return normalizeState(await readJsonFile(localCachePath));
    },
    async writeLocal(state) {
      return writeState(localCachePath, state);
    },
    async upsertLocal(record) {
      const normalizedRecord = normalizeRecord({ ...record, source: 'local' });
      if (!normalizedRecord) {
        return this.readLocal();
      }
      const current = await this.readLocal();
      const existingIndex = current.records.findIndex((item) => item.pinId === normalizedRecord.pinId);
      const records = [...current.records];
      if (existingIndex >= 0) {
        records[existingIndex] = normalizedRecord;
      } else {
        records.push(normalizedRecord);
      }
      return this.writeLocal({
        version: 1,
        records,
        updatedAt: normalizedRecord.updatedAt,
      });
    },
    async readIndexer() {
      await fs.mkdir(metaappsRoot, { recursive: true });
      return normalizeState(await readJsonFile(indexerCachePath));
    },
    async writeIndexer(state) {
      return writeState(indexerCachePath, state);
    },
    async listMerged() {
      const [indexerState, localState] = await Promise.all([
        this.readIndexer(),
        this.readLocal(),
      ]);
      const seenPinIds = new Set<string>();
      const merged: MetaAppGalleryRecord[] = [];

      for (const item of indexerState.records) {
        seenPinIds.add(item.pinId);
        merged.push(item);
      }
      for (const item of localState.records) {
        if (seenPinIds.has(item.pinId)) {
          continue;
        }
        seenPinIds.add(item.pinId);
        merged.push(item);
      }

      return merged;
    },
  };
}
