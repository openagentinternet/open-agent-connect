/**
 * OpenTeam store: file-backed state for the remote-member handshake, one file
 * per profile at `.runtime/grouptask/openteam.json` (storage layout v2).
 *
 * Two sides live in the same file because a profile can play both roles:
 * - `invites`      — rows this profile SENT as a task chair (IDBots
 *                    `openteam_invites` parity: pending→accepted|declined|expired);
 * - `guestInvites` — rows this profile RECEIVED (IDBots `openteam_guest_invites`:
 *                    invited→accepted|declined|skipped|expired);
 * - `memberships`  — groups this profile joined as a guest worker (IDBots
 *                    `openteam_memberships`: active→left, with the guest reply
 *                    cursor `lastProcessedIndex`);
 * - `kv`           — engine scan cursors and dedupe guards.
 *
 * Same write discipline as the grouptask store: atomic tmp+rename writes,
 * serialized through an in-process queue.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { MetabotPaths } from '../state/paths';

export type OpenTeamInviteStatus = 'pending' | 'accepted' | 'declined' | 'expired';
export type OpenTeamGuestInviteStatus = 'invited' | 'accepted' | 'declined' | 'skipped' | 'expired';
export type OpenTeamMembershipStatus = 'active' | 'left';
export type OpenTeamLeftCause = 'kick' | 'self_check' | 'opt_out';

export interface OpenTeamInviteRecord {
  id: number;
  taskId: number;
  groupId: string;
  /** Random pinId-shaped correlation id carried in the envelope. */
  inviteId: string;
  inviteeGlobalMetaId: string;
  inviteeName: string | null;
  requiredSkills: string[];
  status: OpenTeamInviteStatus;
  declineReason: string | null;
  /** Join pin echoed by the ACCEPT reply. */
  joinedPinId: string | null;
  /** simplemsg pin id of the invite send (null when the send failed). */
  sentPinId: string | null;
  /** Epoch seconds (wire parity with the envelope field). */
  expiresAt: number;
  createdAt: number;
  respondedAt: number | null;
  /** Set once the remote member row was added to the task (join confirmed). */
  memberAddedAt: number | null;
}

export interface OpenTeamGuestInviteRecord {
  id: number;
  groupId: string;
  inviteId: string;
  inviterGlobalMetaId: string;
  inviterName: string | null;
  taskTitle: string;
  goalSummary: string | null;
  requiredSkills: string[];
  targetGlobalMetaId: string;
  /** Epoch seconds. */
  expiresAt: number;
  status: OpenTeamGuestInviteStatus;
  declineReason: string | null;
  joinedPinId: string | null;
  createdAt: number;
  respondedAt: number | null;
}

export interface OpenTeamMembershipRecord {
  id: number;
  groupId: string;
  /** Local profile slug that joined the group as a guest. */
  slug: string;
  inviterGlobalMetaId: string;
  inviterName: string | null;
  taskTitle: string;
  goalSummary: string | null;
  inviteId: string;
  joinedPinId: string | null;
  status: OpenTeamMembershipStatus;
  createdAt: number;
  activatedAt: number | null;
  /** Guest reply cursor over the group's chain message index. */
  lastProcessedIndex: number;
  leftAt: number | null;
  leftCause: OpenTeamLeftCause | null;
  leftReason: string | null;
}

export interface OpenTeamStateFile {
  seq: number;
  invites: OpenTeamInviteRecord[];
  guestInvites: OpenTeamGuestInviteRecord[];
  memberships: OpenTeamMembershipRecord[];
  kv: Record<string, string>;
}

function emptyState(): OpenTeamStateFile {
  return { seq: 0, invites: [], guestInvites: [], memberships: [], kv: {} };
}

export interface CreateOpenTeamInviteInput {
  taskId: number;
  groupId: string;
  inviteId: string;
  inviteeGlobalMetaId: string;
  inviteeName?: string | null;
  requiredSkills?: string[];
  sentPinId?: string | null;
  expiresAt: number;
}

export interface CreateOpenTeamGuestInviteInput {
  groupId: string;
  inviteId: string;
  inviterGlobalMetaId: string;
  inviterName?: string | null;
  taskTitle: string;
  goalSummary?: string | null;
  requiredSkills?: string[];
  targetGlobalMetaId: string;
  expiresAt: number;
  status: OpenTeamGuestInviteStatus;
  declineReason?: string | null;
  joinedPinId?: string | null;
}

export interface CreateOpenTeamMembershipInput {
  groupId: string;
  slug: string;
  inviterGlobalMetaId: string;
  inviterName?: string | null;
  taskTitle: string;
  goalSummary?: string | null;
  inviteId: string;
  joinedPinId?: string | null;
}

