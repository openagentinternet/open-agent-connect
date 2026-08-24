/**
 * Group Task service: business layer over the grouptask store + transport.
 * One on-chain group = one task; a local Bot chairs every task (the machine
 * twin by default). All seams (profiles, signers, owner identity, indexer
 * fetch) are injected through GroupTaskServiceContext so the daemon wires
 * production implementations and tests wire fakes without chain writes.
 */
import type { Signer } from '../signing/signer';
import { type GroupTaskStore } from './store';
import { type OpenTeamStore } from './openteamStore';
import { type StaffingStore } from './staffingStore';
import { type GroupTaskTransportOptions } from './transport';
import { type CreateGroupTaskInput, type GroupTaskDetail, type GroupTaskListTab, type GroupTaskMember, type GroupTaskMemberStatus, type GroupTaskMemberSummary, type GroupTaskMemberWorkStatus, type GroupTaskMessage, type GroupTaskRecord, type GroupTaskStatusEventActor, type GroupTaskSummary } from './types';
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
    }): Promise<{
        pinId: string | null;
    }>;
    transport?: GroupTaskTransportOptions;
    log?(message: string): void;
}
export declare class GroupTaskServiceError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** OpenTeam handshake store for a profile (exported for the engine). */
export declare function openteamStoreFor(ctx: GroupTaskServiceContext, profile: GroupTaskProfileRef): OpenTeamStore;
/** Staffing proposal store for a profile (exported for the staffing service).
 *  Memoized per store file: the CAS claim/release only serializes within one
 *  instance's in-process queue, so every request must share the instance. */
export declare function staffingStoreFor(ctx: GroupTaskServiceContext, profile: GroupTaskProfileRef): StaffingStore;
/** Resolve a profile by slug or fail (exported for the staffing service). */
export declare function requireProfile(ctx: GroupTaskServiceContext, slug: string): Promise<GroupTaskProfileRef>;
/** Minutes of engine inactivity before a non-terminal task reads as stalled. */
export declare const GROUP_TASK_STALL_AFTER_MINUTES = 30;
/** Minutes a [WORKING] tag stays "working" after its last occurrence. */
export declare const GROUP_TASK_WORKING_WINDOW_MINUTES = 20;
/** Minutes a working/assigned member's [WORKING] signal may be stale before 'timeout'. */
export declare const GROUP_TASK_TIMEOUT_WINDOW_MINUTES = 20;
export declare function computeGroupTaskStall(task: Pick<GroupTaskRecord, 'status' | 'lastDrivenAt' | 'updatedAt'>, nowMs?: number): {
    stall: boolean;
    stallAfterMinutes: number;
};
/**
 * Pure member work-status derivation (IDBots P1-4/R6 rules, minus the
 * canonical-attempt source which OAC does not track in M1):
 *  1. fresh [WORKING] tag => working;
 *  2. working/assigned member with a stale [WORKING] signal => timeout;
 *  3. member still self-reported working => working;
 *  4. any speech => idle;
 *  5. otherwise unknown.
 */
export declare function computeGroupTaskMemberWorkStatus(input: {
    lastSpeakAt: number | null;
    lastWorkingAt: number | null;
    memberStatus?: GroupTaskMemberStatus;
    nowMs?: number;
}): GroupTaskMemberWorkStatus;
/**
 * Kickoff message posted by the chair right after group creation. The member
 * roster line must NOT carry `@` prefixes — the engine treats an explicit
 * `@Name` as a work assignment (IDBots P0-3).
 */
export declare function buildKickoffMessage(input: {
    title: string;
    goal: string;
    acceptanceCriteria?: string | null;
    chairName: string;
    memberNames: string[];
}): string;
/** Tag-free body of a chair [CHECKPOINT] message (what the owner must decide). */
export declare function extractCheckpointDecisionSummary(content: string | null | undefined): string | null;
export declare const GROUP_TASK_REWORK_AT_KV_PREFIX = "group_task_rework_at:";
export declare const GROUP_TASK_OWNER_REPORTED_KV_PREFIX = "group_task_owner_reported:";
export declare const GROUP_TASK_REVIEW_REASSERT_KV_PREFIX = "group_task_review_reassert:";
/** Clear every review-delivery guard on a rework hatch (IDBots parity). */
export declare function clearGroupTaskReviewDeliveryGuards(store: GroupTaskStore, taskId: number): Promise<void>;
/**
 * Owner join guard: joining costs gas, so the owner's on-chain join is
 * kv-recorded per group. Returns true when a join pin was actually sent.
 */
