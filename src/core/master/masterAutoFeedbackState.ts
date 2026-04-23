import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { MasterTriggerMemoryState } from './masterTriggerEngine';
import { ensureRuntimeLayout } from '../state/runtimeStateStore';
import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';

export const MASTER_AUTO_FEEDBACK_MAX_ITEMS = 100;
export const MASTER_AUTO_REJECTION_COOLDOWN_MS = 30 * 60 * 1000;
export const MASTER_AUTO_TIMEOUT_COOLDOWN_MS = 15 * 60 * 1000;
export const MASTER_AUTO_SIGNATURE_COOLDOWN_MS = 30 * 60 * 1000;

export type MasterAutoFeedbackStatus =
  | 'prepared'
  | 'confirmed'
  | 'rejected'
  | 'sent'
  | 'timed_out'
  | 'completed';

export interface MasterAutoFeedbackRecord {
  traceId: string;
  masterKind: string | null;
  masterServicePinId: string | null;
  triggerReasonSignature: string | null;
  status: MasterAutoFeedbackStatus;
  createdAt: number;
  updatedAt: number;
}

export interface MasterAutoFeedbackState {
  items: MasterAutoFeedbackRecord[];
}

export interface MasterAutoFeedbackStateStore {
  paths: MetabotPaths;
  statePath: string;
  read(): Promise<MasterAutoFeedbackState>;
  write(nextState: MasterAutoFeedbackState): Promise<MasterAutoFeedbackState>;
  update(
    updater: (currentState: MasterAutoFeedbackState) => MasterAutoFeedbackState | Promise<MasterAutoFeedbackState>
  ): Promise<MasterAutoFeedbackState>;
  get(traceId: string): Promise<MasterAutoFeedbackRecord>;
  put(record: MasterAutoFeedbackRecord): Promise<MasterAutoFeedbackRecord>;
}

let atomicWriteSequence = 0;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function normalizeStatus(value: unknown): MasterAutoFeedbackStatus {
  const normalized = normalizeText(value);
  if (
    normalized === 'prepared'
    || normalized === 'confirmed'
    || normalized === 'rejected'
    || normalized === 'sent'
    || normalized === 'timed_out'
    || normalized === 'completed'
  ) {
    return normalized;
  }
  return 'prepared';
}

function normalizeRecord(value: unknown): MasterAutoFeedbackRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const traceId = normalizeText(record.traceId);
  if (!traceId) {
    return null;
  }

  const createdAt = normalizeNumber(record.createdAt) || Date.now();
  const updatedAt = normalizeNumber(record.updatedAt) || createdAt;

  return {
    traceId,
    masterKind: normalizeText(record.masterKind) || null,
    masterServicePinId: normalizeText(record.masterServicePinId) || null,
    triggerReasonSignature: normalizeText(record.triggerReasonSignature) || null,
    status: normalizeStatus(record.status),
    createdAt,
    updatedAt,
  };
}

function createEmptyState(): MasterAutoFeedbackState {
  return {
    items: [],
  };
}

function normalizeState(value: MasterAutoFeedbackState | null | undefined): MasterAutoFeedbackState {
  if (!value || typeof value !== 'object') {
    return createEmptyState();
  }

  const items = Array.isArray(value.items)
    ? value.items
      .map((entry) => normalizeRecord(entry))
      .filter((entry): entry is MasterAutoFeedbackRecord => entry !== null)
      .slice(0, MASTER_AUTO_FEEDBACK_MAX_ITEMS)
    : [];

  return { items };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
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

function normalizeStringArray(value: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of value) {
    const text = normalizeText(entry);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    normalized.push(text);
  }
  return normalized;
}

export function deriveMasterTriggerMemoryStateFromAutoFeedbackState(input: {
  state: MasterAutoFeedbackState | null | undefined;
  now?: number;
}): MasterTriggerMemoryState {
  const state = normalizeState(input.state);
  const now = typeof input.now === 'number' && Number.isFinite(input.now) ? input.now : Date.now();

  return {
    suggestedTraceIds: normalizeStringArray(
      state.items.map((entry) => entry.traceId)
    ).slice(-25),
    rejectedMasterKinds: [],
    recentFailureSignatures: normalizeStringArray(
      state.items
        .filter((entry) => (
          (entry.status === 'rejected' || entry.status === 'timed_out' || entry.status === 'completed')
          && now - entry.updatedAt <= MASTER_AUTO_SIGNATURE_COOLDOWN_MS
        ))
        .map((entry) => entry.triggerReasonSignature)
    ).slice(-50),
    manuallyRequestedMasterKinds: [],
  };
}

export function findRecentAutoFeedbackForTarget(input: {
  state: MasterAutoFeedbackState | null | undefined;
  masterServicePinId: string | null | undefined;
  now?: number;
}): MasterAutoFeedbackRecord | null {
  const state = normalizeState(input.state);
  const masterServicePinId = normalizeText(input.masterServicePinId);
  if (!masterServicePinId) {
    return null;
  }

  const now = typeof input.now === 'number' && Number.isFinite(input.now) ? input.now : Date.now();
  return state.items.find((entry) => (
    normalizeText(entry.masterServicePinId) === masterServicePinId
    && (
      (
        entry.status === 'rejected'
        && now - entry.updatedAt <= MASTER_AUTO_REJECTION_COOLDOWN_MS
      )
      || (
        entry.status === 'timed_out'
        && now - entry.updatedAt <= MASTER_AUTO_TIMEOUT_COOLDOWN_MS
      )
    )
  )) ?? null;
}

export function createMasterAutoFeedbackStateStore(
  homeDirOrPaths: string | MetabotPaths
): MasterAutoFeedbackStateStore {
  const paths = typeof homeDirOrPaths === 'string' ? resolveMetabotPaths(homeDirOrPaths) : homeDirOrPaths;
  const statePath = paths.masterAutoFeedbackStatePath;

  return {
    paths,
    statePath,
    async read() {
      await ensureRuntimeLayout(paths);
      return normalizeState(await readJsonFile<MasterAutoFeedbackState>(statePath));
    },
    async write(nextState) {
      await ensureRuntimeLayout(paths);
      const normalized = normalizeState(nextState);
      await writeJsonAtomic(statePath, normalized);
      return normalized;
    },
    async update(updater) {
      const current = await this.read();
      const next = await updater(current);
      return this.write(next);
    },
    async get(traceId) {
      const state = await this.read();
      const record = state.items.find((entry) => entry.traceId === normalizeText(traceId));
      if (!record) {
        throw new Error(`Master auto feedback record not found: ${traceId}`);
      }
      return record;
    },
    async put(record) {
      const normalized = normalizeRecord(record);
      if (!normalized) {
        throw new Error('Master auto feedback record requires traceId.');
      }
      await this.update((current) => ({
        items: [
          normalized,
          ...current.items.filter((entry) => entry.traceId !== normalized.traceId),
        ].slice(0, MASTER_AUTO_FEEDBACK_MAX_ITEMS),
      }));
      return normalized;
    },
  };
}
