import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { MasterTriggerMemoryState } from './masterTriggerEngine';
import { ensureHotLayout } from '../state/runtimeStateStore';
import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';

export const MASTER_SUGGEST_REJECTION_COOLDOWN_MS = 30 * 60 * 1000;
export const MASTER_SUGGEST_SIGNATURE_COOLDOWN_MS = 30 * 60 * 1000;
export const MASTER_SUGGEST_ACCEPT_COOLDOWN_MS = 30 * 60 * 1000;
export const MASTER_SUGGEST_MAX_ITEMS = 100;

export interface StoredMasterSuggestTarget {
  servicePinId: string;
  providerGlobalMetaId: string;
  masterKind: string;
  displayName: string | null;
}

export interface StoredMasterSuggestRecord {
  suggestionId: string;
  traceId: string;
  createdAt: number;
  updatedAt: number;
  status: 'suggested' | 'accepted' | 'rejected';
  hostMode: string;
  candidateMasterKind: string | null;
  candidateDisplayName: string | null;
  reason: string;
  confidence: number;
  failureSignatures: string[];
  draft: Record<string, unknown>;
  target: StoredMasterSuggestTarget;
  rejectionReason?: string | null;
  acceptedAt?: number | null;
  rejectedAt?: number | null;
}

export interface MasterSuggestState {
  items: StoredMasterSuggestRecord[];
}

export interface MasterSuggestStateStore {
  paths: MetabotPaths;
  statePath: string;
  read(): Promise<MasterSuggestState>;
  write(nextState: MasterSuggestState): Promise<MasterSuggestState>;
  update(
    updater: (currentState: MasterSuggestState) => MasterSuggestState | Promise<MasterSuggestState>
  ): Promise<MasterSuggestState>;
  get(traceId: string, suggestionId: string): Promise<StoredMasterSuggestRecord>;
  put(record: StoredMasterSuggestRecord): Promise<StoredMasterSuggestRecord>;
}

let atomicWriteSequence = 0;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

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

function normalizeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function normalizeDraft(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function normalizeTarget(value: unknown): StoredMasterSuggestTarget {
  const target = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    servicePinId: normalizeText(target.servicePinId),
    providerGlobalMetaId: normalizeText(target.providerGlobalMetaId),
    masterKind: normalizeText(target.masterKind),
    displayName: normalizeText(target.displayName) || null,
  };
}

function normalizeRecord(value: unknown): StoredMasterSuggestRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const suggestionId = normalizeText(record.suggestionId);
  const traceId = normalizeText(record.traceId);
  if (!suggestionId || !traceId) {
    return null;
  }

  const status = normalizeText(record.status);
  const normalizedStatus = status === 'accepted' || status === 'rejected'
    ? status
    : 'suggested';

  return {
    suggestionId,
    traceId,
    createdAt: normalizeNumber(record.createdAt) || Date.now(),
    updatedAt: normalizeNumber(record.updatedAt) || Date.now(),
    status: normalizedStatus,
    hostMode: normalizeText(record.hostMode) || 'codex',
    candidateMasterKind: normalizeText(record.candidateMasterKind) || null,
    candidateDisplayName: normalizeText(record.candidateDisplayName) || null,
    reason: normalizeText(record.reason),
    confidence: Number.isFinite(Number(record.confidence)) ? Number(record.confidence) : 0,
    failureSignatures: normalizeStringArray(record.failureSignatures),
    draft: normalizeDraft(record.draft),
    target: normalizeTarget(record.target),
    rejectionReason: normalizeText(record.rejectionReason) || null,
    acceptedAt: normalizeNullableNumber(record.acceptedAt),
    rejectedAt: normalizeNullableNumber(record.rejectedAt),
  };
}

function createEmptyState(): MasterSuggestState {
  return {
    items: [],
  };
}

