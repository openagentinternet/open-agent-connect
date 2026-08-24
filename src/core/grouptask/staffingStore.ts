/**
 * Staffing proposal store: file-backed CRUD for the wish→slate→owner-gate
 * pipeline (OAC port of the IDBots `group_task_staffing_proposals` table).
 *
 * Layout (storage layout v2, under the CHAIR profile's grouptask root):
 *   .runtime/grouptask/staffing.json — proposals + id sequence
 *
 * Writes are atomic (tmp + rename) and serialized through an in-process
 * queue; the daemon is the only writer (CLI verbs delegate over HTTP). The
 * claim/release pair is the CAS that keeps two concurrent create attempts
 * from double-opening an on-chain group: `claim` only succeeds while the
 * proposal sits in a creatable state, `release` restores that state when the
 * chain create failed so the slate is not burned.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { MetabotPaths } from '../state/paths';
import {
  isStaffingProposalExpired,
  normalizeStaffingPlan,
  type GroupTaskStaffingPlan,
  type GroupTaskStaffingProposalStatus,
} from './staffing';

export type StaffingOwnerDecisionMarker = 'confirm' | 'revise' | 'skip';

export interface GroupTaskStaffingProposalRecord {
  id: number;
  chairSlug: string;
  sourceSessionId: string | null;
  title: string;
  goal: string;
  acceptanceCriteria: string | null;
  plan: GroupTaskStaffingPlan;
  status: GroupTaskStaffingProposalStatus;
  skipAuthorized: boolean;
  /** Last explicit owner decision recorded via UI/CLI ('confirm'|'revise'|'skip'). */
  ownerDecision: StaffingOwnerDecisionMarker | null;
  createdTaskId: number | null;
  createdAt: number;
  confirmedAt: number | null;
  updatedAt: number;
}

export interface CreateStaffingProposalInput {
  chairSlug: string;
  sourceSessionId?: string | null;
  title: string;
  goal: string;
  acceptanceCriteria?: string | null;
  plan: unknown;
  skipAuthorized: boolean;
}

interface StaffingStateFile {
  seq: number;
  proposals: GroupTaskStaffingProposalRecord[];
}

function emptyState(): StaffingStateFile {
  return { seq: 0, proposals: [] };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, filePath);
}

export class StaffingStoreError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'StaffingStoreError';
  }
}

export interface StaffingStore {
  /** Absolute staffing file path (…/.runtime/grouptask/staffing.json). */
  readonly filePath: string;
  createProposal(input: CreateStaffingProposalInput): Promise<GroupTaskStaffingProposalRecord>;
  listProposals(options?: { status?: GroupTaskStaffingProposalStatus }): Promise<GroupTaskStaffingProposalRecord[]>;
  getProposal(id: number): Promise<GroupTaskStaffingProposalRecord | null>;
  /** CAS: consumed only while the proposal is still creatable. */
  claimProposal(id: number): Promise<GroupTaskStaffingProposalRecord>;
  /** Restores the pre-claim creatable state after a failed chain create. */
  releaseProposal(id: number): Promise<GroupTaskStaffingProposalRecord>;
  /** Records the created task on a claimed proposal. */
  markProposalCreated(id: number, taskId: number): Promise<GroupTaskStaffingProposalRecord>;
  setOwnerDecision(
    id: number,
    decision: StaffingOwnerDecisionMarker,
  ): Promise<GroupTaskStaffingProposalRecord>;
  cancelProposal(id: number): Promise<GroupTaskStaffingProposalRecord>;
}

/** Statuses from which a proposal may still be claimed for creation. */
const CREATABLE_STATUSES: readonly GroupTaskStaffingProposalStatus[] = [
  'pending',
  'confirmed',
  'skip_authorized',
];

function restoredStatus(record: GroupTaskStaffingProposalRecord): GroupTaskStaffingProposalStatus {
  if (record.ownerDecision === 'confirm') return 'confirmed';
  if (record.ownerDecision === 'skip') return 'skip_authorized';
  return 'pending';
}

