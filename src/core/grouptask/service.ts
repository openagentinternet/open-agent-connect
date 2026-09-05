/**
 * Group Task service: business layer over the grouptask store + transport.
 * One on-chain group = one task; a local Bot chairs every task (the machine
 * twin by default). All seams (profiles, signers, owner identity, indexer
 * fetch) are injected through GroupTaskServiceContext so the daemon wires
 * production implementations and tests wire fakes without chain writes.
 */

import { resolveMetabotPaths } from '../state/paths';
import type { Signer } from '../signing/signer';
import { createGroupTaskStore, type GroupTaskStore } from './store';
import { createGroupTaskRelayStore, type GroupTaskRelayStore } from './relayStore';
import { createOpenTeamStore, type OpenTeamStore } from './openteamStore';
import { createStaffingStore, type StaffingStore } from './staffingStore';
import { recordKickImpression, recordTaskCloseImpressions } from './impressions';
import { buildOpenTeamKickMessage } from './openteam';
import {
  createGroupOnChain,
  fetchGroupMembers,
  joinGroupOnChain,
  removeGroupMemberOnChain,
  sendGroupMessageOnChain,
  waitForGroupIndexed,
  type GroupTaskTransportOptions,
} from './transport';
import { syncGroupMessages } from './backfill';
import {
  GROUP_TASK_TERMINAL_STATUSES,
  filterGroupTasksByTab,
  type CreateGroupTaskInput,
  type GroupTaskDetail,
  type GroupTaskListTab,
  type GroupTaskMember,
  type GroupTaskMemberStatus,
  type GroupTaskMemberSummary,
  type GroupTaskMemberWorkStatus,
  type GroupTaskMessage,
  type GroupTaskRecord,
  type GroupTaskRelayKind,
  type GroupTaskRelayRow,
  type GroupTaskStatusEventActor,
  type GroupTaskSummary,
  type GroupTaskSuperviseAction,
} from './types';

// ---------------------------------------------------------------------------
// Context seams
// ---------------------------------------------------------------------------

export interface GroupTaskProfileRef {
  slug: string;
  homeDir: string;
  name: string;
  globalMetaId: string | null;
  /** Legacy MetaID (simplegroupremoveuser body wants this form). */
  metaId: string | null;
  botType: 'twin' | 'worker' | null;
  avatar: string | null;
}

export interface GroupTaskOwnerRef {
  globalMetaId: string;
  metaId: string | null;
  name: string;
  signer: Signer;
}

export interface GroupTaskServiceContext {
  listProfiles(): Promise<GroupTaskProfileRef[]>;
  getProfile(slug: string): Promise<GroupTaskProfileRef | null>;
  signerForSlug(slug: string): Promise<Signer>;
  /** Null when no owner identity exists on this machine. */
  ownerIdentity(): Promise<GroupTaskOwnerRef | null>;
  /** Store override seam (tests); default resolves the profile runtime root. */
  storeForProfile?(profile: GroupTaskProfileRef): GroupTaskStore;
  /** OpenTeam store seam (tests); default resolves the profile runtime root. */
  openteamStoreForProfile?(profile: GroupTaskProfileRef): OpenTeamStore;
  /** Staffing store seam (tests); default resolves the profile runtime root. */
  staffingStoreForProfile?(profile: GroupTaskProfileRef): StaffingStore;
  /** Relay store seam (tests); default resolves the profile runtime root. */
  relayStoreForProfile?(profile: GroupTaskProfileRef): GroupTaskRelayStore;
  /**
   * Send an ECDH private message (/protocols/simplemsg) from a local profile.
   * Wired by the daemon (peer chat pubkey resolver + profile signer); absent
   * in contexts without private-chat access — OpenTeam verbs then fail with
   * `openteam_unavailable`.
   */
  sendPrivateMessage?(input: {
    fromSlug: string;
    toGlobalMetaId: string;
    content: string;
  }): Promise<{ pinId: string | null }>;
  transport?: GroupTaskTransportOptions;
  log?(message: string): void;
}

export class GroupTaskServiceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'GroupTaskServiceError';
  }
}

function storeFor(ctx: GroupTaskServiceContext, profile: GroupTaskProfileRef): GroupTaskStore {
  if (ctx.storeForProfile) return ctx.storeForProfile(profile);
  return createGroupTaskStore(resolveMetabotPaths(profile.homeDir));
}

/** OpenTeam handshake store for a profile (exported for the engine). */
export function openteamStoreFor(ctx: GroupTaskServiceContext, profile: GroupTaskProfileRef): OpenTeamStore {
  if (ctx.openteamStoreForProfile) return ctx.openteamStoreForProfile(profile);
  return createOpenTeamStore(resolveMetabotPaths(profile.homeDir));
}

const staffingStoreCache = new Map<string, StaffingStore>();

/** Staffing proposal store for a profile (exported for the staffing service).
 *  Memoized per store file: the CAS claim/release only serializes within one
 *  instance's in-process queue, so every request must share the instance. */
export function staffingStoreFor(ctx: GroupTaskServiceContext, profile: GroupTaskProfileRef): StaffingStore {
  if (ctx.staffingStoreForProfile) return ctx.staffingStoreForProfile(profile);
  const paths = resolveMetabotPaths(profile.homeDir);
  const key = paths.runtimeRoot;
  let store = staffingStoreCache.get(key);
  if (!store) {
    store = createStaffingStore(paths);
    staffingStoreCache.set(key, store);
  }
  return store;
}

function logOf(ctx: GroupTaskServiceContext): (message: string) => void {
  return ctx.log ?? (() => undefined);
}

/** Resolve a profile by slug or fail (exported for the staffing service). */
export async function requireProfile(ctx: GroupTaskServiceContext, slug: string): Promise<GroupTaskProfileRef> {
  const profile = await ctx.getProfile(slug.trim());
  if (!profile) {
    throw new GroupTaskServiceError('profile_not_found', `MetaBot profile not found: ${slug}`);
  }
  return profile;
}

async function requireTask(store: GroupTaskStore, taskId: number): Promise<GroupTaskRecord> {
  const task = await store.getTaskById(taskId);
  if (!task) {
    throw new GroupTaskServiceError('task_not_found', `Group task ${taskId} not found`);
  }
  return task;
}

/** The task exists, is not terminal, and has its on-chain group id. */
async function requireRunnableTask(store: GroupTaskStore, taskId: number): Promise<GroupTaskRecord> {
  const task = await requireTask(store, taskId);
  if (GROUP_TASK_TERMINAL_STATUSES.has(task.status)) {
    throw new GroupTaskServiceError(
      'task_terminal',
      `Group task ${taskId} is ${task.status}; no further messages or members allowed`,
    );
  }
  if (!task.groupId) {
    throw new GroupTaskServiceError('group_missing', `Group task ${taskId} has no on-chain group id`);
  }
  return task;
}

// ---------------------------------------------------------------------------
// Pure helpers (ported IDBots semantics; exported for unit tests)
// ---------------------------------------------------------------------------

