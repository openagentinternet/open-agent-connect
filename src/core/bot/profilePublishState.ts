import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  type ChainWriteEncoding,
  type ChainWriteNetwork,
  type ChainWritePayload,
  type ChainWriteResult,
} from '../chain/writePin';
import { ensureRuntimeLayout } from '../state/runtimeStateStore';
import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';

export interface ProfilePublishRecord {
  payloadHash: string;
  contentType: string;
  encoding: ChainWriteEncoding;
  network: ChainWriteNetwork;
  pinId: string;
  txids: string[];
  publishedAt: string;
}

export interface ProfilePublishState {
  version: 1;
  records: Record<string, ProfilePublishRecord>;
}

export interface ProfilePublishPayloadInput {
  path: string;
  contentType: string;
  encoding?: ChainWriteEncoding;
  payload: ChainWritePayload;
}

export interface ProfilePublishStateStore {
  paths: MetabotPaths;
  read(): Promise<ProfilePublishState>;
  write(nextState: ProfilePublishState): Promise<ProfilePublishState>;
  update(
    updater: (
      currentState: ProfilePublishState
    ) => ProfilePublishState | Promise<ProfilePublishState>
  ): Promise<ProfilePublishState>;
}

let atomicWriteSequence = 0;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEncoding(value: unknown): ChainWriteEncoding {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'base64' || normalized === 'binary') {
    return normalized;
  }
  return 'utf-8';
}

function normalizeNetwork(value: unknown): ChainWriteNetwork {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'btc' || normalized === 'doge' || normalized === 'opcat') {
    return normalized;
  }
  return 'mvc';
}

function normalizeTxids(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => normalizeText(entry)).filter(Boolean);
}

function createEmptyProfilePublishState(): ProfilePublishState {
  return {
    version: 1,
    records: {},
  };
}

function normalizeProfilePublishRecord(value: unknown): ProfilePublishRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const payloadHash = normalizeText(record.payloadHash);
  const contentType = normalizeText(record.contentType);
  const pinId = normalizeText(record.pinId);
  if (!payloadHash || !contentType || !pinId) {
    return null;
  }
  return {
    payloadHash,
    contentType,
    encoding: normalizeEncoding(record.encoding),
    network: normalizeNetwork(record.network),
    pinId,
    txids: normalizeTxids(record.txids),
    publishedAt: normalizeText(record.publishedAt) || new Date(0).toISOString(),
  };
}

function normalizeProfilePublishState(value: unknown): ProfilePublishState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createEmptyProfilePublishState();
  }
  const recordsInput = (value as { records?: unknown }).records;
  if (!recordsInput || typeof recordsInput !== 'object' || Array.isArray(recordsInput)) {
    return createEmptyProfilePublishState();
  }
  const records: Record<string, ProfilePublishRecord> = {};
  for (const [rawPath, rawRecord] of Object.entries(recordsInput as Record<string, unknown>)) {
    const recordPath = normalizeText(rawPath);
    const record = normalizeProfilePublishRecord(rawRecord);
    if (recordPath && record) {
      records[recordPath] = record;
    }
  }
  return {
    version: 1,
    records,
  };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
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

function nextAtomicWriteSuffix(): string {
  atomicWriteSequence += 1;
  return `${process.pid}.${Date.now()}.${atomicWriteSequence}`;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${nextAtomicWriteSuffix()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

function payloadForHash(payload: ChainWritePayload, encoding: ChainWriteEncoding): string {
  if (Buffer.isBuffer(payload)) {
    return Buffer.from(payload).toString('base64');
  }
  if (encoding === 'binary') {
    return Buffer.from(payload, 'utf8').toString('base64');
  }
  return payload;
}

export function hashProfilePublishPayload(input: ProfilePublishPayloadInput): string {
  const encoding = normalizeEncoding(input.encoding);
  const normalized = JSON.stringify({
    path: normalizeText(input.path),
    contentType: normalizeText(input.contentType),
    encoding,
    payload: payloadForHash(input.payload, encoding),
  });
  return createHash('sha256').update(normalized).digest('hex');
}

export function buildProfilePublishRecord(input: {
  target: ProfilePublishPayloadInput;
  result: ChainWriteResult;
  publishedAt?: string;
}): ProfilePublishRecord {
  return {
    payloadHash: hashProfilePublishPayload(input.target),
    contentType: normalizeText(input.result.contentType) || normalizeText(input.target.contentType),
    encoding: normalizeEncoding(input.result.encoding || input.target.encoding),
    network: normalizeNetwork(input.result.network),
    pinId: normalizeText(input.result.pinId),
    txids: normalizeTxids(input.result.txids),
    publishedAt: normalizeText(input.publishedAt) || new Date().toISOString(),
  };
}

export function createProfilePublishStateStore(
  homeDirOrPaths: string | MetabotPaths,
): ProfilePublishStateStore {
  const paths = typeof homeDirOrPaths === 'string' ? resolveMetabotPaths(homeDirOrPaths) : homeDirOrPaths;

  return {
    paths,
    async read() {
      await ensureRuntimeLayout(paths);
      return normalizeProfilePublishState(await readJsonFile<ProfilePublishState>(paths.profilePublishStatePath));
    },
    async write(nextState) {
      await ensureRuntimeLayout(paths);
      const normalized = normalizeProfilePublishState(nextState);
      await writeJsonAtomic(paths.profilePublishStatePath, normalized);
      return normalized;
    },
    async update(updater) {
      const currentState = await this.read();
      const nextState = await updater(currentState);
      return this.write(nextState);
    },
  };
}