export interface OpenTeamStore {
  readonly root: string;

  // Inviter side
  createInvite(input: CreateOpenTeamInviteInput): Promise<OpenTeamInviteRecord>;
  getInviteByInviteId(inviteId: string): Promise<OpenTeamInviteRecord | null>;
  listInvites(taskId?: number): Promise<OpenTeamInviteRecord[]>;
  updateInvite(
    inviteId: string,
    patch: Partial<Pick<OpenTeamInviteRecord,
      'status' | 'declineReason' | 'joinedPinId' | 'sentPinId' | 'respondedAt' | 'memberAddedAt'>>,
  ): Promise<OpenTeamInviteRecord | null>;

  // Guest side
  createGuestInvite(input: CreateOpenTeamGuestInviteInput): Promise<OpenTeamGuestInviteRecord>;
  getGuestInviteByInviteId(inviteId: string): Promise<OpenTeamGuestInviteRecord | null>;
  listGuestInvites(): Promise<OpenTeamGuestInviteRecord[]>;
  updateGuestInvite(
    inviteId: string,
    patch: Partial<Pick<OpenTeamGuestInviteRecord, 'status' | 'declineReason' | 'joinedPinId' | 'respondedAt'>>,
  ): Promise<OpenTeamGuestInviteRecord | null>;

  createMembership(input: CreateOpenTeamMembershipInput): Promise<OpenTeamMembershipRecord>;
  getMembership(groupId: string, slug: string): Promise<OpenTeamMembershipRecord | null>;
  listMemberships(options?: { activeOnly?: boolean }): Promise<OpenTeamMembershipRecord[]>;
  activateMembership(groupId: string, slug: string, joinedPinId: string | null): Promise<void>;
  updateMembershipCursor(groupId: string, slug: string, lastProcessedIndex: number): Promise<void>;
  leaveMembership(
    groupId: string,
    slug: string,
    cause: OpenTeamLeftCause,
    reason?: string | null,
  ): Promise<void>;

  kvGet(key: string): Promise<string | undefined>;
  kvSet(key: string, value: string): Promise<void>;
  kvDelete(key: string): Promise<void>;
}