/** Minutes of engine inactivity before a non-terminal task reads as stalled. */
export const GROUP_TASK_STALL_AFTER_MINUTES = 30;
/** Minutes a [WORKING] tag stays "working" after its last occurrence. */
export const GROUP_TASK_WORKING_WINDOW_MINUTES = 20;
/** Minutes a working/assigned member's [WORKING] signal may be stale before 'timeout'. */
export const GROUP_TASK_TIMEOUT_WINDOW_MINUTES = 20;

export function computeGroupTaskStall(
  task: Pick<GroupTaskRecord, 'status' | 'lastDrivenAt' | 'updatedAt'>,
  nowMs: number = Date.now(),
): { stall: boolean; stallAfterMinutes: number } {
  if (GROUP_TASK_TERMINAL_STATUSES.has(task.status)) {
    return { stall: false, stallAfterMinutes: GROUP_TASK_STALL_AFTER_MINUTES };
  }
  const lastActivityMs = task.lastDrivenAt ?? task.updatedAt ?? null;
  const stall = lastActivityMs != null
    && nowMs - lastActivityMs > GROUP_TASK_STALL_AFTER_MINUTES * 60_000;
  return { stall, stallAfterMinutes: GROUP_TASK_STALL_AFTER_MINUTES };
}

/**
 * Pure member work-status derivation (IDBots P1-4/R6 rules, minus the
 * canonical-attempt source which OAC does not track in M1):
 *  1. fresh [WORKING] tag => working;
 *  2. working/assigned member with a stale [WORKING] signal => timeout;
 *  3. member still self-reported working => working;
 *  4. any speech => idle;
 *  5. otherwise unknown.
 */
export function computeGroupTaskMemberWorkStatus(input: {
  lastSpeakAt: number | null; // epoch seconds
  lastWorkingAt: number | null; // epoch ms
  memberStatus?: GroupTaskMemberStatus;
  nowMs?: number;
}): GroupTaskMemberWorkStatus {
  const nowMs = input.nowMs ?? Date.now();
  const lastSpeakAtMs = input.lastSpeakAt != null ? input.lastSpeakAt * 1000 : null;
  const lastWorkingAtMs = input.lastWorkingAt;
  const workingWindowMs = GROUP_TASK_WORKING_WINDOW_MINUTES * 60_000;
  const timeoutWindowMs = GROUP_TASK_TIMEOUT_WINDOW_MINUTES * 60_000;
  if (lastWorkingAtMs != null && nowMs - lastWorkingAtMs <= workingWindowMs) {
    return 'working';
  }
  if (
    (input.memberStatus === 'working' || input.memberStatus === 'assigned')
    && lastWorkingAtMs != null
    && nowMs - lastWorkingAtMs > timeoutWindowMs
  ) {
    return 'timeout';
  }
  if (input.memberStatus === 'working') return 'working';
  if (lastSpeakAtMs != null) return 'idle';
  return 'unknown';
}

/**
 * Kickoff message posted by the chair right after group creation. The member
 * roster line must NOT carry `@` prefixes — the engine treats an explicit
 * `@Name` as a work assignment (IDBots P0-3).
 */
export function buildKickoffMessage(input: {
  title: string;
  goal: string;
  acceptanceCriteria?: string | null;
  chairName: string;
  memberNames: string[];
}): string {
  return [
    `[GROUP TASK] ${input.title}`,
    `Goal: ${input.goal}`,
    `Acceptance: ${input.acceptanceCriteria?.trim() || '(none specified)'}`,
    `Chair: ${input.chairName}`,
    input.memberNames.length > 0
      ? `Members: ${input.memberNames.join(', ')}`
      : 'Members: (chair only)',
  ].join('\n');
}

const CHECKPOINT_ANY_TAG = /\[CHECKPOINT(?:_[A-Z]+)?(?::[^\]]*)?\]/gi;

