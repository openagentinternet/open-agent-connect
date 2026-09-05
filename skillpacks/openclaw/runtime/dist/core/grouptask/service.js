"use strict";
/**
 * Group Task service: business layer over the grouptask store + transport.
 * One on-chain group = one task; a local Bot chairs every task (the machine
 * twin by default). All seams (profiles, signers, owner identity, indexer
 * fetch) are injected through GroupTaskServiceContext so the daemon wires
 * production implementations and tests wire fakes without chain writes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GROUP_TASK_MEMBER_STATUSES = exports.KICK_CONFIRM_MAX_ATTEMPTS = exports.KICK_CONFIRM_POLL_INTERVAL_MS = exports.GROUP_TASK_NUDGE_REQUEST_KV_PREFIX = exports.GROUP_TASK_REVIEW_REASSERT_KV_PREFIX = exports.GROUP_TASK_OWNER_REPORTED_KV_PREFIX = exports.GROUP_TASK_REWORK_AT_KV_PREFIX = exports.GROUP_TASK_TIMEOUT_WINDOW_MINUTES = exports.GROUP_TASK_WORKING_WINDOW_MINUTES = exports.GROUP_TASK_STALL_AFTER_MINUTES = exports.GroupTaskServiceError = void 0;
exports.openteamStoreFor = openteamStoreFor;
exports.staffingStoreFor = staffingStoreFor;
exports.requireProfile = requireProfile;
exports.computeGroupTaskStall = computeGroupTaskStall;
exports.computeGroupTaskMemberWorkStatus = computeGroupTaskMemberWorkStatus;
exports.buildKickoffMessage = buildKickoffMessage;
exports.extractCheckpointDecisionSummary = extractCheckpointDecisionSummary;
exports.clearGroupTaskReviewDeliveryGuards = clearGroupTaskReviewDeliveryGuards;
exports.ensureOwnerJoinedGroup = ensureOwnerJoinedGroup;
exports.resolveChairProfile = resolveChairProfile;
exports.createGroupTask = createGroupTask;
exports.listGroupTaskSummaries = listGroupTaskSummaries;
exports.syncGroupTaskMessages = syncGroupTaskMessages;
exports.getGroupTaskDetail = getGroupTaskDetail;
exports.listGroupTaskMessages = listGroupTaskMessages;
exports.postGroupTaskMessage = postGroupTaskMessage;
exports.closeGroupTask = closeGroupTask;
exports.reopenGroupTask = reopenGroupTask;
exports.relayStoreFor = relayStoreFor;
exports.emitGroupTaskRelay = emitGroupTaskRelay;
exports.drainGroupTaskRelay = drainGroupTaskRelay;
exports.superviseGroupTask = superviseGroupTask;
exports.getGroupTaskRecord = getGroupTaskRecord;
exports.deleteGroupTaskDeliverableEntry = deleteGroupTaskDeliverableEntry;
exports.claimGroupTaskWork = claimGroupTaskWork;
exports.submitGroupTaskWork = submitGroupTaskWork;
exports.kickGroupTaskMember = kickGroupTaskMember;
exports.setGroupTaskMemberStatus = setGroupTaskMemberStatus;
exports.getGroupTaskMemberStatus = getGroupTaskMemberStatus;
exports.renameGroupTask = renameGroupTask;
exports.setGroupTaskPinned = setGroupTaskPinned;
exports.archiveGroupTask = archiveGroupTask;
exports.unarchiveGroupTask = unarchiveGroupTask;
const paths_1 = require("../state/paths");
const store_1 = require("./store");
const relayStore_1 = require("./relayStore");
const openteamStore_1 = require("./openteamStore");
const staffingStore_1 = require("./staffingStore");
const impressions_1 = require("./impressions");
const openteam_1 = require("./openteam");
const transport_1 = require("./transport");
const backfill_1 = require("./backfill");
const types_1 = require("./types");
class GroupTaskServiceError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'GroupTaskServiceError';
    }
}
exports.GroupTaskServiceError = GroupTaskServiceError;
function storeFor(ctx, profile) {
    if (ctx.storeForProfile)
        return ctx.storeForProfile(profile);
    return (0, store_1.createGroupTaskStore)((0, paths_1.resolveMetabotPaths)(profile.homeDir));
}
/** OpenTeam handshake store for a profile (exported for the engine). */
function openteamStoreFor(ctx, profile) {
    if (ctx.openteamStoreForProfile)
        return ctx.openteamStoreForProfile(profile);
    return (0, openteamStore_1.createOpenTeamStore)((0, paths_1.resolveMetabotPaths)(profile.homeDir));
}
const staffingStoreCache = new Map();
/** Staffing proposal store for a profile (exported for the staffing service).
 *  Memoized per store file: the CAS claim/release only serializes within one
 *  instance's in-process queue, so every request must share the instance. */