export declare function ensureOwnerJoinedGroup(ctx: GroupTaskServiceContext, store: GroupTaskStore, groupId: string): Promise<boolean>;
/** Twin preferred; an explicit chair slug wins; else fail with a clear code. */
export declare function resolveChairProfile(ctx: GroupTaskServiceContext, preferredSlug?: string): Promise<GroupTaskProfileRef>;
/**
 * Create a group task end to end: resolve chair -> create the on-chain group
 * -> wait for the indexer -> persist task + member rows -> join each worker
 * Bot and the owner -> chair posts the kickoff message. Indexer timeouts and
 * individual join failures degrade with warnings, never fail the creation
 * (the group pin is already on-chain; backfill reconciles).
 */
export declare function createGroupTask(ctx: GroupTaskServiceContext, input: CreateGroupTaskInput): Promise<{
    chairSlug: string;
    task: GroupTaskDetail;
}>;
export interface ListGroupTasksOptions {
    tab?: GroupTaskListTab;
    includeArchived?: boolean;
}
export interface GroupTaskSummaryWithChair extends GroupTaskSummary {
    /** The chair profile slug the task record lives under (task addressing). */
    chairSlug: string;
}
/** Aggregate task summaries across every local profile's grouptask store. */
export declare function listGroupTaskSummaries(ctx: GroupTaskServiceContext, options?: ListGroupTasksOptions): Promise<GroupTaskSummaryWithChair[]>;
/** Best-effort transcript sync (chain history is truth; failures degrade). */
export declare function syncGroupTaskMessages(ctx: GroupTaskServiceContext, store: GroupTaskStore, task: GroupTaskRecord): Promise<void>;
export declare function getGroupTaskDetail(ctx: GroupTaskServiceContext, chairSlug: string, taskId: number, opts?: {
    view?: 'summary' | 'full';
    sync?: boolean;
}): Promise<GroupTaskDetail>;
export declare function listGroupTaskMessages(ctx: GroupTaskServiceContext, chairSlug: string, taskId: number, opts?: {
    limit?: number;
    beforeIndex?: number;
    sync?: boolean;
}): Promise<{
    messages: GroupTaskMessage[];
    total: number;
}>;
export interface PostGroupTaskMessageInput {
    /** Local member Bot to speak as; mutually exclusive with asOwner. */
    asSlug?: string;
    /** Post as the human owner identity. */
    asOwner?: boolean;
    content: string;
    replyPin?: string;
    mention?: string[];
}
export declare function postGroupTaskMessage(ctx: GroupTaskServiceContext, chairSlug: string, taskId: number, input: PostGroupTaskMessageInput): Promise<{
    pinId: string;
}>;
export declare function closeGroupTask(ctx: GroupTaskServiceContext, chairSlug: string, taskId: number, opts: {
    status: 'done' | 'cancelled';
    reason?: string;
    rating?: number;
    ratingComment?: string;
    actor?: GroupTaskStatusEventActor;
}): Promise<GroupTaskDetail>;
/**
 * Pull a REVIEW task back to EXECUTING (the owner's "Back to work" action,
 * mirroring the on-chain rework hatch [STATUS:EXECUTING]). Clears every
 * review-delivery guard and stamps the rework instant so a stale in-flight
 * [STATUS:REVIEW] verdict is debounced. Pending deliverables are marked
 * rejected so the acceptance ledger stays traceable.
 */
export declare function reopenGroupTask(ctx: GroupTaskServiceContext, chairSlug: string, taskId: number, opts?: {
    actor?: GroupTaskStatusEventActor;
    reason?: string;
}): Promise<GroupTaskDetail>;
/** Post-kick on-chain removal re-check cadence. */
export declare const KICK_CONFIRM_POLL_INTERVAL_MS = 2000;
export declare const KICK_CONFIRM_MAX_ATTEMPTS = 15;
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
export declare function kickGroupTaskMember(ctx: GroupTaskServiceContext, chairSlug: string, taskId: number, input: KickGroupTaskMemberInput): Promise<KickGroupTaskMemberResult>;
export declare const GROUP_TASK_MEMBER_STATUSES: GroupTaskMemberStatus[];
export declare function setGroupTaskMemberStatus(ctx: GroupTaskServiceContext, chairSlug: string, taskId: number, input: {
    slug?: string | null;
    globalMetaId?: string | null;
    status: GroupTaskMemberStatus;
}): Promise<GroupTaskMember>;
export declare function getGroupTaskMemberStatus(ctx: GroupTaskServiceContext, chairSlug: string, taskId: number): Promise<GroupTaskMemberSummary[]>;
export declare function renameGroupTask(ctx: GroupTaskServiceContext, chairSlug: string, taskId: number, displayName: string): Promise<GroupTaskRecord>;
export declare function setGroupTaskPinned(ctx: GroupTaskServiceContext, chairSlug: string, taskId: number, pinned: boolean): Promise<GroupTaskRecord>;
export declare function archiveGroupTask(ctx: GroupTaskServiceContext, chairSlug: string, taskId: number): Promise<GroupTaskRecord>;
export declare function unarchiveGroupTask(ctx: GroupTaskServiceContext, chairSlug: string, taskId: number): Promise<GroupTaskRecord>;
