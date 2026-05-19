import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';
import { LOOM_PROTOCOL_NAMES, type LoomProtocolName } from './protocols';
import type { LoomValidationError } from './validation';

export interface LoomCachedRecord {
  pinId: string;
  protocol: LoomProtocolName;
  path: string;
  operation: string;
  contentType: string;
  timestamp: number;
  creatorAddress: string;
  creatorMetaId: string;
  globalMetaId: string;
  payload: unknown;
  payloadValid: boolean;
  validationErrors: LoomValidationError[];
  raw: Record<string, unknown>;
}

export type LoomRawRecordBuckets = Record<LoomProtocolName, LoomCachedRecord[]>;

export interface LoomRawCacheState {
  version: 1;
  updatedAt: number;
  records: LoomRawRecordBuckets;
}

export interface LoomRawCacheStore {
  cachePath: string;
  read(): Promise<LoomRawCacheState>;
  write(state: LoomRawCacheState): Promise<LoomRawCacheState>;
  update(records: LoomCachedRecord[]): Promise<LoomRawCacheState>;
}

function emptyBuckets(): LoomRawRecordBuckets {
  return {
    task: [],
    claim: [],
    status: [],
    delivery: [],
    acceptance: [],
    'claim-reject': [],
  };
}

export function createEmptyLoomRawCacheState(): LoomRawCacheState {
  return {
    version: 1,
    updatedAt: 0,
    records: emptyBuckets(),
  };
}

function isMetabotPaths(value: unknown): value is MetabotPaths {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as { metabotRoot?: unknown }).metabotRoot === 'string',
  );
}

function resolveCachePath(homeDirOrPaths: string | MetabotPaths): string {
  const paths = isMetabotPaths(homeDirOrPaths)
    ? homeDirOrPaths
    : resolveMetabotPaths(homeDirOrPaths);
  return path.join(paths.metabotRoot, 'loom', 'records.json');
}

function normalizeRecord(value: unknown): LoomCachedRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as LoomCachedRecord;
  if (
    typeof record.pinId !== 'string'
    || !LOOM_PROTOCOL_NAMES.includes(record.protocol)
  ) {
    return null;
  }
  return {
    ...record,
    path: typeof record.path === 'string' ? record.path : '',
    operation: typeof record.operation === 'string' ? record.operation : 'create',
    contentType: typeof record.contentType === 'string' ? record.contentType : 'application/json',
    timestamp: Number.isFinite(record.timestamp) ? Math.trunc(record.timestamp) : 0,
    creatorAddress: typeof record.creatorAddress === 'string' ? record.creatorAddress : '',
    creatorMetaId: typeof record.creatorMetaId === 'string' ? record.creatorMetaId : '',
    globalMetaId: typeof record.globalMetaId === 'string' ? record.globalMetaId : '',
    payloadValid: record.payloadValid === true,
    validationErrors: Array.isArray(record.validationErrors) ? record.validationErrors : [],
    raw: record.raw && typeof record.raw === 'object' && !Array.isArray(record.raw)
      ? record.raw
      : {},
  };
}

function chooseLatest(left: LoomCachedRecord, right: LoomCachedRecord): LoomCachedRecord {
  if (right.timestamp !== left.timestamp) {
    return right.timestamp > left.timestamp ? right : left;
  }
  return right.pinId.localeCompare(left.pinId) >= 0 ? right : left;
}

function normalizeState(value: unknown): LoomRawCacheState {
  const empty = createEmptyLoomRawCacheState();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return empty;
  }
  const input = value as Partial<LoomRawCacheState>;
  const output: LoomRawCacheState = {
    version: 1,
    updatedAt: Number.isFinite(input.updatedAt) ? Math.trunc(input.updatedAt as number) : 0,
    records: emptyBuckets(),
  };

  const seen = new Map<string, LoomCachedRecord>();
  const inputRecords = input.records && typeof input.records === 'object'
    ? input.records as Partial<LoomRawRecordBuckets>
    : {};
  for (const protocol of LOOM_PROTOCOL_NAMES) {
    const records = Array.isArray(inputRecords[protocol]) ? inputRecords[protocol] : [];
    for (const value of records) {
      const record = normalizeRecord({ ...(value as object), protocol });
      if (!record) continue;
      const existing = seen.get(record.pinId);
      seen.set(record.pinId, existing ? chooseLatest(existing, record) : record);
    }
  }

  for (const record of seen.values()) {
    output.records[record.protocol].push(record);
  }
  for (const protocol of LOOM_PROTOCOL_NAMES) {
    output.records[protocol].sort((left, right) => right.timestamp - left.timestamp || right.pinId.localeCompare(left.pinId));
  }
  return output;
}

export function createLoomRawCacheStore(homeDirOrPaths: string | MetabotPaths): LoomRawCacheStore {
  const cachePath = resolveCachePath(homeDirOrPaths);
  return {
    cachePath,
    async read() {
      try {
        const raw = await fs.readFile(cachePath, 'utf8');
        return normalizeState(JSON.parse(raw) as unknown);
      } catch {
        return createEmptyLoomRawCacheState();
      }
    },
    async write(state) {
      const normalized = normalizeState({
        ...state,
        updatedAt: Number.isFinite(state.updatedAt) && state.updatedAt > 0 ? state.updatedAt : Date.now(),
      });
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
      return normalized;
    },
    async update(records) {
      const current = await this.read();
      const nextRecords = emptyBuckets();
      for (const protocol of LOOM_PROTOCOL_NAMES) {
        nextRecords[protocol].push(...current.records[protocol]);
      }
      for (const record of records) {
        nextRecords[record.protocol].push(record);
      }
      return this.write({
        version: 1,
        updatedAt: Date.now(),
        records: nextRecords,
      });
    },
  };
}
