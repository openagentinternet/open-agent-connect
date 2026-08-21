/**
 * Group Task domain types — the OAC port of the IDBots Group Task feature
 * ("one on-chain SimpleGroupChat room = one task"). Tasks are chaired by a
 * local Bot (twin preferred); local workers and optional remote OpenTeam
 * members coordinate through tagged AES group messages; the daemon engine
 * drives the lifecycle; the owner accepts/cancels from the UI.
 *
 * Timestamps are epoch milliseconds unless a field name says otherwise.
 */

export type GroupTaskStatus = 'planning' | 'executing' | 'review' | 'done' | 'cancelled';
export type GroupTaskMemberRole = 'chair' | 'worker';
export type GroupTaskMemberStatus = 'assigned' | 'working' | 'standby' | 'done' | 'unreachable';

/**
 * Deliverable ledger status. 'pending' = recorded, awaiting verification;
 * 'delivered' = pin verified on-chain; 'accepted'/'rejected' = the owner's
 * final verdict at acceptance time (never overwritten by verification).
 */
export type GroupTaskDeliverableStatus = 'pending' | 'delivered' | 'accepted' | 'rejected';

/** Who moved a task between statuses (chair bot, human owner, or the host). */
export type GroupTaskStatusEventActorKind = 'chair' | 'owner' | 'system';

export interface GroupTaskStatusEventActor {
  kind: GroupTaskStatusEventActorKind;
  globalMetaId?: string | null;
  name?: string | null;
}

export interface GroupTaskRecord {
  id: number;
  groupId: string | null;
  title: string;
  goal: string;
  acceptanceCriteria: string | null;
  status: GroupTaskStatus;
  /** Profile slug of the chair Bot (the on-chain group creator). */
  chairSlug: string;
  chairGlobalMetaId: string | null;
  createdBy: string;
  /**
   * Engine cursor — the chain msg index of the LAST MESSAGE the engine
   * successfully processed. Advances only on success; -1 = nothing processed.
   */
  lastProcessedIndex: number;
  /** Epoch ms of the engine's last drive of this task (stall heartbeat). */
  lastDrivenAt: number | null;
  createPinId: string | null;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  /** Owner acceptance rating (1-5 stars); null for unrated tasks. */
  rating: number | null;
  ratingComment: string | null;
  ratedAt: number | null;
  /** Local-only display name overriding the on-chain title. */
  displayName: string | null;
  /** Local-only pinned flag; pinned tasks sort first in the list. */
  pinned: boolean;
  /** Local-only archive marker (epoch ms; null = active). */
  archivedAt: number | null;
}

export interface GroupTaskMember {
  id: number;
  taskId: number;
  /** Local profile slug; null for remote OpenTeam members. */
  slug: string | null;
  globalMetaId: string | null;
  role: GroupTaskMemberRole;
  joinedPinId: string | null;
  createdAt: number;
  /** Name snapshot (required for remote members without a local profile). */
  displayName: string | null;
  /** Set when the member was kicked; active members have null. */
  removedAt: number | null;
  /** On-chain /protocols/simplegroupremoveuser pin of the removal. */
  removePinId: string | null;
  status: GroupTaskMemberStatus;
  statusChangedAt: number | null;
}

export interface GroupTaskDeliverable {
  id: number;
  taskId: number;
  msgPinId: string | null;
  authorGlobalMetaId: string | null;
  kind: string | null;
  uri: string | null;
  status: GroupTaskDeliverableStatus;
  createdAt: number;
  /** JSON verification report (sources + outcomes). */
  verification: string | null;
  /**
   * On-chain confirmation of the deliverable's pin — orthogonal to `status`
   * (a pin can be confirmed while still pending owner acceptance).
   */
  confirmation: 'unconfirmed' | 'confirmed';
}

export interface GroupTaskTransition {
  id: number;
  taskId: number;
  fromStatus: GroupTaskStatus | null;
  toStatus: GroupTaskStatus;
  actor: string | null;
  reason: string | null;
  createdAt: number;
}