function normalizeState(value: MasterSuggestState | null | undefined): MasterSuggestState {
  if (!value || typeof value !== 'object') {
    return createEmptyState();
  }

  const items = Array.isArray(value.items)
    ? value.items
      .map((entry) => normalizeRecord(entry))
      .filter((entry): entry is StoredMasterSuggestRecord => entry !== null)
      .slice(0, MASTER_SUGGEST_MAX_ITEMS)
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

export function buildMasterSuggestionId(now: number): string {
  return `master-suggest-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function deriveMasterTriggerMemoryStateFromSuggestState(input: {
  state: MasterSuggestState | null | undefined;
  now?: number;
}): MasterTriggerMemoryState {
  const state = normalizeState(input.state);
  const now = typeof input.now === 'number' && Number.isFinite(input.now) ? input.now : Date.now();

  return {
    suggestedTraceIds: normalizeStringArray(state.items.map((entry) => entry.traceId)).slice(-25),
    rejectedMasterKinds: normalizeStringArray(
      state.items
        .filter((entry) => entry.status === 'rejected')
        .filter((entry) => typeof entry.rejectedAt === 'number' && now - entry.rejectedAt <= MASTER_SUGGEST_REJECTION_COOLDOWN_MS)
        .map((entry) => entry.candidateMasterKind)
    ).slice(-25),
    recentFailureSignatures: normalizeStringArray(
      state.items
        .filter((entry) => (
          (
            entry.status === 'suggested'
            && now - entry.updatedAt <= MASTER_SUGGEST_SIGNATURE_COOLDOWN_MS
          )
          || (
            entry.status === 'accepted'
            && now - (entry.acceptedAt ?? entry.updatedAt) <= MASTER_SUGGEST_SIGNATURE_COOLDOWN_MS
          )
          || (
            entry.status === 'rejected'
            && typeof entry.rejectedAt === 'number'
            && now - entry.rejectedAt <= MASTER_SUGGEST_SIGNATURE_COOLDOWN_MS
          )
        ))
        .flatMap((entry) => entry.failureSignatures)
    ).slice(-50),
    manuallyRequestedMasterKinds: normalizeStringArray(
      state.items
        .filter((entry) => entry.status === 'accepted')
        .filter((entry) => now - (entry.acceptedAt ?? entry.updatedAt) <= MASTER_SUGGEST_ACCEPT_COOLDOWN_MS)
        .map((entry) => entry.candidateMasterKind)
    ).slice(-25),
  };
}

export function createMasterSuggestStateStore(homeDirOrPaths: string | MetabotPaths): MasterSuggestStateStore {
  const paths = typeof homeDirOrPaths === 'string' ? resolveMetabotPaths(homeDirOrPaths) : homeDirOrPaths;
  const statePath = paths.masterSuggestStatePath;

  return {
    paths,
    statePath,
    async read() {
      await ensureHotLayout(paths);
      return normalizeState(await readJsonFile<MasterSuggestState>(statePath));
    },
    async write(nextState) {
      await ensureHotLayout(paths);
      const normalized = normalizeState(nextState);
      await writeJsonAtomic(statePath, normalized);
      return normalized;
    },
    async update(updater) {
      const current = await this.read();
      const next = await updater(current);
      return this.write(next);
    },
    async get(traceId, suggestionId) {
      const state = await this.read();
      const record = state.items.find((entry) => entry.traceId === traceId && entry.suggestionId === suggestionId);
      if (!record) {
        throw new Error(`Ask Master suggestion not found: ${traceId}:${suggestionId}`);
      }
      return record;
    },
    async put(record) {
      const normalizedRecord = normalizeRecord(record);
      if (!normalizedRecord) {
        throw new Error('Invalid Ask Master suggestion record.');
      }
      await this.update((current) => ({
        items: [
          normalizedRecord,
          ...current.items.filter((entry) => !(
            entry.traceId === normalizedRecord.traceId
            && entry.suggestionId === normalizedRecord.suggestionId
          )),
        ].slice(0, MASTER_SUGGEST_MAX_ITEMS),
      }));
      return normalizedRecord;
    },
  };
}