export function resolveOpenTeamStatePath(paths: MetabotPaths): string {
  return path.join(paths.runtimeRoot, 'grouptask', 'openteam.json');
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

export function createOpenTeamStore(paths: MetabotPaths): OpenTeamStore {
  const statePath = resolveOpenTeamStatePath(paths);
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  }

  async function readState(): Promise<OpenTeamStateFile> {
    const state = await readJsonFile<OpenTeamStateFile>(statePath);
    if (!state) return emptyState();
    return {
      seq: Number(state.seq) || 0,
      invites: Array.isArray(state.invites) ? state.invites : [],
      guestInvites: Array.isArray(state.guestInvites) ? state.guestInvites : [],
      memberships: Array.isArray(state.memberships) ? state.memberships : [],
      kv: state.kv && typeof state.kv === 'object' ? state.kv : {},
    };
  }

  async function mutate<T>(work: (state: OpenTeamStateFile) => T): Promise<T> {
    return enqueue(async () => {
      const state = await readState();
      const result = work(state);
      await writeJsonFileAtomic(statePath, state);
      return result;
    });
  }

  return {
    root: path.dirname(statePath),

    createInvite: (input) => mutate((state) => {
      state.seq += 1;
      const record: OpenTeamInviteRecord = {
        id: state.seq,
        taskId: input.taskId,
        groupId: input.groupId,
        inviteId: input.inviteId,
        inviteeGlobalMetaId: input.inviteeGlobalMetaId,
        inviteeName: input.inviteeName ?? null,
        requiredSkills: input.requiredSkills ?? [],
        status: 'pending',
        declineReason: null,
        joinedPinId: null,
        sentPinId: input.sentPinId ?? null,
        expiresAt: input.expiresAt,
        createdAt: Date.now(),
        respondedAt: null,
        memberAddedAt: null,
      };
      state.invites.push(record);
      return record;
    }),

    getInviteByInviteId: async (inviteId) => {
      const state = await readState();
      return state.invites.find((entry) => entry.inviteId === inviteId) ?? null;
    },

    listInvites: async (taskId) => {
      const state = await readState();
      return taskId == null
        ? [...state.invites]
        : state.invites.filter((entry) => entry.taskId === taskId);
    },

    updateInvite: (inviteId, patch) => mutate((state) => {
      const record = state.invites.find((entry) => entry.inviteId === inviteId);
      if (!record) return null;
      Object.assign(record, patch);
      return { ...record };
    }),

    createGuestInvite: (input) => mutate((state) => {
      state.seq += 1;
      const record: OpenTeamGuestInviteRecord = {
        id: state.seq,
        groupId: input.groupId,
        inviteId: input.inviteId,
        inviterGlobalMetaId: input.inviterGlobalMetaId,
        inviterName: input.inviterName ?? null,
        taskTitle: input.taskTitle,
        goalSummary: input.goalSummary ?? null,
        requiredSkills: input.requiredSkills ?? [],
        targetGlobalMetaId: input.targetGlobalMetaId,
        expiresAt: input.expiresAt,
        status: input.status,
        declineReason: input.declineReason ?? null,
        joinedPinId: input.joinedPinId ?? null,
        createdAt: Date.now(),
        respondedAt: input.status === 'invited' ? null : Date.now(),
      };
      state.guestInvites.push(record);
      return record;
    }),

    getGuestInviteByInviteId: async (inviteId) => {
      const state = await readState();
      return state.guestInvites.find((entry) => entry.inviteId === inviteId) ?? null;
    },

    listGuestInvites: async () => {
      const state = await readState();
      return [...state.guestInvites];
    },

    updateGuestInvite: (inviteId, patch) => mutate((state) => {
      const record = state.guestInvites.find((entry) => entry.inviteId === inviteId);
      if (!record) return null;
      Object.assign(record, patch, { respondedAt: patch.status ? Date.now() : record.respondedAt });
      return { ...record };
    }),

    createMembership: (input) => mutate((state) => {
      state.seq += 1;
      const record: OpenTeamMembershipRecord = {
        id: state.seq,
        groupId: input.groupId,
        slug: input.slug,
        inviterGlobalMetaId: input.inviterGlobalMetaId,
        inviterName: input.inviterName ?? null,
        taskTitle: input.taskTitle,
        goalSummary: input.goalSummary ?? null,
        inviteId: input.inviteId,
        joinedPinId: input.joinedPinId ?? null,
        status: 'active',
        createdAt: Date.now(),
        activatedAt: Date.now(),
        lastProcessedIndex: -1,
        leftAt: null,
        leftCause: null,
        leftReason: null,
      };
      // Unique (groupId, slug): re-inviting a left member reactivates the row.
      const existing = state.memberships.find(
        (entry) => entry.groupId === input.groupId && entry.slug === input.slug,
      );
      if (existing) {
        Object.assign(existing, {
          inviterGlobalMetaId: record.inviterGlobalMetaId,
          inviterName: record.inviterName,
          taskTitle: record.taskTitle,
          goalSummary: record.goalSummary,
          inviteId: record.inviteId,
          joinedPinId: record.joinedPinId,
          status: 'active',
          activatedAt: record.activatedAt,
          leftAt: null,
          leftCause: null,
          leftReason: null,
        });
        return { ...existing };
      }
      state.memberships.push(record);
      return record;
    }),

    getMembership: async (groupId, slug) => {
      const state = await readState();
      return state.memberships.find((entry) => entry.groupId === groupId && entry.slug === slug) ?? null;
    },

    listMemberships: async (options) => {
      const state = await readState();
      return options?.activeOnly
        ? state.memberships.filter((entry) => entry.status === 'active')
        : [...state.memberships];
    },

    activateMembership: (groupId, slug, joinedPinId) => mutate((state) => {
      const record = state.memberships.find((entry) => entry.groupId === groupId && entry.slug === slug);
      if (!record) return;
      record.status = 'active';
      record.activatedAt = Date.now();
      record.joinedPinId = joinedPinId ?? record.joinedPinId;
      record.leftAt = null;
      record.leftCause = null;
      record.leftReason = null;
    }),

    updateMembershipCursor: (groupId, slug, lastProcessedIndex) => mutate((state) => {
      const record = state.memberships.find((entry) => entry.groupId === groupId && entry.slug === slug);
      if (record) record.lastProcessedIndex = lastProcessedIndex;
    }),

    leaveMembership: (groupId, slug, cause, reason) => mutate((state) => {
      const record = state.memberships.find((entry) => entry.groupId === groupId && entry.slug === slug);
      if (!record || record.status === 'left') return;
      record.status = 'left';
      record.leftAt = Date.now();
      record.leftCause = cause;
      record.leftReason = reason ?? null;
    }),

    kvGet: async (key) => {
      const state = await readState();
      return state.kv[key];
    },
    kvSet: (key, value) => mutate((state) => {
      state.kv[key] = value;
    }),
    kvDelete: (key) => mutate((state) => {
      delete state.kv[key];
    }),
  };
}