function staffingStoreFor(ctx, profile) {
    if (ctx.staffingStoreForProfile)
        return ctx.staffingStoreForProfile(profile);
    const paths = (0, paths_1.resolveMetabotPaths)(profile.homeDir);
    const key = paths.runtimeRoot;
    let store = staffingStoreCache.get(key);
    if (!store) {
        store = (0, staffingStore_1.createStaffingStore)(paths);
        staffingStoreCache.set(key, store);
    }
    return store;
}
function logOf(ctx) {
    return ctx.log ?? (() => undefined);
}
/** Resolve a profile by slug or fail (exported for the staffing service). */
async function requireProfile(ctx, slug) {
    const profile = await ctx.getProfile(slug.trim());
    if (!profile) {
        throw new GroupTaskServiceError('profile_not_found', `MetaBot profile not found: ${slug}`);
    }
    return profile;
}
async function requireTask(store, taskId) {
    const task = await store.getTaskById(taskId);
    if (!task) {
        throw new GroupTaskServiceError('task_not_found', `Group task ${taskId} not found`);
    }
    return task;
}
/** The task exists, is not terminal, and has its on-chain group id. */
async function requireRunnableTask(store, taskId) {
    const task = await requireTask(store, taskId);
    if (types_1.GROUP_TASK_TERMINAL_STATUSES.has(task.status)) {
        throw new GroupTaskServiceError('task_terminal', `Group task ${taskId} is ${task.status}; no further messages or members allowed`);
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
exports.GROUP_TASK_STALL_AFTER_MINUTES = 30;
/** Minutes a [WORKING] tag stays "working" after its last occurrence. */
exports.GROUP_TASK_WORKING_WINDOW_MINUTES = 20;
/** Minutes a working/assigned member's [WORKING] signal may be stale before 'timeout'. */
exports.GROUP_TASK_TIMEOUT_WINDOW_MINUTES = 20;
function computeGroupTaskStall(task, nowMs = Date.now()) {
    if (types_1.GROUP_TASK_TERMINAL_STATUSES.has(task.status)) {
        return { stall: false, stallAfterMinutes: exports.GROUP_TASK_STALL_AFTER_MINUTES };
    }
    const lastActivityMs = task.lastDrivenAt ?? task.updatedAt ?? null;
    const stall = lastActivityMs != null
        && nowMs - lastActivityMs > exports.GROUP_TASK_STALL_AFTER_MINUTES * 60_000;
    return { stall, stallAfterMinutes: exports.GROUP_TASK_STALL_AFTER_MINUTES };
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
function computeGroupTaskMemberWorkStatus(input) {
    const nowMs = input.nowMs ?? Date.now();
    const lastSpeakAtMs = input.lastSpeakAt != null ? input.lastSpeakAt * 1000 : null;
    const lastWorkingAtMs = input.lastWorkingAt;
    const workingWindowMs = exports.GROUP_TASK_WORKING_WINDOW_MINUTES * 60_000;
    const timeoutWindowMs = exports.GROUP_TASK_TIMEOUT_WINDOW_MINUTES * 60_000;
    if (lastWorkingAtMs != null && nowMs - lastWorkingAtMs <= workingWindowMs) {
        return 'working';
    }
    if ((input.memberStatus === 'working' || input.memberStatus === 'assigned')
        && lastWorkingAtMs != null
        && nowMs - lastWorkingAtMs > timeoutWindowMs) {
        return 'timeout';
    }
    if (input.memberStatus === 'working')
        return 'working';
    if (lastSpeakAtMs != null)
        return 'idle';
    return 'unknown';
}
/**
 * Kickoff message posted by the chair right after group creation. The member
 * roster line must NOT carry `@` prefixes — the engine treats an explicit
 * `@Name` as a work assignment (IDBots P0-3).
 */
function buildKickoffMessage(input) {
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
function extractCheckpointDecisionSummary(content) {
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
exports.GROUP_TASK_REWORK_AT_KV_PREFIX = 'group_task_rework_at:';
exports.GROUP_TASK_OWNER_REPORTED_KV_PREFIX = 'group_task_owner_reported:';
exports.GROUP_TASK_REVIEW_REASSERT_KV_PREFIX = 'group_task_review_reassert:';
/** Clear every review-delivery guard on a rework hatch (IDBots parity). */
async function clearGroupTaskReviewDeliveryGuards(store, taskId) {
    await store.kvDelete(`${exports.GROUP_TASK_OWNER_REPORTED_KV_PREFIX}${taskId}`);
    await store.kvDelete(`${exports.GROUP_TASK_REVIEW_REASSERT_KV_PREFIX}${taskId}`);
}
/**
 * Owner join guard: joining costs gas, so the owner's on-chain join is
 * kv-recorded per group. Returns true when a join pin was actually sent.
 */
async function ensureOwnerJoinedGroup(ctx, store, groupId) {
    const key = `${OWNER_JOINED_KV_PREFIX}${groupId}`;
    if ((await store.kvGet(key)) === '1')
        return false;
    const owner = await ctx.ownerIdentity();
    if (!owner) {
        throw new GroupTaskServiceError('owner_missing', 'No local owner identity; create one with `metabot user ensure` first');
    }
    await (0, transport_1.joinGroupOnChain)(owner.signer, groupId);
    await store.kvSet(key, '1');
    return true;
}
// ---------------------------------------------------------------------------
// Chair resolution
// ---------------------------------------------------------------------------
/** Twin preferred; an explicit chair slug wins; else fail with a clear code. */
async function resolveChairProfile(ctx, preferredSlug) {
    if (preferredSlug?.trim()) {
        return requireProfile(ctx, preferredSlug);
    }
    const profiles = await ctx.listProfiles();
    const twin = profiles.find((profile) => profile.botType === 'twin');
    if (twin)
        return twin;
    throw new GroupTaskServiceError('chair_unresolved', 'No twin Bot found and no chair slug given; designate a twin or pass an explicit chair');
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
async function createGroupTask(ctx, input) {
    const log = logOf(ctx);
    const title = input.title?.trim();
    const goal = input.goal?.trim();
    if (!title)
        throw new GroupTaskServiceError('title_required', 'title is required');
    if (!goal)
        throw new GroupTaskServiceError('goal_required', 'goal is required');
    const chair = await resolveChairProfile(ctx, input.chairSlug);
    const store = storeFor(ctx, chair);
    const chairName = chair.name.trim() || chair.slug;
    const workerSlugs = [...new Set((input.workerSlugs ?? [])
            .map((slug) => slug.trim())
            .filter((slug) => slug && slug !== chair.slug))];
    const chairSigner = await ctx.signerForSlug(chair.slug);
    const { groupId, pinId } = await (0, transport_1.createGroupOnChain)(chairSigner, {
        groupName: title,
        groupNote: goal,
    });
    const indexed = await (0, transport_1.waitForGroupIndexed)(groupId, ctx.transport);
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
    const memberNames = [];
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
            const { pinId: joinPinId } = await (0, transport_1.joinGroupOnChain)(workerSigner, groupId, {
                referrer: chair.metaId ?? '',
            });
            await store.updateMemberJoinedPinId(task.id, worker.slug, joinPinId);
        }
        catch (error) {
            // A member join failure must not fail the whole creation.
            log(`[GroupTask] joinGroup failed for member ${worker.slug} in task ${task.id}: `
                + `${error instanceof Error ? error.message : String(error)}`);
        }
    }
    // The indexer diverts messages from non-members, so the human owner joins
    // every task group to observe/post. Degradation-tolerant like member joins.
    try {
        await ensureOwnerJoinedGroup(ctx, store, groupId);
    }
    catch (error) {
        log(`[GroupTask] Owner identity join failed for task ${task.id}: `
            + `${error instanceof Error ? error.message : String(error)}`);
    }
    try {
        await (0, transport_1.sendGroupMessageOnChain)(chairSigner, groupId, {
            content: buildKickoffMessage({
                title,
                goal,
                acceptanceCriteria: input.acceptanceCriteria,
                chairName,
                memberNames,
            }),
            nickName: chairName,
        });
    }
    catch (error) {
        log(`[GroupTask] Kickoff message failed for task ${task.id}: `
            + `${error instanceof Error ? error.message : String(error)}`);
    }
    await emitGroupTaskRelay(ctx, chair, task, 'created', `Task created and the on-chain group is open. The engine posts the kickoff and runs planning next.`);
    return { chairSlug: chair.slug, task: await getGroupTaskDetail(ctx, chair.slug, task.id) };
}
// ---------------------------------------------------------------------------
// List / detail
// ---------------------------------------------------------------------------
function memberDisplayName(member, profileName) {
    return (profileName ?? member.displayName ?? member.slug ?? member.globalMetaId ?? '').trim();
}
/** Aggregate task summaries across every local profile's grouptask store. */
async function listGroupTaskSummaries(ctx, options) {
    const profiles = await ctx.listProfiles();
    const profileBySlug = new Map(profiles.map((profile) => [profile.slug, profile]));
    const summaries = [];
    for (const profile of profiles) {
        const store = storeFor(ctx, profile);
        let tasks;
        try {
            tasks = await store.listTasks({ includeArchived: options?.includeArchived ?? false });
        }
        catch {
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
    const filtered = (0, types_1.filterGroupTasksByTab)(summaries, options?.tab ?? 'all');
    return filtered.sort((left, right) => {
        if (left.pinned !== right.pinned)
            return left.pinned ? -1 : 1;
        return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
    });
}
/** Trusted identity set for suspect marking: active members + the owner. */
async function buildTrustedGmidSet(ctx, members) {
    const trusted = new Set();
    for (const member of members) {
        const gmid = (member.globalMetaId ?? '').trim().toLowerCase();
        if (gmid)
            trusted.add(gmid);
    }
    try {
        const owner = await ctx.ownerIdentity();
        if (owner?.globalMetaId)
            trusted.add(owner.globalMetaId.trim().toLowerCase());
    }
    catch {
        // Owner identity is optional for reads.
    }
    return trusted;
}
/** Best-effort transcript sync (chain history is truth; failures degrade). */
async function syncGroupTaskMessages(ctx, store, task) {
    if (!task.groupId)
        return;
    try {
        const members = await store.listMembers(task.id, { includeRemoved: true });
        await (0, backfill_1.syncGroupMessages)({
            store,
            groupId: task.groupId,
            trustedGlobalMetaIds: await buildTrustedGmidSet(ctx, members.filter((m) => m.removedAt == null)),
            transport: ctx.transport,
        });
    }
    catch (error) {
        logOf(ctx)(`[GroupTask] Message sync failed for task ${task.id}: `
            + `${error instanceof Error ? error.message : String(error)}`);
    }
}
async function getGroupTaskDetail(ctx, chairSlug, taskId, opts) {
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
        : new Map();
    const workingMap = task.groupId
        ? await store.getMembersWorkingAt(task.groupId, gmids)
        : new Map();
    const memberSummaries = members.map((member) => {
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
    let openCheckpointSummary = null;
    if (openCheckpoint?.openedMsgPinId && task.groupId) {
        const opened = await store.getMessageByPinId(task.groupId, openCheckpoint.openedMsgPinId);
        openCheckpointSummary = opened ? extractCheckpointDecisionSummary(opened.content) : null;
    }
    const stall = computeGroupTaskStall(task);
    const messagesPage = task.groupId
        ? await store.listMessages(task.groupId, { limit: view === 'full' ? 50 : 5 })
        : { messages: [], total: 0 };
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
async function listGroupTaskMessages(ctx, chairSlug, taskId, opts) {
    const chair = await requireProfile(ctx, chairSlug);
    const store = storeFor(ctx, chair);
    const task = await requireTask(store, taskId);
    if (!task.groupId)
        return { messages: [], total: 0 };
    if (opts?.sync !== false) {
        await syncGroupTaskMessages(ctx, store, task);
    }
    return store.listMessages(task.groupId, {
        limit: opts?.limit,
        beforeIndex: opts?.beforeIndex,
    });
}
async function postGroupTaskMessage(ctx, chairSlug, taskId, input) {
    const chair = await requireProfile(ctx, chairSlug);
    const store = storeFor(ctx, chair);
    const task = await requireRunnableTask(store, taskId);
    const content = input.content?.trim();
    if (!content)
        throw new GroupTaskServiceError('content_required', 'content is required');
    if (input.asOwner) {
        const owner = await ctx.ownerIdentity();
        if (!owner) {
            throw new GroupTaskServiceError('owner_missing', 'No local owner identity; create one with `metabot user ensure` first');
        }
        await ensureOwnerJoinedGroup(ctx, store, task.groupId);
        return (0, transport_1.sendGroupMessageOnChain)(owner.signer, task.groupId, {
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
        throw new GroupTaskServiceError('not_a_member', `Bot ${senderSlug} is not a member of group task ${taskId}`);
    }
    const senderProfile = await requireProfile(ctx, senderSlug);
    const signer = await ctx.signerForSlug(senderSlug);
    return (0, transport_1.sendGroupMessageOnChain)(signer, task.groupId, {
        content,
        nickName: senderProfile.name.trim() || senderSlug,
        replyPin: input.replyPin,
        mention: input.mention,
    });
}
// ---------------------------------------------------------------------------
// Lifecycle: close / reopen / rework
// ---------------------------------------------------------------------------
async function closeGroupTask(ctx, chairSlug, taskId, opts) {
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
    }
    catch (error) {
        logOf(ctx)(`[GroupTask] Failed to cancel open checkpoints on close of task ${taskId}: `
            + `${error instanceof Error ? error.message : String(error)}`);
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
    }
    catch {
        // No summary yet (task closed before review) — nothing to finalize.
    }
    // Chair→member impression sedimentation (staffing memory); best-effort.
    try {
        const members = await store.listMembers(taskId);
        await (0, impressions_1.recordTaskCloseImpressions)(ctx, chairSlug, closed, members, opts.status);
    }
    catch (error) {
        logOf(ctx)(`[GroupTask] Impression sedimentation failed on close of task ${taskId}: `
            + `${error instanceof Error ? error.message : String(error)}`);
    }
    await emitGroupTaskRelay(ctx, chair, closed, 'closed', `Task closed as ${opts.status}`
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
async function reopenGroupTask(ctx, chairSlug, taskId, opts) {
    const chair = await requireProfile(ctx, chairSlug);
    const store = storeFor(ctx, chair);
    const task = await requireTask(store, taskId);
    if (task.status !== 'review') {
        throw new GroupTaskServiceError('not_in_review', `Group task ${taskId} is ${task.status}; only review tasks can be reopened to executing`);
    }
    await store.updateTaskStatus(taskId, 'executing', {
        actor: opts?.actor ?? { kind: 'owner' },
        reason: opts?.reason ?? null,
    });
    await clearGroupTaskReviewDeliveryGuards(store, taskId);
    await store.kvSet(`${exports.GROUP_TASK_REWORK_AT_KV_PREFIX}${taskId}`, String(Date.now()));
    try {
        await store.updateDeliverablesStatusByTask(taskId, 'pending', 'rejected');
    }
    catch (error) {
        logOf(ctx)(`[GroupTask] Deliverable reject backfill failed for task ${taskId}: `
            + `${error instanceof Error ? error.message : String(error)}`);
    }
    return getGroupTaskDetail(ctx, chairSlug, taskId, { sync: false });
}
// ---------------------------------------------------------------------------
// Source-session relay ("哪里发起哪里结束")
// ---------------------------------------------------------------------------
/** Relay store for a profile (memoization unnecessary: rows are append/drain). */
function relayStoreFor(ctx, profile) {
    if (ctx.relayStoreForProfile)
        return ctx.relayStoreForProfile(profile);
    return (0, relayStore_1.createGroupTaskRelayStore)((0, paths_1.resolveMetabotPaths)(profile.homeDir));
}
/** Engine kv carrying a pending owner nudge (supervise → engine chair turn). */
exports.GROUP_TASK_NUDGE_REQUEST_KV_PREFIX = 'group_task_nudge_request:';
/**
 * Record one milestone row for the origin chat. Tasks created outside the
 * staffing flow have no source session and never emit. Best-effort: relay
 * failures must never fail the underlying task operation.
 */
async function emitGroupTaskRelay(ctx, chair, task, kind, text) {
    const sessionId = task.sourceSessionId?.trim();
    if (!sessionId)
        return;
    try {
        await relayStoreFor(ctx, chair).add({
            taskId: task.id,
            groupId: task.groupId,
            sessionId,
            kind,
            title: task.title,
            text,
        });
    }
    catch (error) {
        logOf(ctx)(`[GroupTask] Relay emit failed for task ${task.id} (${kind}): `
            + `${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Drain pending relay rows across every profile (or one chair): returns the
 * rows and marks them drained atomically per profile. The DSH host calls this
 * on a timer and injects the rows into their origin sessions.
 */
async function drainGroupTaskRelay(ctx, chairSlug) {
    const profiles = chairSlug?.trim()
        ? [await requireProfile(ctx, chairSlug.trim())]
        : await ctx.listProfiles();
    const drained = [];
    for (const profile of profiles) {
        try {
            const rows = await relayStoreFor(ctx, profile).drain();
            for (const row of rows)
                drained.push({ ...row, chairSlug: profile.slug });
        }
        catch (error) {
            logOf(ctx)(`[GroupTask] Relay drain failed for profile ${profile.slug}: `
                + `${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return drained.sort((left, right) => left.createdAt - right.createdAt);
}
/**
 * Owner-side supervision. `nudge` queues a directive-driven chair turn (the
 * engine @-mentions the idle member); `flag` records an observation for the
 * acceptance stage; `pause`/`resume` gate the engine's dispatcher. All actions
 * are owner-authority, visible in-group through host supervisor notices.
 */
async function superviseGroupTask(ctx, chairSlug, taskId, input) {
    const action = input.action;
    if (!['nudge', 'flag', 'pause', 'resume'].includes(action)) {
        throw new GroupTaskServiceError('invalid_action', "action must be 'nudge', 'flag', 'pause', or 'resume'");
    }
    const chair = await requireProfile(ctx, chairSlug);
    const store = storeFor(ctx, chair);
    const task = await requireTask(store, taskId);
    if (types_1.GROUP_TASK_TERMINAL_STATUSES.has(task.status)) {
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
        await store.kvSet(`${exports.GROUP_TASK_NUDGE_REQUEST_KV_PREFIX}${taskId}`, JSON.stringify({
            kind: 'resume',
            at: Date.now(),
            attempts: 0,
        }));
        await emitGroupTaskRelay(ctx, chair, updated, 'resumed', 'The owner resumed this task; work continues.');
        return { task: updated, action, notice, nudgeQueued: true };
    }
    // nudge + flag address a member (nudge) or the whole room (flag).
    const members = await store.listMembers(taskId);
    let member = null;
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
        kind: 'nudge',
        memberSlug: target.slug,
        globalMetaId: target.globalMetaId,
        name: target.displayName ?? target.slug ?? target.globalMetaId,
        note: input.note?.trim() || null,
        at: Date.now(),
        attempts: 0,
    };
    await store.kvSet(`${exports.GROUP_TASK_NUDGE_REQUEST_KV_PREFIX}${taskId}`, JSON.stringify(nudge));
    return { task, action, notice: null, nudgeQueued: true };
}
// ---------------------------------------------------------------------------
// Deliverables: owner ledger maintenance
// ---------------------------------------------------------------------------
/** Lightweight task record read (manual-send gating and similar checks). */
async function getGroupTaskRecord(ctx, chairSlug, taskId) {
    const chair = await requireProfile(ctx, chairSlug);
    const store = storeFor(ctx, chair);
    return requireTask(store, taskId);
}
/** Owner-side ledger maintenance: drop a mis-reported deliverable row. */
async function deleteGroupTaskDeliverableEntry(ctx, chairSlug, taskId, deliverableId) {
    const chair = await requireProfile(ctx, chairSlug);
    const store = storeFor(ctx, chair);
    await requireTask(store, taskId);
    return { deleted: await store.deleteDeliverable(deliverableId) };
}
/**
 * Claim the oldest pending work request (optionally for one worker) across all
 * chair profiles, assembling a FRESH turn context at claim time (the request
 * row stores only the coordinates). Returns null when the queue is empty.
 */
async function claimGroupTaskWork(ctx, workerSlug) {
    const profiles = await ctx.listProfiles();
    const profileBySlug = new Map(profiles.map((profile) => [profile.slug, profile]));
    for (const profile of profiles) {
        const store = storeFor(ctx, profile);
        const pending = await store.listWorkRequests({ status: 'pending', ...(workerSlug ? { workerSlug } : {}) });
        for (const request of pending) {
            // Re-read under the write lock: only a still-pending row may be claimed.
            const fresh = await store.getWorkRequest(request.id);
            if (!fresh || fresh.status !== 'pending')
                continue;
            const claimed = await store.updateWorkRequest(request.id, { status: 'claimed' });
            if (!claimed)
                continue;
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
                : { messages: [] };
            const senderOf = (message) => message.senderName?.trim() || message.senderGlobalMetaId || 'unknown';
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
/**
 * Host-side turn completion: a non-empty handoff is posted on-chain AS the
 * worker (reply-threaded to the target message) and the request completes;
 * an error or empty handoff fails the request so the engine falls back to its
 * bare-LLM turn. Posting to a task that closed mid-work fails the request.
 */
async function submitGroupTaskWork(ctx, input) {
    for (const profile of await ctx.listProfiles()) {
        const store = storeFor(ctx, profile);
        const request = await store.getWorkRequest(input.requestId);
        if (!request)
            continue;
        if (request.status === 'completed') {
            return { status: 'completed', pinId: null, error: null };
        }
        const handoff = input.handoff?.trim() ?? '';
        const fail = async (error) => {
            await store.updateWorkRequest(request.id, {
                status: 'failed',
                error: error.slice(0, 500),
                dshSessionId: input.dshSessionId ?? null,
            });
            return { status: 'failed', pinId: null, error };
        };
        if (input.error?.trim())
            return fail(input.error.trim());
        if (!handoff)
            return fail('WORKER_EMPTY_HANDOFF: the worker session produced no handoff text');
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
        }
        catch (error) {
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
exports.KICK_CONFIRM_POLL_INTERVAL_MS = 2_000;
exports.KICK_CONFIRM_MAX_ATTEMPTS = 15;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function confirmChainRemoval(ctx, groupId, identities, pollIntervalMs = exports.KICK_CONFIRM_POLL_INTERVAL_MS, maxAttempts = exports.KICK_CONFIRM_MAX_ATTEMPTS) {
    const candidates = new Set(identities.map((value) => String(value ?? '').trim().toLowerCase()).filter(Boolean));
    if (candidates.size === 0)
        return false;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const members = await (0, transport_1.fetchGroupMembers)(groupId, ctx.transport).catch(() => null);
        if (members && !members.some((member) => candidates.has(member.trim().toLowerCase()))) {
            return true;
        }
        if (attempt < maxAttempts)
            await sleep(pollIntervalMs);
    }
    return false;
}
/**
 * Kick a member: the chair (group creator) signs the removeuser pin, the
 * member row is marked removed, and the chair posts a deterministic
 * moderation notice (no LLM). On-chain failure aborts before any store write.
 * Idempotent: an already-removed member sends no new pin but still re-checks
 * the chain state read-only.
 */
async function kickGroupTaskMember(ctx, chairSlug, taskId, input) {
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
        : [...all].reverse().find((candidate) => candidate.slug == null
            && (candidate.globalMetaId ?? '').trim().toLowerCase() === globalMetaId.toLowerCase());
    if (!member) {
        throw new GroupTaskServiceError('member_not_found', `${slug ? `Bot ${slug}` : `globalMetaId ${globalMetaId}`} is not a member of group task ${taskId}`);
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
        const chainRemovalConfirmed = await confirmChainRemoval(ctx, task.groupId, [removeMetaid, member.globalMetaId], input.confirmPollIntervalMs, input.confirmMaxAttempts);
        return { member, chainRemovalConfirmed };
    }
    const reason = input.reason?.trim() || undefined;
    const chairSigner = await ctx.signerForSlug(chair.slug);
    const { pinId } = await (0, transport_1.removeGroupMemberOnChain)(chairSigner, task.groupId, {
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
    await (0, impressions_1.recordKickImpression)(ctx, chairSlug, task, member).catch(() => undefined);
    // Deterministic moderation notice from the chair. A failed announcement
    // must not roll back the removal.
    try {
        const displayName = memberDisplayName(member, memberProfile?.name) || removeMetaid;
        await (0, transport_1.sendGroupMessageOnChain)(chairSigner, task.groupId, {
            content: `Moderation: ${displayName} has been removed from this group task by the owner.`
                + (reason ? ` Reason: ${reason}` : ''),
            nickName: chair.name.trim() || chair.slug,
        });
    }
    catch (error) {
        log(`[GroupTask] Moderation announcement failed for task ${taskId}: `
            + `${error instanceof Error ? error.message : String(error)}`);
    }
    // Remote OpenTeam member: send the one-way [OPENTEAM_KICK] envelope so the
    // guest side marks its membership left. Best-effort — the removal holds.
    if (member.slug == null && member.globalMetaId && ctx.sendPrivateMessage) {
        try {
            await ctx.sendPrivateMessage({
                fromSlug: chair.slug,
                toGlobalMetaId: member.globalMetaId,
                content: (0, openteam_1.buildOpenTeamKickMessage)({
                    v: 1,
                    groupId: task.groupId,
                    taskTitle: task.title,
                    reason: reason ?? '',
                }),
            });
        }
        catch (error) {
            log(`[GroupTask] OpenTeam kick notice failed for task ${taskId}: `
                + `${error instanceof Error ? error.message : String(error)}`);
        }
    }
    const chainRemovalConfirmed = await confirmChainRemoval(ctx, task.groupId, [removeMetaid, member.globalMetaId], input.confirmPollIntervalMs, input.confirmMaxAttempts);
    if (!chainRemovalConfirmed) {
        log(`[GroupTask] Kick of member ${member.id} in task ${taskId} not confirmed on-chain; `
            + 'the local removal holds and the indexer may just be lagging');
    }
    return { member: removed, chainRemovalConfirmed };
}
exports.GROUP_TASK_MEMBER_STATUSES = [
    'assigned',
    'working',
    'standby',
    'done',
    'unreachable',
];
async function setGroupTaskMemberStatus(ctx, chairSlug, taskId, input) {
    const chair = await requireProfile(ctx, chairSlug);
    const store = storeFor(ctx, chair);
    await requireTask(store, taskId);
    const updated = await store.setMemberStatus(taskId, input.slug ?? null, input.status, input.globalMetaId ?? null);
    if (!updated) {
        throw new GroupTaskServiceError('member_not_found', `Member not found in group task ${taskId}`);
    }
    return updated;
}
async function getGroupTaskMemberStatus(ctx, chairSlug, taskId) {
    const detail = await getGroupTaskDetail(ctx, chairSlug, taskId, { view: 'summary' });
    return detail.members;
}
// ---------------------------------------------------------------------------
// Local list housekeeping
// ---------------------------------------------------------------------------
async function renameGroupTask(ctx, chairSlug, taskId, displayName) {
    const chair = await requireProfile(ctx, chairSlug);
    return storeFor(ctx, chair).renameTask(taskId, displayName);
}
async function setGroupTaskPinned(ctx, chairSlug, taskId, pinned) {
    const chair = await requireProfile(ctx, chairSlug);
    return storeFor(ctx, chair).setTaskPinned(taskId, pinned);
}
async function archiveGroupTask(ctx, chairSlug, taskId) {
    const chair = await requireProfile(ctx, chairSlug);
    return storeFor(ctx, chair).archiveTask(taskId);
}
async function unarchiveGroupTask(ctx, chairSlug, taskId) {
    const chair = await requireProfile(ctx, chairSlug);
    return storeFor(ctx, chair).unarchiveTask(taskId);
}