/** Tag-free body of a chair [CHECKPOINT] message (what the owner must decide). */
export function extractCheckpointDecisionSummary(content: string | null | undefined): string | null {
  const text = (content ?? '')
    .replace(CHECKPOINT_ANY_TAG, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0 ? text : null;
}

// ---------------------------------------------------------------------------
// kv guards
// ---------------------------------------------------------------------------

const OWNER_JOINED_KV_PREFIX = 'group_task_owner_joined:';
export const GROUP_TASK_REWORK_AT_KV_PREFIX = 'group_task_rework_at:';
export const GROUP_TASK_OWNER_REPORTED_KV_PREFIX = 'group_task_owner_reported:';
export const GROUP_TASK_REVIEW_REASSERT_KV_PREFIX = 'group_task_review_reassert:';

/** Clear every review-delivery guard on a rework hatch (IDBots parity). */
export async function clearGroupTaskReviewDeliveryGuards(store: GroupTaskStore, taskId: number): Promise<void> {
  await store.kvDelete(`${GROUP_TASK_OWNER_REPORTED_KV_PREFIX}${taskId}`);
  await store.kvDelete(`${GROUP_TASK_REVIEW_REASSERT_KV_PREFIX}${taskId}`);
}

/**
 * Owner join guard: joining costs gas, so the owner's on-chain join is
 * kv-recorded per group. Returns true when a join pin was actually sent.
 */
export async function ensureOwnerJoinedGroup(
  ctx: GroupTaskServiceContext,
  store: GroupTaskStore,
  groupId: string,
): Promise<boolean> {
  const key = `${OWNER_JOINED_KV_PREFIX}${groupId}`;
  if ((await store.kvGet(key)) === '1') return false;
  const owner = await ctx.ownerIdentity();
  if (!owner) {
    throw new GroupTaskServiceError('owner_missing', 'No local owner identity; create one with `metabot user ensure` first');
  }
  await joinGroupOnChain(owner.signer, groupId);
  await store.kvSet(key, '1');
  return true;
}

// ---------------------------------------------------------------------------
// Chair resolution
// ---------------------------------------------------------------------------

/** Twin preferred; an explicit chair slug wins; else fail with a clear code. */
export async function resolveChairProfile(
  ctx: GroupTaskServiceContext,
  preferredSlug?: string,
): Promise<GroupTaskProfileRef> {
  if (preferredSlug?.trim()) {
    return requireProfile(ctx, preferredSlug);
  }
  const profiles = await ctx.listProfiles();
  const twin = profiles.find((profile) => profile.botType === 'twin');
  if (twin) return twin;
  throw new GroupTaskServiceError(
    'chair_unresolved',
    'No twin Bot found and no chair slug given; designate a twin or pass an explicit chair',
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Create a group task end to end: resolve chair -> create the on-chain group
 * -> wait for the indexer -> persist task + member rows -> join each worker
 * Bot and the owner -> chair posts the kickoff message. Indexer timeouts and
 * individual join failures degrade with warnings, never fail the creation
 * (the group pin is already on-chain; backfill reconciles).
 */
export async function createGroupTask(
  ctx: GroupTaskServiceContext,
  input: CreateGroupTaskInput,
): Promise<{ chairSlug: string; task: GroupTaskDetail }> {
  const log = logOf(ctx);
  const title = input.title?.trim();
  const goal = input.goal?.trim();
  if (!title) throw new GroupTaskServiceError('title_required', 'title is required');
  if (!goal) throw new GroupTaskServiceError('goal_required', 'goal is required');

  const chair = await resolveChairProfile(ctx, input.chairSlug);
  const store = storeFor(ctx, chair);
  const chairName = chair.name.trim() || chair.slug;

  const workerSlugs = [...new Set(
    (input.workerSlugs ?? [])
      .map((slug) => slug.trim())
      .filter((slug) => slug && slug !== chair.slug),
  )];

  const chairSigner = await ctx.signerForSlug(chair.slug);
  const { groupId, pinId } = await createGroupOnChain(chairSigner, {
    groupName: title,
    groupNote: goal,
  });

  const indexed = await waitForGroupIndexed(groupId, ctx.transport);
  if (!indexed) {
    log(`[GroupTask] Group ${groupId.slice(0, 12)}… not indexed within timeout; persisting anyway`);
  }

  const task = await store.createTask({
    groupId,
    title,
    goal,
    acceptanceCriteria: input.acceptanceCriteria ?? null,
    chairSlug: chair.slug,
    chairGlobalMetaId: chair.globalMetaId,
    createdBy: input.createdBy ?? 'user',
    createPinId: pinId,
    sourceSessionId: input.sourceSessionId ?? null,
  });

  // Chair is implicitly a member via the create pin.
  await store.addMember({
    taskId: task.id,
    slug: chair.slug,
    globalMetaId: chair.globalMetaId,
    role: 'chair',
    joinedPinId: pinId,
    displayName: chairName,
  });

  const memberNames: string[] = [];
  for (const workerSlug of workerSlugs) {
    const worker = await ctx.getProfile(workerSlug);
    if (!worker) {
      log(`[GroupTask] Member profile ${workerSlug} not found; skipped`);
      continue;
    }
    const workerName = worker.name.trim() || worker.slug;
    await store.addMember({
      taskId: task.id,
      slug: worker.slug,
      globalMetaId: worker.globalMetaId,
      role: 'worker',
      displayName: workerName,
    });
    memberNames.push(workerName);
    try {
      const workerSigner = await ctx.signerForSlug(worker.slug);
      const { pinId: joinPinId } = await joinGroupOnChain(workerSigner, groupId, {
        referrer: chair.metaId ?? '',
      });
      await store.updateMemberJoinedPinId(task.id, worker.slug, joinPinId);
    } catch (error) {
      // A member join failure must not fail the whole creation.
      log(
        `[GroupTask] joinGroup failed for member ${worker.slug} in task ${task.id}: `
        + `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // The indexer diverts messages from non-members, so the human owner joins
  // every task group to observe/post. Degradation-tolerant like member joins.
  try {
    await ensureOwnerJoinedGroup(ctx, store, groupId);
  } catch (error) {
    log(
      `[GroupTask] Owner identity join failed for task ${task.id}: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    await sendGroupMessageOnChain(chairSigner, groupId, {
      content: buildKickoffMessage({
        title,
        goal,
        acceptanceCriteria: input.acceptanceCriteria,
        chairName,
        memberNames,
      }),
      nickName: chairName,
    });
  } catch (error) {
    log(
      `[GroupTask] Kickoff message failed for task ${task.id}: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  await emitGroupTaskRelay(ctx, chair, task, 'created',
    `Task created and the on-chain group is open. The engine posts the kickoff and runs planning next.`);

  return { chairSlug: chair.slug, task: await getGroupTaskDetail(ctx, chair.slug, task.id) };
}

// ---------------------------------------------------------------------------
// List / detail
// ---------------------------------------------------------------------------

function memberDisplayName(member: GroupTaskMember, profileName?: string | null): string {
  return (profileName ?? member.displayName ?? member.slug ?? member.globalMetaId ?? '').trim();
}

export interface ListGroupTasksOptions {
  tab?: GroupTaskListTab;
  includeArchived?: boolean;
}

export interface GroupTaskSummaryWithChair extends GroupTaskSummary {
  /** The chair profile slug the task record lives under (task addressing). */
  chairSlug: string;
}

/** Aggregate task summaries across every local profile's grouptask store. */
export async function listGroupTaskSummaries(
  ctx: GroupTaskServiceContext,
  options?: ListGroupTasksOptions,
): Promise<GroupTaskSummaryWithChair[]> {
  const profiles = await ctx.listProfiles();
  const profileBySlug = new Map(profiles.map((profile) => [profile.slug, profile]));
  const summaries: GroupTaskSummaryWithChair[] = [];

  for (const profile of profiles) {
    const store = storeFor(ctx, profile);
    let tasks: GroupTaskRecord[];
    try {
      tasks = await store.listTasks({ includeArchived: options?.includeArchived ?? false });
    } catch {
      continue;
    }
    // Only the tasks this profile CHAIRS live in its store as canonical rows.
    const chaired = tasks.filter((task) => task.chairSlug === profile.slug);
    for (const task of chaired) {
      const members = await store.listMembers(task.id);
      const previews = members.map((member) => {
        const memberProfile = member.slug ? profileBySlug.get(member.slug) : undefined;
        return {
          name: memberDisplayName(member, memberProfile?.name),
          avatar: memberProfile?.avatar ?? null,
          role: member.role,
          slug: member.slug,
          remote: member.slug == null,
        };
      });
      summaries.push({
        ...task,
        chairSlug: profile.slug,
        memberCount: members.length,
        chairName: previews.find((preview) => preview.role === 'chair')?.name ?? null,
        memberNames: previews.map((preview) => preview.name).filter(Boolean),
        members: previews,
        openTeam: members.some((member) => member.slug == null),
      });
    }
  }

  const filtered = filterGroupTasksByTab(summaries, options?.tab ?? 'all');
  return filtered.sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
  });
}

/** Trusted identity set for suspect marking: active members + the owner. */
async function buildTrustedGmidSet(
  ctx: GroupTaskServiceContext,
  members: GroupTaskMember[],
): Promise<Set<string>> {
  const trusted = new Set<string>();
  for (const member of members) {
    const gmid = (member.globalMetaId ?? '').trim().toLowerCase();
    if (gmid) trusted.add(gmid);
  }
  try {
    const owner = await ctx.ownerIdentity();
    if (owner?.globalMetaId) trusted.add(owner.globalMetaId.trim().toLowerCase());
  } catch {
    // Owner identity is optional for reads.
  }
  return trusted;
}

/** Best-effort transcript sync (chain history is truth; failures degrade). */
export async function syncGroupTaskMessages(
  ctx: GroupTaskServiceContext,
  store: GroupTaskStore,
  task: GroupTaskRecord,
): Promise<void> {
  if (!task.groupId) return;
  try {
    const members = await store.listMembers(task.id, { includeRemoved: true });
    await syncGroupMessages({
      store,
      groupId: task.groupId,
      trustedGlobalMetaIds: await buildTrustedGmidSet(ctx, members.filter((m) => m.removedAt == null)),
      transport: ctx.transport,
    });
  } catch (error) {
    logOf(ctx)(
      `[GroupTask] Message sync failed for task ${task.id}: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getGroupTaskDetail(
  ctx: GroupTaskServiceContext,
  chairSlug: string,
  taskId: number,
  opts?: { view?: 'summary' | 'full'; sync?: boolean },
): Promise<GroupTaskDetail> {
  const chair = await requireProfile(ctx, chairSlug);
  const store = storeFor(ctx, chair);
  const task = await requireTask(store, taskId);
  if (opts?.sync !== false) {
    await syncGroupTaskMessages(ctx, store, task);
  }

  const view = opts?.view ?? 'full';
  const members = await store.listMembers(taskId);
  const profiles = await ctx.listProfiles();
  const profileBySlug = new Map(profiles.map((profile) => [profile.slug, profile]));

  const gmids = members.map((member) => member.globalMetaId);
  const speakMap = task.groupId
    ? await store.getMembersLastSpeakAt(task.groupId, gmids)
    : new Map<string, number>();
  const workingMap = task.groupId
    ? await store.getMembersWorkingAt(task.groupId, gmids)
    : new Map<string, number>();

  const memberSummaries: GroupTaskMemberSummary[] = members.map((member) => {
    const gmid = (member.globalMetaId ?? '').trim().toLowerCase();
    const lastSpeakAt = gmid ? (speakMap.get(gmid) ?? null) : null;
    const lastWorkingAtSec = gmid ? (workingMap.get(gmid) ?? null) : null;
    const lastWorkingAt = lastWorkingAtSec != null ? lastWorkingAtSec * 1000 : null;
    const memberProfile = member.slug ? profileBySlug.get(member.slug) : undefined;
    return {
      ...member,
      displayName: memberDisplayName(member, memberProfile?.name) || member.displayName,
      avatar: memberProfile?.avatar ?? null,
      lastSpeakAt,
      lastWorkingAt,
      workStatus: computeGroupTaskMemberWorkStatus({
        lastSpeakAt,
        lastWorkingAt,
        memberStatus: member.status,
      }),
      inviteStatus: member.slug != null
        ? 'none'
        : (member.joinedPinId ? 'joined' : 'invite_pending'),
    };
  });

  const checkpoints = await store.listCheckpoints(taskId);
  const openCheckpoint = checkpoints.find((checkpoint) => checkpoint.status === 'open') ?? null;
  let openCheckpointSummary: string | null = null;
  if (openCheckpoint?.openedMsgPinId && task.groupId) {
    const opened = await store.getMessageByPinId(task.groupId, openCheckpoint.openedMsgPinId);
    openCheckpointSummary = opened ? extractCheckpointDecisionSummary(opened.content) : null;
  }

  const stall = computeGroupTaskStall(task);
  const messagesPage = task.groupId
    ? await store.listMessages(task.groupId, { limit: view === 'full' ? 50 : 5 })
    : { messages: [] as GroupTaskMessage[], total: 0 };

  return {
    ...task,
    members: memberSummaries,
    deliverables: await store.listDeliverables(taskId),
    transitions: await store.listTransitions(taskId),
    integrityEvents: await store.listIntegrityEvents(taskId),
    messages: messagesPage.messages,
    stall: stall.stall,
    stallAfterMinutes: stall.stallAfterMinutes,
    statusEvents: await store.listStatusEvents(taskId),
    checkpoints,
    supervisorSignals: await store.listSupervisorSignals(taskId),
    acceptanceSummary: await store.getLatestAcceptanceSummary(taskId),
    openCheckpointSummary,
    openTeam: members.some((member) => member.slug == null),
  };
}

export async function listGroupTaskMessages(
  ctx: GroupTaskServiceContext,
  chairSlug: string,
  taskId: number,
  opts?: { limit?: number; beforeIndex?: number; sync?: boolean },
): Promise<{ messages: GroupTaskMessage[]; total: number }> {
  const chair = await requireProfile(ctx, chairSlug);
  const store = storeFor(ctx, chair);
  const task = await requireTask(store, taskId);
  if (!task.groupId) return { messages: [], total: 0 };
  if (opts?.sync !== false) {
    await syncGroupTaskMessages(ctx, store, task);
  }
  return store.listMessages(task.groupId, {
    limit: opts?.limit,
    beforeIndex: opts?.beforeIndex,
  });
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export interface PostGroupTaskMessageInput {
  /** Local member Bot to speak as; mutually exclusive with asOwner. */
  asSlug?: string;
  /** Post as the human owner identity. */
  asOwner?: boolean;
  content: string;
  replyPin?: string;
  mention?: string[];
}

export async function postGroupTaskMessage(
  ctx: GroupTaskServiceContext,
  chairSlug: string,
  taskId: number,
  input: PostGroupTaskMessageInput,
): Promise<{ pinId: string }> {
  const chair = await requireProfile(ctx, chairSlug);
  const store = storeFor(ctx, chair);
  const task = await requireRunnableTask(store, taskId);
  const content = input.content?.trim();
  if (!content) throw new GroupTaskServiceError('content_required', 'content is required');

  if (input.asOwner) {
    const owner = await ctx.ownerIdentity();
    if (!owner) {
      throw new GroupTaskServiceError('owner_missing', 'No local owner identity; create one with `metabot user ensure` first');
    }
    await ensureOwnerJoinedGroup(ctx, store, task.groupId!);
    return sendGroupMessageOnChain(owner.signer, task.groupId!, {
      content,
      nickName: owner.name,
      replyPin: input.replyPin,
      mention: input.mention,
    });
  }

  const senderSlug = input.asSlug?.trim() || chairSlug;
  const members = await store.listMembers(taskId);
  const member = members.find((entry) => entry.slug === senderSlug);
  if (!member) {
    throw new GroupTaskServiceError(
      'not_a_member',
      `Bot ${senderSlug} is not a member of group task ${taskId}`,
    );
  }
  const senderProfile = await requireProfile(ctx, senderSlug);
  const signer = await ctx.signerForSlug(senderSlug);
  return sendGroupMessageOnChain(signer, task.groupId!, {
    content,
    nickName: senderProfile.name.trim() || senderSlug,
    replyPin: input.replyPin,
    mention: input.mention,
  });
}

// ---------------------------------------------------------------------------
// Lifecycle: close / reopen / rework
// ---------------------------------------------------------------------------

export async function closeGroupTask(
  ctx: GroupTaskServiceContext,
  chairSlug: string,
  taskId: number,
  opts: {
    status: 'done' | 'cancelled';
    reason?: string;
    rating?: number;
    ratingComment?: string;
    actor?: GroupTaskStatusEventActor;
  },
): Promise<GroupTaskDetail> {
  if (opts.status !== 'done' && opts.status !== 'cancelled') {
    throw new GroupTaskServiceError('invalid_outcome', "close status must be 'done' or 'cancelled'");
  }
  const chair = await requireProfile(ctx, chairSlug);
  const store = storeFor(ctx, chair);
  await requireTask(store, taskId);
  const closed = await store.updateTaskStatus(taskId, opts.status, {
    actor: opts.actor ?? { kind: 'owner' },
    reason: opts.reason ?? null,
  });
  // A task closing with a checkpoint still open cancels that checkpoint.
  try {
    await store.closeOpenCheckpoints(taskId, 'cancelled', `task closed as ${opts.status}`);
  } catch (error) {
    logOf(ctx)(
      `[GroupTask] Failed to cancel open checkpoints on close of task ${taskId}: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (closed.status === 'done' && opts.rating != null) {
    await store.updateTaskRating(taskId, opts.rating, opts.ratingComment);
  }
  if (closed.status === 'done') {
    // T2 verdict: owner acceptance marks every non-rejected row accepted.
    await store.updateDeliverablesStatusByTask(taskId, 'pending', 'accepted').catch(() => 0);
    await store.updateDeliverablesStatusByTask(taskId, 'delivered', 'accepted').catch(() => 0);
  }
  try {
    await store.finalizeAcceptanceSummary(taskId, {
      outcome: opts.status,
      rating: opts.rating ?? null,
      ratingComment: opts.ratingComment ?? null,
    });
  } catch {
    // No summary yet (task closed before review) — nothing to finalize.
  }
  // Chair→member impression sedimentation (staffing memory); best-effort.
  try {
    const members = await store.listMembers(taskId);
    await recordTaskCloseImpressions(ctx, chairSlug, closed, members, opts.status);
  } catch (error) {
    logOf(ctx)(
      `[GroupTask] Impression sedimentation failed on close of task ${taskId}: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  await emitGroupTaskRelay(ctx, chair, closed, 'closed',
    `Task closed as ${opts.status}`
    + (opts.rating ? ` · owner rating ${opts.rating}/5` : '')
    + (opts.ratingComment ? ` · "${opts.ratingComment}"` : '')
    + (opts.status === 'done' ? ' — thank the members and wrap up.' : ''));
  return getGroupTaskDetail(ctx, chairSlug, taskId, { sync: false });
}

/**
 * Pull a REVIEW task back to EXECUTING (the owner's "Back to work" action,
 * mirroring the on-chain rework hatch [STATUS:EXECUTING]). Clears every
 * review-delivery guard and stamps the rework instant so a stale in-flight
 * [STATUS:REVIEW] verdict is debounced. Pending deliverables are marked
 * rejected so the acceptance ledger stays traceable.
 */
export async function reopenGroupTask(
  ctx: GroupTaskServiceContext,
  chairSlug: string,
  taskId: number,
  opts?: { actor?: GroupTaskStatusEventActor; reason?: string },
): Promise<GroupTaskDetail> {
  const chair = await requireProfile(ctx, chairSlug);
  const store = storeFor(ctx, chair);
  const task = await requireTask(store, taskId);
  if (task.status !== 'review') {
    throw new GroupTaskServiceError(
      'not_in_review',
      `Group task ${taskId} is ${task.status}; only review tasks can be reopened to executing`,
    );
  }
  await store.updateTaskStatus(taskId, 'executing', {
    actor: opts?.actor ?? { kind: 'owner' },
    reason: opts?.reason ?? null,
  });
  await clearGroupTaskReviewDeliveryGuards(store, taskId);
  await store.kvSet(`${GROUP_TASK_REWORK_AT_KV_PREFIX}${taskId}`, String(Date.now()));
  try {
    await store.updateDeliverablesStatusByTask(taskId, 'pending', 'rejected');
  } catch (error) {
    logOf(ctx)(
      `[GroupTask] Deliverable reject backfill failed for task ${taskId}: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return getGroupTaskDetail(ctx, chairSlug, taskId, { sync: false });
}

// ---------------------------------------------------------------------------
// Source-session relay ("哪里发起哪里结束")
// ---------------------------------------------------------------------------

/** Relay store for a profile (memoization unnecessary: rows are append/drain). */
export function relayStoreFor(ctx: GroupTaskServiceContext, profile: GroupTaskProfileRef): GroupTaskRelayStore {
  if (ctx.relayStoreForProfile) return ctx.relayStoreForProfile(profile);
  return createGroupTaskRelayStore(resolveMetabotPaths(profile.homeDir));
}

/** Engine kv carrying a pending owner nudge (supervise → engine chair turn). */
export const GROUP_TASK_NUDGE_REQUEST_KV_PREFIX = 'group_task_nudge_request:';

/**
 * Record one milestone row for the origin chat. Tasks created outside the
 * staffing flow have no source session and never emit. Best-effort: relay
 * failures must never fail the underlying task operation.
 */
export async function emitGroupTaskRelay(
  ctx: GroupTaskServiceContext,
  chair: GroupTaskProfileRef,
  task: GroupTaskRecord,
  kind: GroupTaskRelayKind,
  text: string,
): Promise<void> {
  const sessionId = task.sourceSessionId?.trim();
  if (!sessionId) return;
  try {
    await relayStoreFor(ctx, chair).add({
      taskId: task.id,
      groupId: task.groupId,
      sessionId,
      kind,
      title: task.title,
      text,
    });
  } catch (error) {
    logOf(ctx)(
      `[GroupTask] Relay emit failed for task ${task.id} (${kind}): `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export interface DrainedGroupTaskRelayRow extends GroupTaskRelayRow {
  chairSlug: string;
}

/**
 * Drain pending relay rows across every profile (or one chair): returns the
 * rows and marks them drained atomically per profile. The DSH host calls this
 * on a timer and injects the rows into their origin sessions.
 */
export async function drainGroupTaskRelay(
  ctx: GroupTaskServiceContext,
  chairSlug?: string,
): Promise<DrainedGroupTaskRelayRow[]> {
  const profiles = chairSlug?.trim()
    ? [await requireProfile(ctx, chairSlug.trim())]
    : await ctx.listProfiles();
  const drained: DrainedGroupTaskRelayRow[] = [];
  for (const profile of profiles) {
    try {
      const rows = await relayStoreFor(ctx, profile).drain();
      for (const row of rows) drained.push({ ...row, chairSlug: profile.slug });
    } catch (error) {
      logOf(ctx)(
        `[GroupTask] Relay drain failed for profile ${profile.slug}: `
        + `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return drained.sort((left, right) => left.createdAt - right.createdAt);
}

// ---------------------------------------------------------------------------
// Owner supervision (IDBots supervise parity): nudge / flag / pause / resume
// ---------------------------------------------------------------------------

export interface SuperviseGroupTaskInput {
  action: GroupTaskSuperviseAction;
  memberSlug?: string;
  globalMetaId?: string;
  note?: string;
}

export interface SuperviseGroupTaskResult {
  task: GroupTaskRecord;
  action: GroupTaskSuperviseAction;
  notice: string | null;
  /** Set for nudge: the engine consumes this kv and runs the chair wake turn. */
  nudgeQueued: boolean;
}

/**
 * Owner-side supervision. `nudge` queues a directive-driven chair turn (the
 * engine @-mentions the idle member); `flag` records an observation for the
 * acceptance stage; `pause`/`resume` gate the engine's dispatcher. All actions
 * are owner-authority, visible in-group through host supervisor notices.
 */
export async function superviseGroupTask(
  ctx: GroupTaskServiceContext,
  chairSlug: string,
  taskId: number,
  input: SuperviseGroupTaskInput,
): Promise<SuperviseGroupTaskResult> {
  const action = input.action;
  if (!['nudge', 'flag', 'pause', 'resume'].includes(action)) {
    throw new GroupTaskServiceError('invalid_action', "action must be 'nudge', 'flag', 'pause', or 'resume'");
  }
  const chair = await requireProfile(ctx, chairSlug);
  const store = storeFor(ctx, chair);
  const task = await requireTask(store, taskId);
  if (GROUP_TASK_TERMINAL_STATUSES.has(task.status)) {
    throw new GroupTaskServiceError('already_closed', `Group task ${taskId} is already ${task.status}`);
  }

  if (action === 'pause') {
    if (task.dispatchPausedAt != null) {
      return { task, action, notice: null, nudgeQueued: false };
    }
    const updated = await store.setTaskDispatchPaused(taskId, Date.now());
    await store.addSupervisorSignal({ taskId, signalType: action, note: input.note });
    const notice = '[GROUP_TASK_NOTICE:supervisor] Task paused by the owner — '
      + 'dispatch is suspended until they resume it.';
    await postGroupTaskMessage(ctx, chairSlug, taskId, { content: notice }).catch(() => undefined);
    await emitGroupTaskRelay(ctx, chair, updated, 'paused', 'The owner paused this task; dispatch is suspended.');
    return { task: updated, action, notice, nudgeQueued: false };
  }

  if (action === 'resume') {
    if (task.dispatchPausedAt == null) {
      return { task, action, notice: null, nudgeQueued: false };
    }
    const updated = await store.setTaskDispatchPaused(taskId, null);
    await store.addSupervisorSignal({ taskId, signalType: action, note: input.note });
    const notice = '[GROUP_TASK_NOTICE:supervisor] Task resumed by the owner — work continues.';
    await postGroupTaskMessage(ctx, chairSlug, taskId, { content: notice }).catch(() => undefined);
    // The chair must re-engage the roster: queue a resume wake turn.
    await store.kvSet(`${GROUP_TASK_NUDGE_REQUEST_KV_PREFIX}${taskId}`, JSON.stringify({
      kind: 'resume',
      at: Date.now(),
      attempts: 0,
    }));
    await emitGroupTaskRelay(ctx, chair, updated, 'resumed', 'The owner resumed this task; work continues.');
    return { task: updated, action, notice, nudgeQueued: true };
  }

  // nudge + flag address a member (nudge) or the whole room (flag).
  const members = await store.listMembers(taskId);
  let member: GroupTaskMember | null = null;
  const memberSlug = input.memberSlug?.trim();
  const globalMetaId = input.globalMetaId?.trim();
  if (memberSlug || globalMetaId) {
    member = members.find((entry) => (memberSlug
      ? entry.slug === memberSlug
      : (entry.globalMetaId ?? '').trim().toLowerCase() === (globalMetaId ?? '').toLowerCase())) ?? null;
    if (!member) {
      throw new GroupTaskServiceError('member_not_found', `Member not found in group task ${taskId}`);
    }
  }
  if (action === 'flag') {
    const note = input.note?.trim() || '';
    const signal = await store.addSupervisorSignal({
      taskId,
      signalType: action,
      memberGlobalMetaId: member?.globalMetaId ?? null,
      memberName: member?.displayName ?? null,
      note,
    });
    const notice = `[GROUP_TASK_NOTICE:supervisor] Owner observation recorded`
      + `${member?.displayName ? ` on ${member.displayName}` : ''}${note ? `: ${note}` : '.'}`;
    await postGroupTaskMessage(ctx, chairSlug, taskId, { content: notice }).catch(() => undefined);
    return { task, action, notice, nudgeQueued: false };
  }

  // nudge: default target = the least-recently-active non-standby worker.
  const target = member ?? members
    .filter((entry) => entry.role === 'worker' && entry.status !== 'standby')
    .sort((left, right) => (left.statusChangedAt ?? left.createdAt) - (right.statusChangedAt ?? right.createdAt))[0]
    ?? null;
  if (!target) {
    throw new GroupTaskServiceError('no_member_to_nudge', 'No worker member available to nudge');
  }
  await store.addSupervisorSignal({
    taskId,
    signalType: action,
    memberGlobalMetaId: target.globalMetaId,
    memberName: target.displayName,
    note: input.note,
  });
  const nudge = {
    kind: 'nudge' as const,
    memberSlug: target.slug,
    globalMetaId: target.globalMetaId,
    name: target.displayName ?? target.slug ?? target.globalMetaId,
    note: input.note?.trim() || null,
    at: Date.now(),
    attempts: 0,
  };
  await store.kvSet(`${GROUP_TASK_NUDGE_REQUEST_KV_PREFIX}${taskId}`, JSON.stringify(nudge));
  return { task, action, notice: null, nudgeQueued: true };
}

// ---------------------------------------------------------------------------
// Deliverables: owner ledger maintenance
// ---------------------------------------------------------------------------

/** Lightweight task record read (manual-send gating and similar checks). */
export async function getGroupTaskRecord(
  ctx: GroupTaskServiceContext,
  chairSlug: string,
  taskId: number,
): Promise<GroupTaskRecord> {
  const chair = await requireProfile(ctx, chairSlug);
  const store = storeFor(ctx, chair);
  return requireTask(store, taskId);
}

/** Owner-side ledger maintenance: drop a mis-reported deliverable row. */
export async function deleteGroupTaskDeliverableEntry(
  ctx: GroupTaskServiceContext,
  chairSlug: string,
  taskId: number,
  deliverableId: number,
): Promise<{ deleted: boolean }> {
  const chair = await requireProfile(ctx, chairSlug);
  const store = storeFor(ctx, chair);
  await requireTask(store, taskId);
  return { deleted: await store.deleteDeliverable(deliverableId) };
}

// ---------------------------------------------------------------------------
// Worker work requests (Phase 3): the engine defers a worker turn and the DSH
// host claims it, runs a real sub-session, and submits the handoff for the
// on-chain post. Unclaimed requests expire engine-side → bare-LLM fallback.
// ---------------------------------------------------------------------------

export interface GroupTaskWorkClaim {
  requestId: number;
  chairSlug: string;
  taskId: number;
  groupId: string | null;
  workerSlug: string;
  workerName: string;
  targetIndex: number;
  targetPinId: string | null;
  task: { title: string; goal: string; acceptanceCriteria: string | null; status: string };
  roster: Array<{ name: string; role: string; remote: boolean }>;
  recentMessages: Array<{ index: number; sender: string; content: string }>;
  targetMessage: { index: number; sender: string; content: string } | null;
}

/**
 * Claim the oldest pending work request (optionally for one worker) across all
 * chair profiles, assembling a FRESH turn context at claim time (the request
 * row stores only the coordinates). Returns null when the queue is empty.
 */
export async function claimGroupTaskWork(
  ctx: GroupTaskServiceContext,
  workerSlug?: string,
): Promise<GroupTaskWorkClaim | null> {
  const profiles = await ctx.listProfiles();
  const profileBySlug = new Map(profiles.map((profile) => [profile.slug, profile]));
  for (const profile of profiles) {
    const store = storeFor(ctx, profile);
    const pending = await store.listWorkRequests({ status: 'pending', ...(workerSlug ? { workerSlug } : {}) });
    for (const request of pending) {
      // Re-read under the write lock: only a still-pending row may be claimed.
      const fresh = await store.getWorkRequest(request.id);
      if (!fresh || fresh.status !== 'pending') continue;
      const claimed = await store.updateWorkRequest(request.id, { status: 'claimed' });
      if (!claimed) continue;
      const task = await store.getTaskById(request.taskId);
      if (!task) {
        await store.updateWorkRequest(request.id, { status: 'failed', error: 'task_missing' });
        continue;
      }
      const members = await store.listMembers(request.taskId);
      const workerMember = members.find((member) => member.slug === request.workerSlug);
      const workerProfile = await ctx.getProfile(request.workerSlug);
      const page = task.groupId
        ? await store.listMessages(task.groupId, { limit: 20 })
        : { messages: [] as GroupTaskMessage[] };
      const senderOf = (message: GroupTaskMessage): string =>
        message.senderName?.trim() || message.senderGlobalMetaId || 'unknown';
      const targetMessage = page.messages.find((message) => message.index === request.targetIndex) ?? null;
      return {
        requestId: claimed.id,
        chairSlug: profile.slug,
        taskId: request.taskId,
        groupId: request.groupId,
        workerSlug: request.workerSlug,
        workerName: workerMember?.displayName?.trim()
          || workerProfile?.name?.trim()
          || request.workerSlug,
        targetIndex: request.targetIndex,
        targetPinId: request.targetPinId,
        task: {
          title: task.title,
          goal: task.goal,
          acceptanceCriteria: task.acceptanceCriteria,
          status: task.status,
        },
        roster: members
          .filter((member) => member.removedAt == null)
          .map((member) => ({
            name: memberDisplayName(member, member.slug ? profileBySlug.get(member.slug)?.name : undefined),
            role: member.role,
            remote: member.slug == null,
          })),
        recentMessages: page.messages.map((message) => ({
          index: message.index,
          sender: senderOf(message),
          content: message.content,
        })),
        targetMessage: targetMessage
          ? { index: targetMessage.index, sender: senderOf(targetMessage), content: targetMessage.content }
          : null,
      };
    }
  }
  return null;
}

export interface SubmitGroupTaskWorkInput {
  requestId: number;
  handoff?: string;
  error?: string;
  dshSessionId?: string;
}

export interface SubmitGroupTaskWorkResult {
  status: 'completed' | 'failed';
  pinId: string | null;
  error: string | null;
}

/**
 * Host-side turn completion: a non-empty handoff is posted on-chain AS the
 * worker (reply-threaded to the target message) and the request completes;
 * an error or empty handoff fails the request so the engine falls back to its
 * bare-LLM turn. Posting to a task that closed mid-work fails the request.
 */
export async function submitGroupTaskWork(
  ctx: GroupTaskServiceContext,
  input: SubmitGroupTaskWorkInput,
): Promise<SubmitGroupTaskWorkResult> {
  for (const profile of await ctx.listProfiles()) {
    const store = storeFor(ctx, profile);
    const request = await store.getWorkRequest(input.requestId);
    if (!request) continue;
    if (request.status === 'completed') {
      return { status: 'completed', pinId: null, error: null };
    }
    const handoff = input.handoff?.trim() ?? '';
    const fail = async (error: string): Promise<SubmitGroupTaskWorkResult> => {
      await store.updateWorkRequest(request.id, {
        status: 'failed',
        error: error.slice(0, 500),
        dshSessionId: input.dshSessionId ?? null,
      });
      return { status: 'failed', pinId: null, error };
    };
    if (input.error?.trim()) return fail(input.error.trim());
    if (!handoff) return fail('WORKER_EMPTY_HANDOFF: the worker session produced no handoff text');
    try {
      const posted = await postGroupTaskMessage(ctx, profile.slug, request.taskId, {
        asSlug: request.workerSlug,
        content: handoff,
        replyPin: request.targetPinId ?? undefined,
      });
      await store.updateWorkRequest(request.id, {
        status: 'completed',
        handoff,
        dshSessionId: input.dshSessionId ?? null,
      });
      return { status: 'completed', pinId: posted.pinId, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return await fail(`post_failed: ${message}`);
    }
  }
  throw new GroupTaskServiceError('work_request_not_found', `Work request ${input.requestId} not found`);
}

// ---------------------------------------------------------------------------
// Members: kick / status
// ---------------------------------------------------------------------------

/** Post-kick on-chain removal re-check cadence. */
export const KICK_CONFIRM_POLL_INTERVAL_MS = 2_000;
export const KICK_CONFIRM_MAX_ATTEMPTS = 15;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function confirmChainRemoval(
  ctx: GroupTaskServiceContext,
  groupId: string,
  identities: Array<string | null | undefined>,
  pollIntervalMs = KICK_CONFIRM_POLL_INTERVAL_MS,
  maxAttempts = KICK_CONFIRM_MAX_ATTEMPTS,
): Promise<boolean> {
  const candidates = new Set(
    identities.map((value) => String(value ?? '').trim().toLowerCase()).filter(Boolean),
  );
  if (candidates.size === 0) return false;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const members = await fetchGroupMembers(groupId, ctx.transport).catch(() => null);
    if (members && !members.some((member) => candidates.has(member.trim().toLowerCase()))) {
      return true;
    }
    if (attempt < maxAttempts) await sleep(pollIntervalMs);
  }
  return false;
}

export interface KickGroupTaskMemberInput {
  /** Local member path (profile slug). */
  slug?: string;
  /** Remote member path (OpenTeam rows have slug == null). */
  globalMetaId?: string;
  reason?: string;
  /** Poll tuning (tests inject tiny values). */
  confirmPollIntervalMs?: number;
  confirmMaxAttempts?: number;
}

export interface KickGroupTaskMemberResult {
  member: GroupTaskMember;
  /** True once the indexer member list no longer contains the identity. */
  chainRemovalConfirmed: boolean;
}

/**
 * Kick a member: the chair (group creator) signs the removeuser pin, the
 * member row is marked removed, and the chair posts a deterministic
 * moderation notice (no LLM). On-chain failure aborts before any store write.
 * Idempotent: an already-removed member sends no new pin but still re-checks
 * the chain state read-only.
 */
export async function kickGroupTaskMember(
  ctx: GroupTaskServiceContext,
  chairSlug: string,
  taskId: number,
  input: KickGroupTaskMemberInput,
): Promise<KickGroupTaskMemberResult> {
  const log = logOf(ctx);
  const chair = await requireProfile(ctx, chairSlug);
  const store = storeFor(ctx, chair);
  const task = await requireRunnableTask(store, taskId);

  const slug = input.slug?.trim() || null;
  const globalMetaId = input.globalMetaId?.trim() || null;
  if (!slug && !globalMetaId) {
    throw new GroupTaskServiceError('member_ref_required', 'slug or globalMetaId is required');
  }

  const all = await store.listMembers(taskId, { includeRemoved: true });
  const member = slug != null
    ? all.find((candidate) => candidate.slug === slug)
    : [...all].reverse().find(
      (candidate) => candidate.slug == null
        && (candidate.globalMetaId ?? '').trim().toLowerCase() === globalMetaId!.toLowerCase(),
    );
  if (!member) {
    throw new GroupTaskServiceError(
      'member_not_found',
      `${slug ? `Bot ${slug}` : `globalMetaId ${globalMetaId}`} is not a member of group task ${taskId}`,
    );
  }
  if (member.role === 'chair') {
    throw new GroupTaskServiceError('cannot_kick_chair', 'The chair cannot be removed from its own group task');
  }

  // Resolve the legacy MetaID the removeuser body expects. Local members read
  // it from the profile; remote members fall back to the GlobalMetaID (the
  // indexer tolerates that form; a wrong value only means the on-chain
  // removal is a no-op while the local kick still holds).
  const memberProfile = member.slug ? await ctx.getProfile(member.slug) : null;
  const removeMetaid = memberProfile?.metaId?.trim()
    || (member.globalMetaId ?? '').trim();
  if (!removeMetaid) {
    throw new GroupTaskServiceError('member_identity_missing', `Member ${member.id} has no resolvable MetaID`);
  }

  if (member.removedAt) {
    const chainRemovalConfirmed = await confirmChainRemoval(
      ctx,
      task.groupId!,
      [removeMetaid, member.globalMetaId],
      input.confirmPollIntervalMs,
      input.confirmMaxAttempts,
    );
    return { member, chainRemovalConfirmed };
  }

  const reason = input.reason?.trim() || undefined;
  const chairSigner = await ctx.signerForSlug(chair.slug);
  const { pinId } = await removeGroupMemberOnChain(chairSigner, task.groupId!, {
    removeMetaid,
    reason,
  });
  const removed = await store.markMemberRemoved({
    taskId,
    slug: member.slug,
    globalMetaId: member.slug == null ? member.globalMetaId : undefined,
    removePinId: pinId,
  });

  // Kick sedimentation: the chair records a kicked fact for staffing memory.
  await recordKickImpression(ctx, chairSlug, task, member).catch(() => undefined);

  // Deterministic moderation notice from the chair. A failed announcement
  // must not roll back the removal.
  try {
    const displayName = memberDisplayName(member, memberProfile?.name) || removeMetaid;
    await sendGroupMessageOnChain(chairSigner, task.groupId!, {
      content:
        `Moderation: ${displayName} has been removed from this group task by the owner.`
        + (reason ? ` Reason: ${reason}` : ''),
      nickName: chair.name.trim() || chair.slug,
    });
  } catch (error) {
    log(
      `[GroupTask] Moderation announcement failed for task ${taskId}: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Remote OpenTeam member: send the one-way [OPENTEAM_KICK] envelope so the
  // guest side marks its membership left. Best-effort — the removal holds.
  if (member.slug == null && member.globalMetaId && ctx.sendPrivateMessage) {
    try {
      await ctx.sendPrivateMessage({
        fromSlug: chair.slug,
        toGlobalMetaId: member.globalMetaId,
        content: buildOpenTeamKickMessage({
          v: 1,
          groupId: task.groupId!,
          taskTitle: task.title,
          reason: reason ?? '',
        }),
      });
    } catch (error) {
      log(
        `[GroupTask] OpenTeam kick notice failed for task ${taskId}: `
        + `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const chainRemovalConfirmed = await confirmChainRemoval(
    ctx,
    task.groupId!,
    [removeMetaid, member.globalMetaId],
    input.confirmPollIntervalMs,
    input.confirmMaxAttempts,
  );
  if (!chainRemovalConfirmed) {
    log(
      `[GroupTask] Kick of member ${member.id} in task ${taskId} not confirmed on-chain; `
      + 'the local removal holds and the indexer may just be lagging',
    );
  }
  return { member: removed, chainRemovalConfirmed };
}

export const GROUP_TASK_MEMBER_STATUSES: GroupTaskMemberStatus[] = [
  'assigned',
  'working',
  'standby',
  'done',
  'unreachable',
];

export async function setGroupTaskMemberStatus(
  ctx: GroupTaskServiceContext,
  chairSlug: string,
  taskId: number,
  input: { slug?: string | null; globalMetaId?: string | null; status: GroupTaskMemberStatus },
): Promise<GroupTaskMember> {
  const chair = await requireProfile(ctx, chairSlug);
  const store = storeFor(ctx, chair);
  await requireTask(store, taskId);
  const updated = await store.setMemberStatus(
    taskId,
    input.slug ?? null,
    input.status,
    input.globalMetaId ?? null,
  );
  if (!updated) {
    throw new GroupTaskServiceError('member_not_found', `Member not found in group task ${taskId}`);
  }
  return updated;
}

export async function getGroupTaskMemberStatus(
  ctx: GroupTaskServiceContext,
  chairSlug: string,
  taskId: number,
): Promise<GroupTaskMemberSummary[]> {
  const detail = await getGroupTaskDetail(ctx, chairSlug, taskId, { view: 'summary' });
  return detail.members;
}

// ---------------------------------------------------------------------------
// Local list housekeeping
// ---------------------------------------------------------------------------

export async function renameGroupTask(
  ctx: GroupTaskServiceContext,
  chairSlug: string,
  taskId: number,
  displayName: string,
): Promise<GroupTaskRecord> {
  const chair = await requireProfile(ctx, chairSlug);
  return storeFor(ctx, chair).renameTask(taskId, displayName);
}

export async function setGroupTaskPinned(
  ctx: GroupTaskServiceContext,
  chairSlug: string,
  taskId: number,
  pinned: boolean,
): Promise<GroupTaskRecord> {
  const chair = await requireProfile(ctx, chairSlug);
  return storeFor(ctx, chair).setTaskPinned(taskId, pinned);
}

export async function archiveGroupTask(
  ctx: GroupTaskServiceContext,
  chairSlug: string,
  taskId: number,
): Promise<GroupTaskRecord> {
  const chair = await requireProfile(ctx, chairSlug);
  return storeFor(ctx, chair).archiveTask(taskId);
}

export async function unarchiveGroupTask(
  ctx: GroupTaskServiceContext,
  chairSlug: string,
  taskId: number,
): Promise<GroupTaskRecord> {
  const chair = await requireProfile(ctx, chairSlug);
  return storeFor(ctx, chair).unarchiveTask(taskId);
}