export interface GroupTaskStatusEvent {
  id: number;
  taskId: number;
  fromStatus: GroupTaskStatus;
  toStatus: GroupTaskStatus;
  actorKind: GroupTaskStatusEventActorKind;
  actorGlobalMetaId: string | null;
  actorName: string | null;
  createdAt: number;
}

export type GroupTaskCheckpointStatus = 'open' | 'resolved' | 'cancelled';

/**
 * One mid-task human-in-the-loop pause point. The chair opens it with a
 * `[CHECKPOINT: <topic>]` group message and resolves it with
 * `[CHECKPOINT_RESOLVED: <decision>]`; at most one is 'open' per task. The
 * task status machine is NOT extended — a checkpoint pauses responder gating.
 */
export interface GroupTaskCheckpoint {
  id: number;
  taskId: number;
  topic: string | null;
  openedMsgPinId: string | null;
  status: GroupTaskCheckpointStatus;
  resolution: string | null;
  resolvedMsgPinId: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

export type GroupTaskIntegrityEventType = 'correction' | 'honest_report';

export interface GroupTaskIntegrityEvent {
  id: number;
  taskId: number;
  msgPinId: string | null;
  authorGlobalMetaId: string | null;
  eventType: GroupTaskIntegrityEventType;
  detail: string | null;
  createdAt: number;
}

/** One recorded chair plan-change resolution ([PLAN_CHANGE: ...] line). */
export interface GroupTaskPlanChange {
  id: number;
  taskId: number;
  msgPinId: string | null;
  authorGlobalMetaId: string | null;
  summary: string;
  createdAt: number;
}

export interface GroupTaskAcceptanceSummaryDeliverable {
  kind: string | null;
  uri: string | null;
  status: GroupTaskDeliverableStatus;
  confirmation: 'unconfirmed' | 'confirmed';
  authorName: string | null;
  /** Body preview for text deliverables (no uri). */
  preview?: string | null;
}

export interface GroupTaskAcceptanceSummaryMember {
  name: string | null;
  role: GroupTaskMemberRole;
  workStatus: string;
}

/**
 * Host-generated, deterministic acceptance summary. Produced at review entry
 * and finalized on close — the single source of truth for the group's review
 * message and the owner report. version increments per review re-entry.
 */
export interface GroupTaskAcceptanceSummary {
  id: number;
  taskId: number;
  version: number;
  goal: string;
  acceptanceCriteria: string | null;
  deliverables: GroupTaskAcceptanceSummaryDeliverable[];
  members: GroupTaskAcceptanceSummaryMember[];
  /** Plan-change disclosures snapshotted at review entry (may be empty). */
  planChanges: string[];
  guidance: string;
  /** The chair's one-line conclusion; null until captured at review entry. */
  conclusion: string | null;
  /** Terminal outcome, null until the task closes. */
  outcome: GroupTaskStatus | null;
  rating: number | null;
  ratingComment: string | null;
  generatedBy: string;
  generatedAt: number;
  /** Pin of the group message that published this summary. */
  publishedGroupPinId: string | null;
}

/** One decrypted transcript row of a task group (chain history is truth). */
export interface GroupTaskMessage {
  /** Chain message index (per-group monotonic, from the indexer). */
  index: number;
  pinId: string | null;
  txId: string | null;
  senderMetaId: string;
  senderGlobalMetaId: string | null;
  senderName: string | null;
  senderAvatar: string | null;
  /** Decrypted plaintext body. */
  content: string;
  contentType: string | null;
  /** Epoch seconds of the chain timestamp (indexer convention). */
  chainTimestamp: number | null;
  replyPin: string | null;
  /** Mention entries as posted (GlobalMetaIDs / names). */
  mention: string[];
  /**
   * Attribution: true when the chain-signature identity could not be resolved
   * OR is neither a task member nor the owner. Suspect messages must never be
   * attributed by senderName, trigger replies, or contribute deliverables.
   */
  senderSuspect: boolean;
}

export type GroupTaskMemberWorkStatus = 'working' | 'error' | 'timeout' | 'idle' | 'unknown';

export type GroupTaskMemberInviteStatus =
  | 'none'
  | 'invite_pending'
  | 'invite_accepted'
  | 'invite_declined'
  | 'invite_expired'
  | 'joined';

export interface GroupTaskMemberSummary extends GroupTaskMember {
  avatar?: string | null;
  /** Epoch seconds of the member's last chain speech. */
  lastSpeakAt: number | null;
  /** Epoch ms of the member's last [WORKING] tag message. */
  lastWorkingAt: number | null;
  workStatus: GroupTaskMemberWorkStatus;
  /** OpenTeam invite state for remote members ('none' for local members). */
  inviteStatus: GroupTaskMemberInviteStatus;
}

export interface GroupTaskMemberPreview {
  name: string;
  avatar: string | null;
  role: GroupTaskMemberRole;
  slug: string | null;
  remote: boolean;
}

export interface GroupTaskSummary extends GroupTaskRecord {
  memberCount: number;
  chairName: string | null;
  memberNames: string[];
  members: GroupTaskMemberPreview[];
  /** True when any active member is a remote OpenTeam member. */
  openTeam: boolean;
}

export interface GroupTaskDetail extends GroupTaskRecord {
  members: GroupTaskMemberSummary[];
  deliverables: GroupTaskDeliverable[];
  transitions: GroupTaskTransition[];
  integrityEvents: GroupTaskIntegrityEvent[];
  messages: GroupTaskMessage[];
  /** True when a non-terminal task has had no engine drive recently. */
  stall: boolean;
  stallAfterMinutes: number;
  statusEvents: GroupTaskStatusEvent[];
  checkpoints: GroupTaskCheckpoint[];
  acceptanceSummary: GroupTaskAcceptanceSummary | null;
  /** Tag-free body of the chair's [CHECKPOINT] message that is open now. */
  openCheckpointSummary: string | null;
  /** True when any active member is a remote OpenTeam member. */
  openTeam: boolean;
}

export type GroupTaskListTab = 'active' | 'done' | 'cancelled' | 'all';

export interface CreateGroupTaskInput {
  title: string;
  goal: string;
  acceptanceCriteria?: string | null;
  /** Worker profile slugs; the chair is added automatically. */
  workerSlugs?: string[];
  /** Explicit chair slug; defaults to the machine twin, else fails. */
  chairSlug?: string;
  createdBy?: 'user' | 'twinbot';
}

export const GROUP_TASK_TERMINAL_STATUSES: ReadonlySet<GroupTaskStatus> = new Set(['done', 'cancelled']);

/**
 * Legal transitions: planning→executing→review→done, →cancelled from any
 * non-terminal state, and review→executing as the rework hatch. The owner's
 * accept/close action may shortcut to 'done' from any non-terminal state.
 */
export const GROUP_TASK_LEGAL_TRANSITIONS: Record<GroupTaskStatus, GroupTaskStatus[]> = {
  planning: ['executing', 'done', 'cancelled'],
  executing: ['review', 'done', 'cancelled'],
  review: ['done', 'executing', 'cancelled'],
  done: [],
  cancelled: [],
};

export function isGroupTaskStatus(value: unknown): value is GroupTaskStatus {
  return value === 'planning' || value === 'executing' || value === 'review'
    || value === 'done' || value === 'cancelled';
}

export function isGroupTaskMemberStatus(value: unknown): value is GroupTaskMemberStatus {
  return value === 'assigned' || value === 'working' || value === 'standby'
    || value === 'done' || value === 'unreachable';
}

export function filterGroupTasksByTab<T extends { status: GroupTaskStatus }>(
  tasks: T[],
  tab: GroupTaskListTab,
): T[] {
  if (tab === 'all') return tasks;
  if (tab === 'done') return tasks.filter((task) => task.status === 'done');
  if (tab === 'cancelled') return tasks.filter((task) => task.status === 'cancelled');
  return tasks.filter((task) => !GROUP_TASK_TERMINAL_STATUSES.has(task.status));
}