export function createStaffingStore(paths: MetabotPaths): StaffingStore {
  const filePath = path.join(paths.runtimeRoot, 'grouptask', 'staffing.json');

  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  async function readState(): Promise<StaffingStateFile> {
    const parsed = await readJsonFile<Partial<StaffingStateFile>>(filePath);
    if (!parsed || typeof parsed !== 'object') return emptyState();
    const proposals = Array.isArray(parsed.proposals)
      ? parsed.proposals.map((row) => normalizeProposalRecord(row))
      : [];
    return {
      seq: Number.isInteger(parsed.seq) && (parsed.seq as number) >= 0 ? (parsed.seq as number) : 0,
      proposals,
    };
  }

  async function writeState(state: StaffingStateFile): Promise<void> {
    await writeJsonFileAtomic(filePath, state);
  }

  function requireProposal(state: StaffingStateFile, id: number): GroupTaskStaffingProposalRecord {
    const record = state.proposals.find((entry) => entry.id === id);
    if (!record) {
      throw new StaffingStoreError('proposal_not_found', `Staffing proposal ${id} not found`);
    }
    return record;
  }

  return {
    filePath,

    createProposal: (input) => enqueue(async () => {
      const state = await readState();
      const now = Date.now();
      const record: GroupTaskStaffingProposalRecord = {
        id: state.seq + 1,
        chairSlug: input.chairSlug,
        sourceSessionId: input.sourceSessionId?.trim() || null,
        title: input.title,
        goal: input.goal,
        acceptanceCriteria: input.acceptanceCriteria ?? null,
        plan: normalizeStaffingPlan(input.plan),
        status: input.skipAuthorized ? 'skip_authorized' : 'pending',
        skipAuthorized: input.skipAuthorized,
        ownerDecision: null,
        createdTaskId: null,
        createdAt: now,
        confirmedAt: null,
        updatedAt: now,
      };
      state.seq = record.id;
      state.proposals.push(record);
      await writeState(state);
      return record;
    }),

    listProposals: (options) => enqueue(async () => {
      const state = await readState();
      const rows = [...state.proposals].sort((left, right) => right.createdAt - left.createdAt);
      return options?.status ? rows.filter((row) => row.status === options.status) : rows;
    }),

    getProposal: (id) => enqueue(async () => {
      const state = await readState();
      return state.proposals.find((entry) => entry.id === id) ?? null;
    }),

    claimProposal: (id) => enqueue(async () => {
      const state = await readState();
      const record = requireProposal(state, id);
      if (!CREATABLE_STATUSES.includes(record.status)) {
        throw new StaffingStoreError(
          'proposal_not_claimable',
          `Staffing proposal ${id} is ${record.status} and cannot be claimed`,
        );
      }
      record.status = 'consumed';
      record.updatedAt = Date.now();
      await writeState(state);
      return record;
    }),

    releaseProposal: (id) => enqueue(async () => {
      const state = await readState();
      const record = requireProposal(state, id);
      if (record.status === 'consumed' && record.createdTaskId === null) {
        record.status = restoredStatus(record);
        record.updatedAt = Date.now();
        await writeState(state);
      }
      return record;
    }),

    markProposalCreated: (id, taskId) => enqueue(async () => {
      const state = await readState();
      const record = requireProposal(state, id);
      record.createdTaskId = taskId;
      record.status = 'consumed';
      record.updatedAt = Date.now();
      await writeState(state);
      return record;
    }),

    setOwnerDecision: (id, decision) => enqueue(async () => {
      const state = await readState();
      const record = requireProposal(state, id);
      if (record.status === 'consumed' || record.status === 'cancelled') {
        throw new StaffingStoreError(
          'proposal_not_decidable',
          `Staffing proposal ${id} is ${record.status} and can no longer be decided`,
        );
      }
      record.ownerDecision = decision;
      const now = Date.now();
      if (decision === 'confirm') {
        record.status = 'confirmed';
        record.confirmedAt = now;
      } else if (decision === 'skip') {
        record.status = 'skip_authorized';
      } else {
        // 'revise' reopens the slate for a fresh proposal round.
        record.status = 'pending';
      }
      record.updatedAt = now;
      await writeState(state);
      return record;
    }),

    cancelProposal: (id) => enqueue(async () => {
      const state = await readState();
      const record = requireProposal(state, id);
      if (record.status === 'consumed') {
        throw new StaffingStoreError(
          'proposal_not_cancellable',
          `Staffing proposal ${id} is consumed by task ${record.createdTaskId}`,
        );
      }
      record.status = 'cancelled';
      record.updatedAt = Date.now();
      await writeState(state);
      return record;
    }),
  };
}

function normalizeProposalRecord(value: unknown): GroupTaskStaffingProposalRecord {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const status = record.status === 'confirmed'
    || record.status === 'skip_authorized'
    || record.status === 'consumed'
    || record.status === 'cancelled'
    ? record.status
    : 'pending';
  const ownerDecision = record.ownerDecision === 'confirm'
    || record.ownerDecision === 'revise'
    || record.ownerDecision === 'skip'
    ? record.ownerDecision
    : null;
  const toNumber = (input: unknown): number | null => (
    typeof input === 'number' && Number.isFinite(input) ? input : null
  );
  return {
    id: toNumber(record.id) ?? 0,
    chairSlug: typeof record.chairSlug === 'string' ? record.chairSlug : '',
    sourceSessionId: typeof record.sourceSessionId === 'string' ? record.sourceSessionId : null,
    title: typeof record.title === 'string' ? record.title : '',
    goal: typeof record.goal === 'string' ? record.goal : '',
    acceptanceCriteria: typeof record.acceptanceCriteria === 'string' ? record.acceptanceCriteria : null,
    plan: normalizeStaffingPlan(record.plan),
    status,
    skipAuthorized: record.skipAuthorized === true,
    ownerDecision,
    createdTaskId: toNumber(record.createdTaskId),
    createdAt: toNumber(record.createdAt) ?? 0,
    confirmedAt: toNumber(record.confirmedAt),
    updatedAt: toNumber(record.updatedAt) ?? toNumber(record.createdAt) ?? 0,
  };
}

/** Read-time usability check shared by the service gate. */
export function staffingProposalUsableAt(
  record: GroupTaskStaffingProposalRecord,
  nowMs: number,
): { usable: boolean; reason: 'ok' | 'consumed' | 'cancelled' | 'created' | 'expired' } {
  if (record.createdTaskId !== null) return { usable: false, reason: 'created' };
  if (record.status === 'consumed') return { usable: false, reason: 'consumed' };
  if (record.status === 'cancelled') return { usable: false, reason: 'cancelled' };
  if (isStaffingProposalExpired(record.createdAt, nowMs)) return { usable: false, reason: 'expired' };
  return { usable: true, reason: 'ok' };
}
