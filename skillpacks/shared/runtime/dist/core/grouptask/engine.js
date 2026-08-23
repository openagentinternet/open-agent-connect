"use strict";
/**
 * Group Task engine — the OAC port of the IDBots groupTaskDaemon: a 5-second
 * tick loop that drives every non-terminal task chaired by a local profile.
 * Per task and per tick it (1) claims the kv driver mutex, (2) stamps the
 * stall heartbeat, (3) syncs the transcript from the chain indexers,
 * (4) runs the one-shot chair planning turn, and (5) processes new messages
 * after the cursor: idempotent tag side effects, then turn-taking LLM replies
 * under cooldowns/budgets. Chain history is the only truth — the engine's own
 * posts are processed when they round-trip through the indexer sync.
 *
 * All seams (profiles, signers, stores, indexer fetch, LLM runner, persona
 * loader, clock) are injected so tests run fully offline.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GROUP_TASK_REVIEW_SUMMARY_KV_PREFIX = exports.GROUP_TASK_MSG_RETRY_KV_PREFIX = exports.GROUP_TASK_PLAN_ATTEMPTS_KV_PREFIX = exports.GROUP_TASK_PLANNED_KV_PREFIX = exports.GROUP_TASK_DRIVER_KV_PREFIX = void 0;
exports.createGroupTaskEngine = createGroupTaskEngine;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const paths_1 = require("../state/paths");
const store_1 = require("./store");
const service_1 = require("./service");
const openteam_1 = require("./openteam");
const transport_1 = require("./transport");
const backfill_1 = require("./backfill");
const privateChatStateStore_1 = require("../chat/privateChatStateStore");
const tags_1 = require("./tags");
const prompts_1 = require("./prompts");
const types_1 = require("./types");
// ---------------------------------------------------------------------------
// Constants (IDBots parity)
// ---------------------------------------------------------------------------
exports.GROUP_TASK_DRIVER_KV_PREFIX = 'group_task_driver:';
exports.GROUP_TASK_PLANNED_KV_PREFIX = 'group_task_chair_planned:';
exports.GROUP_TASK_PLAN_ATTEMPTS_KV_PREFIX = 'group_task_chair_plan_attempts:';
exports.GROUP_TASK_MSG_RETRY_KV_PREFIX = 'group_task_msg_retry:';
exports.GROUP_TASK_REVIEW_SUMMARY_KV_PREFIX = 'group_task_review_summary:';
const DEFAULT_INTERVAL_MS = 5_000;
const MIN_INTERVAL_MS = 1_000;
const DEFAULT_DRIVER_GRACE_MS = 20_000;
const DEFAULT_MAX_WORKER_REPLIES_PER_TICK = 3;
const DEFAULT_WORKER_COOLDOWN_MS = 20_000;
const DEFAULT_CHAIR_COOLDOWN_MS = 10_000;
const DEFAULT_REPLY_BUDGET = 40;
const MSG_RETRY_MAX_FAILURES = 5;
const PLAN_ATTEMPTS_MAX = 3;
const REVIEW_REENTRY_DEBOUNCE_MS = 30_000;
const MESSAGE_FETCH_LIMIT = 500;
const RUNNABLE_STATUSES = new Set(['planning', 'executing', 'review']);
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function storeFor(ctx, profile) {
    if (ctx.storeForProfile)
        return ctx.storeForProfile(profile);
    return (0, store_1.createGroupTaskStore)((0, paths_1.resolveMetabotPaths)(profile.homeDir));
}
function logOf(ctx) {
    return ctx.log ?? (() => undefined);
}
function normalizeGmid(value) {
    return (value ?? '').trim().toLowerCase();
}
async function readOptionalFile(filePath) {
    try {
        const text = (await node_fs_1.promises.readFile(filePath, 'utf8')).trim();
        return text || null;
    }
    catch {
        return null;
    }
}
async function defaultPersonaLoader(profile) {
    const paths = (0, paths_1.resolveMetabotPaths)(profile.homeDir);
    const [role, bio, soul, goal] = await Promise.all([
        readOptionalFile(paths.roleMdPath),
        readOptionalFile(paths.bioMdPath),
        readOptionalFile(paths.soulMdPath),
        readOptionalFile(paths.goalMdPath),
    ]);
    return { role, bio, soul, goal };
}
async function defaultInboundPrivateMessages(profile) {
    try {
        const store = (0, privateChatStateStore_1.createPrivateChatStateStore)((0, paths_1.resolveMetabotPaths)(profile.homeDir));
        const state = await store.readState();
        return state.messages
            .filter((message) => message.direction === 'inbound')
            .map((message) => ({
            messageId: message.messageId,
            senderGlobalMetaId: message.senderGlobalMetaId,
            content: message.content,
            timestamp: message.timestamp,
        }));
    }
    catch {
        return [];
    }
}
// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
function createGroupTaskEngine(options) {
    const ctx = options.ctx;
    const log = logOf(ctx);
    const now = options.now ?? (() => Date.now());
    const loadPersona = options.loadPersona ?? defaultPersonaLoader;
    const intervalMs = Math.max(MIN_INTERVAL_MS, options.intervalMs ?? DEFAULT_INTERVAL_MS);
    const driverGraceMs = options.driverGraceMs ?? DEFAULT_DRIVER_GRACE_MS;
    const maxWorkerRepliesPerTick = options.maxWorkerRepliesPerTick ?? DEFAULT_MAX_WORKER_REPLIES_PER_TICK;
    const workerCooldownMs = options.workerCooldownMs ?? DEFAULT_WORKER_COOLDOWN_MS;
    const chairCooldownMs = options.chairCooldownMs ?? DEFAULT_CHAIR_COOLDOWN_MS;
    const replyBudget = options.replyBudget ?? DEFAULT_REPLY_BUDGET;
    const instanceId = (0, node_crypto_1.randomUUID)();
    /** Lifetime reply counts and last-reply stamps per `${chair}:${task}:${slug}`. */
    const replyCounts = new Map();
    const lastReplyAt = new Map();
    let timer = null;
    let ticking = false;
    function seatKey(chairSlug, taskId, slug) {
        return `${chairSlug}:${taskId}:${slug}`;
    }
    // -------------------------------------------------------------------------
    // Driver mutex
    // -------------------------------------------------------------------------
    async function claimDriverOrYield(store, taskId) {
        if (driverGraceMs === 0)
            return true;
        const key = `${exports.GROUP_TASK_DRIVER_KV_PREFIX}${taskId}`;
        const raw = await store.kvGet(key);
        if (raw) {
            const [owner, stampRaw] = raw.split('|');
            const stamp = Number(stampRaw);
            if (owner === instanceId)
                return true; // own claim; refreshed only on post
            if (Number.isFinite(stamp) && now() - stamp < driverGraceMs)
                return false;
        }
        await store.kvSet(key, `${instanceId}|${now()}`);
        return true;
    }
    async function refreshDriverClaim(store, taskId) {
        if (driverGraceMs === 0)
            return;
        await store.kvSet(`${exports.GROUP_TASK_DRIVER_KV_PREFIX}${taskId}`, `${instanceId}|${now()}`);
    }
    // -------------------------------------------------------------------------
    // Seats & prompts
    // -------------------------------------------------------------------------
    async function buildSeats(task, members, profileBySlug) {
        const seats = [];
        const promptSeats = [];
        for (const member of members) {
            if (member.removedAt != null)
                continue;
            const profile = member.slug ? profileBySlug.get(member.slug) : undefined;
            const name = member.displayName?.trim() || profile?.name || member.slug || member.globalMetaId || 'member';
            promptSeats.push({ name, role: member.role, remote: member.slug == null });
            if (!member.slug || !profile)
                continue; // remote members never get local turns
            seats.push({
                slug: member.slug,
                role: member.role,
                name,
                globalMetaId: member.globalMetaId ?? profile.globalMetaId,
                metaId: profile.metaId,
                member,
                profile,
            });
        }
        const chair = seats.find((seat) => seat.role === 'chair') ?? null;
        return { seats, promptSeats, chair };
    }
    async function runSeatTurn(input) {
        const persona = await loadPersona(input.seat.profile).catch(() => ({}));
        const systemPrompt = (0, prompts_1.buildGroupTaskSystemPrompt)({
            identity: {
                name: input.seat.name,
                globalMetaId: input.seat.globalMetaId,
                role: persona.role,
                bio: persona.bio,
                soul: persona.soul,
                goal: persona.goal,
            },
            task: input.task,
            seats: input.promptSeats,
            chairName: input.chairName,
            ownerGlobalMetaId: input.ownerGmid,
            role: input.seat.role,
        });
        const prompt = input.promptOverride ?? (0, prompts_1.buildGroupTaskTurnContext)({
            task: input.task,
            recentMessages: input.recentMessages,
            target: input.target,
            nowMs: now(),
        });
        return options.runLlmTurn({
            profile: input.seat.profile,
            role: input.seat.role,
            systemPrompt,
            prompt,
        });
    }
    // -------------------------------------------------------------------------
    // Tag side effects (idempotent; safe to re-run on message retry)
    // -------------------------------------------------------------------------
    async function hasOpenCheckpoint(store, taskId) {
        const checkpoints = await store.listCheckpoints(taskId);
        return checkpoints.some((checkpoint) => checkpoint.status === 'open');
    }
    async function postHostNotice(task, chairSlug, content) {
        try {
            await (0, service_1.postGroupTaskMessage)(ctx, chairSlug, task.id, { content });
        }
        catch (error) {
            log(`[GroupTaskEngine] Host notice failed for task ${task.id}: `
                + `${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async function applyChairStatusTag(store, task, chairSlug, target, message) {
        if (task.status === target)
            return task;
        if (!types_1.GROUP_TASK_LEGAL_TRANSITIONS[task.status].includes(target))
            return task;
        if (target === 'review' && task.status === 'executing') {
            const reworkRaw = await store.kvGet(`${service_1.GROUP_TASK_REWORK_AT_KV_PREFIX}${task.id}`);
            const reworkAt = Number(reworkRaw);
            if (Number.isFinite(reworkAt) && now() - reworkAt < REVIEW_REENTRY_DEBOUNCE_MS) {
                return task; // stale review re-entry right after a rework
            }
        }
        const updated = await store.updateTaskStatus(task.id, target, {
            actor: { kind: 'chair', globalMetaId: message.senderGlobalMetaId, name: message.senderName },
            reason: `[STATUS:${target.toUpperCase()}]`,
        });
        if (target === 'executing' && task.status === 'review') {
            await store.kvSet(`${service_1.GROUP_TASK_REWORK_AT_KV_PREFIX}${task.id}`, String(now()));
            await (0, service_1.clearGroupTaskReviewDeliveryGuards)(store, task.id);
            await store.kvDelete(`${exports.GROUP_TASK_REVIEW_SUMMARY_KV_PREFIX}${task.id}`);
        }
        if (target === 'review') {
            await store.kvDelete(`${service_1.GROUP_TASK_REWORK_AT_KV_PREFIX}${task.id}`);
            await store.closeOpenCheckpoints(task.id, 'resolved', 'superseded by review entry');
            await runReviewCeremony(store, updated, chairSlug, message);
        }
        return updated;
    }
    async function runReviewCeremony(store, task, chairSlug, reviewMessage) {
        const guardKey = `${exports.GROUP_TASK_REVIEW_SUMMARY_KV_PREFIX}${task.id}`;
        if (await store.kvGet(guardKey))
            return;
        const members = await store.listMembers(task.id);
        const deliverables = await store.listDeliverables(task.id);
        const planChanges = await store.listPlanChanges(task.id);
        const conclusion = reviewMessage.content
            .replace(/\[[A-Z_]+(?::[^\]]*)?\]/gu, '')
            .replace(/\s+/gu, ' ')
            .trim()
            .slice(0, 300) || null;
        await store.addAcceptanceSummary({
            taskId: task.id,
            goal: task.goal,
            acceptanceCriteria: task.acceptanceCriteria,
            deliverables: deliverables.map((row) => ({
                kind: row.kind,
                uri: row.uri,
                status: row.status,
                confirmation: row.confirmation,
                authorName: null,
            })),
            members: members
                .filter((member) => member.removedAt == null)
                .map((member) => ({
                name: member.displayName ?? member.slug,
                role: member.role,
                workStatus: member.status,
            })),
            planChanges: planChanges.map((change) => change.summary),
            guidance: 'Review the deliverables against the acceptance criteria, then accept & close or send the task back to work.',
            conclusion,
            outcome: null,
            rating: null,
            ratingComment: null,
            generatedBy: 'grouptask-engine',
            publishedGroupPinId: null,
        });
        const lines = [
            '[GROUP_TASK_NOTICE:review_summary] Task entered review — owner acceptance requested.',
            `Goal: ${task.goal}`,
            `Acceptance criteria: ${task.acceptanceCriteria ?? '(none specified)'}`,
        ];
        if (deliverables.length > 0) {
            lines.push('Deliverables:');
            for (const row of deliverables) {
                lines.push(`- [${row.status}] ${row.kind ?? 'text'}${row.uri ? ` ${row.uri}` : ''}`);
            }
        }
        if (planChanges.length > 0) {
            lines.push('Plan changes:');
            for (const change of planChanges)
                lines.push(`- ${change.summary}`);
        }
        await postHostNotice(task, chairSlug, lines.join('\n'));
        await store.kvSet(guardKey, String(now()));
    }
    async function applyTagSideEffects(store, task, chairSlug, message, tags, seats) {
        if (message.senderSuspect)
            return task;
        const senderGmid = normalizeGmid(message.senderGlobalMetaId);
        const chairSeat = seats.find((seat) => seat.role === 'chair') ?? null;
        const fromChair = chairSeat !== null && normalizeGmid(chairSeat.globalMetaId) === senderGmid;
        const senderSeat = seats.find((seat) => normalizeGmid(seat.globalMetaId) === senderGmid) ?? null;
        let current = task;
        // Chair-only tags
        if (fromChair) {
            for (const summary of tags.planChanges) {
                const existing = await store.listPlanChanges(task.id);
                const duplicate = existing.some((change) => change.summary === summary && (change.msgPinId ?? null) === (message.pinId ?? null));
                if (!duplicate) {
                    await store.addPlanChange({
                        taskId: task.id,
                        msgPinId: message.pinId,
                        authorGlobalMetaId: message.senderGlobalMetaId,
                        summary,
                    });
                }
            }
            if (tags.checkpointResolved) {
                const resolved = await store.resolveCheckpoint(task.id, tags.checkpointDecision, message.pinId);
                if (resolved) {
                    await postHostNotice(current, chairSlug, `[GROUP_TASK_NOTICE:checkpoint_resolved] Checkpoint resolved${tags.checkpointDecision ? `: ${tags.checkpointDecision}` : ''}. Work resumes.`);
                }
            }
            else if (tags.checkpointTopic
                && current.status !== 'review'
                && !(await hasOpenCheckpoint(store, task.id))) {
                await store.openCheckpoint(task.id, tags.checkpointTopic, message.pinId);
                await postHostNotice(current, chairSlug, `[GROUP_TASK_NOTICE:checkpoint_open] Task paused — waiting for the owner: ${tags.checkpointTopic}`);
            }
            if (tags.status) {
                current = await applyChairStatusTag(store, current, chairSlug, tags.status, message);
            }
        }
        // Member tags (non-chair local members)
        if (senderSeat && !fromChair) {
            if (tags.deliverables.length > 0 && message.pinId) {
                const alreadyRecorded = await store.hasDeliverableWithMsgPin(task.id, message.pinId);
                if (!alreadyRecorded) {
                    for (const candidate of tags.deliverables) {
                        await store.addDeliverable({
                            taskId: task.id,
                            msgPinId: message.pinId,
                            authorGlobalMetaId: message.senderGlobalMetaId,
                            kind: candidate.kind,
                            uri: candidate.uri,
                        });
                    }
                }
            }
            if (tags.working) {
                await store.setMemberStatus(task.id, senderSeat.slug, 'working', senderSeat.globalMetaId);
            }
            else if (tags.standby) {
                await store.setMemberStatus(task.id, senderSeat.slug, 'standby', senderSeat.globalMetaId);
            }
        }
        return current;
    }
    /**
     * Run the decided reply turns for one message. Returns 'done' when the
     * message is fully handled, 'defer' when a cap/cooldown blocked a decided
     * responder (the cursor must NOT advance so the reply retries next tick).
     */
    async function runReplies(input) {
        for (const decision of input.decisions) {
            const seat = input.seats.find((entry) => entry.slug === decision.slug);
            if (!seat)
                continue;
            const key = seatKey(input.chairSlug, input.task.id, seat.slug);
            const spent = replyCounts.get(key) ?? 0;
            if (spent >= replyBudget)
                continue; // budget exhausted: drop, never defer
            if (decision.role === 'worker' && input.counters.workerReplies >= maxWorkerRepliesPerTick) {
                return 'defer';
            }
            if (decision.role === 'chair' && decision.reason !== 'chair_mentioned'
                && input.counters.chairAutoReplies >= 1) {
                return 'defer';
            }
            const cooldown = decision.role === 'chair' ? chairCooldownMs : workerCooldownMs;
            const last = lastReplyAt.get(key) ?? 0;
            if (now() - last < cooldown)
                return 'defer';
            const reply = (await runSeatTurn({
                seat,
                task: input.task,
                promptSeats: input.promptSeats,
                chairName: input.chairName,
                ownerGmid: input.ownerGmid,
                recentMessages: input.recentMessages,
                target: input.message,
            })).trim();
            replyCounts.set(key, spent + 1);
            lastReplyAt.set(key, now());
            if (decision.role === 'worker')
                input.counters.workerReplies += 1;
            else if (decision.reason !== 'chair_mentioned')
                input.counters.chairAutoReplies += 1;
            if (!reply || (0, tags_1.isNoReplyResponse)(reply))
                continue;
            await (0, service_1.postGroupTaskMessage)(ctx, input.chairSlug, input.task.id, {
                content: reply,
                asSlug: seat.slug,
                replyPin: input.message.pinId ?? undefined,
            });
            await refreshDriverClaim(input.store, input.task.id);
        }
        return 'done';
    }
    // -------------------------------------------------------------------------
    // Planning turn
    // -------------------------------------------------------------------------
    async function runPlanningTurn(input) {
        const { store, task } = input;
        const plannedKey = `${exports.GROUP_TASK_PLANNED_KV_PREFIX}${task.id}`;
        if (await store.kvGet(plannedKey))
            return;
        const attemptsKey = `${exports.GROUP_TASK_PLAN_ATTEMPTS_KV_PREFIX}${task.id}`;
        const attempts = Number((await store.kvGet(attemptsKey)) ?? '0') || 0;
        if (attempts >= PLAN_ATTEMPTS_MAX)
            return;
        await store.kvSet(attemptsKey, String(attempts + 1));
        const directive = (0, prompts_1.buildPlanningDirective)({
            task,
            seats: input.promptSeats,
            recentMessages: input.recentMessages,
            nowMs: now(),
        });
        const reply = (await runSeatTurn({
            seat: input.chair,
            task,
            promptSeats: input.promptSeats,
            chairName: input.chair.name,
            ownerGmid: input.ownerGmid,
            recentMessages: input.recentMessages,
            target: null,
            promptOverride: directive,
        })).trim();
        if (!reply || (0, tags_1.isNoReplyResponse)(reply))
            return; // counts as a failed attempt
        await (0, service_1.postGroupTaskMessage)(ctx, input.chairSlug, task.id, { content: reply });
        await store.kvSet(plannedKey, String(now()));
        await refreshDriverClaim(store, task.id);
    }
    // -------------------------------------------------------------------------
    // Per-task drive
    // -------------------------------------------------------------------------
    async function driveTask(profile, store, task, profileBySlug, ownerGmid) {
        if (!task.groupId)
            return;
        if (!(await claimDriverOrYield(store, task.id)))
            return;
        await store.touchTaskDriven(task.id, now());
        await (0, service_1.syncGroupTaskMessages)(ctx, store, task);
        const members = await store.listMembers(task.id, { includeRemoved: true });
        const { seats, promptSeats, chair } = await buildSeats(task, members, profileBySlug);
        const chairName = chair?.name ?? profile.name;
        const page = await store.listMessages(task.groupId, { limit: MESSAGE_FETCH_LIMIT });
        let current = task;
        if (current.status === 'planning' && chair) {
            try {
                await runPlanningTurn({
                    store,
                    task: current,
                    chair,
                    chairSlug: profile.slug,
                    promptSeats,
                    ownerGmid,
                    recentMessages: page.messages,
                });
            }
            catch (error) {
                log(`[GroupTaskEngine] Planning turn failed for task ${current.id}: `
                    + `${error instanceof Error ? error.message : String(error)}`);
            }
        }
        const pending = page.messages.filter((message) => message.index > current.lastProcessedIndex);
        const counters = { workerReplies: 0, chairAutoReplies: 0 };
        for (const message of pending) {
            const retryKey = `${exports.GROUP_TASK_MSG_RETRY_KV_PREFIX}${current.id}:${message.index}`;
            try {
                const tags = (0, tags_1.parseGroupTaskTags)(message.content);
                current = await applyTagSideEffects(store, current, profile.slug, message, tags, seats);
                if (current.status === 'done' || current.status === 'cancelled') {
                    await store.updateTaskCursor(current.id, message.index);
                    break;
                }
                const decisions = (0, tags_1.decideGroupTaskResponders)({
                    message,
                    taskStatus: current.status,
                    hasOpenCheckpoint: await hasOpenCheckpoint(store, current.id),
                    seats,
                    ownerGlobalMetaId: ownerGmid,
                });
                const recentMessages = page.messages.filter((entry) => entry.index <= message.index);
                const outcome = await runReplies({
                    store,
                    task: current,
                    chairSlug: profile.slug,
                    message,
                    decisions,
                    seats,
                    promptSeats,
                    chairName,
                    ownerGmid,
                    recentMessages,
                    counters,
                });
                if (outcome === 'defer')
                    break; // cursor stays put; retry next tick
                await store.updateTaskCursor(current.id, message.index);
                await store.kvDelete(retryKey);
            }
            catch (error) {
                const failures = (Number((await store.kvGet(retryKey)) ?? '0') || 0) + 1;
                await store.kvSet(retryKey, String(failures));
                log(`[GroupTaskEngine] Message ${message.index} of task ${current.id} failed `
                    + `(${failures}/${MSG_RETRY_MAX_FAILURES}): ${error instanceof Error ? error.message : String(error)}`);
                if (failures >= MSG_RETRY_MAX_FAILURES) {
                    // Poison message: give up on replies, keep the cursor moving.
                    await store.updateTaskCursor(current.id, message.index);
                    await store.kvDelete(retryKey);
                    continue;
                }
                break; // fail-stop: later messages wait for this one
            }
        }
    }
    // -------------------------------------------------------------------------
    // OpenTeam: envelope scan (both sides)
    // -------------------------------------------------------------------------
    const inboundReader = options.readInboundPrivateMessages ?? defaultInboundPrivateMessages;
    async function declineGuestInvite(profile, openteam, payload, status, reason) {
        await openteam.createGuestInvite({
            groupId: payload.groupId,
            inviteId: payload.inviteId,
            inviterGlobalMetaId: payload.inviterGlobalMetaId,
            inviterName: payload.inviterName || null,
            taskTitle: payload.taskTitle,
            goalSummary: payload.goalSummary || null,
            requiredSkills: payload.requiredSkills,
            targetGlobalMetaId: payload.targetGlobalMetaId,
            expiresAt: payload.expiresAt,
            status,
            declineReason: reason,
        });
        if (status === 'skipped' || !ctx.sendPrivateMessage)
            return;
        try {
            await ctx.sendPrivateMessage({
                fromSlug: profile.slug,
                toGlobalMetaId: payload.inviterGlobalMetaId,
                content: (0, openteam_1.buildOpenTeamDeclineMessage)(payload.inviteId, reason),
            });
        }
        catch (error) {
            log(`[OpenTeam] Decline reply failed for invite ${payload.inviteId}: `
                + `${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Guest-side invite handling (IDBots openTeamGuestService parity):
     * validate → sign simplegroupjoin OURSELVES → membership → ACCEPT reply.
     * Auto-accept; the only silent skips are duplicates and foreign targets.
     */
    async function handleGuestInvite(profile, openteam, message, payload) {
        if (await openteam.getGuestInviteByInviteId(payload.inviteId))
            return; // duplicate
        if (!ctx.sendPrivateMessage) {
            log('[OpenTeam] Private-message sending is not wired; ignoring inbound invite');
            return;
        }
        const selfGmid = normalizeGmid(profile.globalMetaId);
        if (!selfGmid || normalizeGmid(payload.targetGlobalMetaId) !== selfGmid) {
            await declineGuestInvite(profile, openteam, payload, 'skipped', 'target_mismatch');
            return;
        }
        const senderGmid = normalizeGmid(message.senderGlobalMetaId);
        if (senderGmid && senderGmid !== normalizeGmid(payload.inviterGlobalMetaId)) {
            await declineGuestInvite(profile, openteam, payload, 'declined', 'inviter_mismatch');
            return;
        }
        const membership = await openteam.getMembership(payload.groupId, profile.slug);
        if (membership?.status === 'active') {
            await declineGuestInvite(profile, openteam, payload, 'declined', 'already_member');
            return;
        }
        if (payload.expiresAt + openteam_1.OPENTEAM_EXPIRY_SKEW_SECONDS < Math.floor(now() / 1000)) {
            await declineGuestInvite(profile, openteam, payload, 'expired', 'invite_expired');
            return;
        }
        const info = await (0, transport_1.fetchGroupInfo)(payload.groupId, ctx.transport);
        if (info.status === 'not_found') {
            await declineGuestInvite(profile, openteam, payload, 'declined', 'invalid_group');
            return;
        }
        if (info.status === 'error') {
            throw new Error(`Group verification failed for ${payload.groupId} (indexer unreachable)`);
        }
        const creator = normalizeGmid(info.info.createUserGlobalMetaId)
            || normalizeGmid(info.info.createUserMetaId);
        if (!creator || creator !== normalizeGmid(payload.inviterGlobalMetaId)) {
            await declineGuestInvite(profile, openteam, payload, 'declined', 'inviter_not_chair');
            return;
        }
        const signer = await ctx.signerForSlug(profile.slug);
        const { pinId: joinedPinId } = await (0, transport_1.joinGroupOnChain)(signer, payload.groupId);
        await openteam.createGuestInvite({
            groupId: payload.groupId,
            inviteId: payload.inviteId,
            inviterGlobalMetaId: payload.inviterGlobalMetaId,
            inviterName: payload.inviterName || null,
            taskTitle: payload.taskTitle,
            goalSummary: payload.goalSummary || null,
            requiredSkills: payload.requiredSkills,
            targetGlobalMetaId: payload.targetGlobalMetaId,
            expiresAt: payload.expiresAt,
            status: 'accepted',
            joinedPinId,
        });
        await openteam.createMembership({
            groupId: payload.groupId,
            slug: profile.slug,
            inviterGlobalMetaId: payload.inviterGlobalMetaId,
            inviterName: payload.inviterName || null,
            taskTitle: payload.taskTitle,
            goalSummary: payload.goalSummary || null,
            inviteId: payload.inviteId,
            joinedPinId,
        });
        await ctx.sendPrivateMessage({
            fromSlug: profile.slug,
            toGlobalMetaId: payload.inviterGlobalMetaId,
            content: (0, openteam_1.buildOpenTeamAcceptMessage)(payload.inviteId, joinedPinId),
        });
    }
    async function scanOpenTeamEnvelopes(profile, openteam) {
        const messages = await inboundReader(profile);
        for (const message of messages) {
            if (!message.content.includes('[OPENTEAM_'))
                continue;
            const guardKey = `openteam_processed:${message.messageId}`;
            if (await openteam.kvGet(guardKey))
                continue;
            const retryKey = `openteam_env_retry:${message.messageId}`;
            try {
                const envelope = (0, openteam_1.parseOpenTeamEnvelope)(message.content);
                if (envelope?.kind === 'invite') {
                    await handleGuestInvite(profile, openteam, message, envelope.payload);
                }
                else if (envelope?.kind === 'accept') {
                    const invite = await openteam.getInviteByInviteId(envelope.inviteId);
                    if (invite && invite.status === 'pending'
                        && normalizeGmid(message.senderGlobalMetaId) === normalizeGmid(invite.inviteeGlobalMetaId)) {
                        await openteam.updateInvite(envelope.inviteId, {
                            status: 'accepted',
                            joinedPinId: envelope.joinedPinId,
                            respondedAt: now(),
                        });
                    }
                }
                else if (envelope?.kind === 'decline') {
                    const invite = await openteam.getInviteByInviteId(envelope.inviteId);
                    if (invite && invite.status === 'pending'
                        && normalizeGmid(message.senderGlobalMetaId) === normalizeGmid(invite.inviteeGlobalMetaId)) {
                        await openteam.updateInvite(envelope.inviteId, {
                            status: 'declined',
                            declineReason: envelope.reason || null,
                            respondedAt: now(),
                        });
                    }
                }
                else if (envelope?.kind === 'kick') {
                    const membership = await openteam.getMembership(envelope.payload.groupId, profile.slug);
                    if (membership?.status === 'active') {
                        await openteam.leaveMembership(envelope.payload.groupId, profile.slug, 'kick', envelope.payload.reason || null);
                    }
                }
                await openteam.kvSet(guardKey, String(now()));
                await openteam.kvDelete(retryKey);
            }
            catch (error) {
                const failures = (Number((await openteam.kvGet(retryKey)) ?? '0') || 0) + 1;
                await openteam.kvSet(retryKey, String(failures));
                log(`[OpenTeam] Envelope ${message.messageId} failed (${failures}/${MSG_RETRY_MAX_FAILURES}): `
                    + `${error instanceof Error ? error.message : String(error)}`);
                if (failures >= MSG_RETRY_MAX_FAILURES) {
                    await openteam.kvSet(guardKey, `failed:${now()}`);
                    await openteam.kvDelete(retryKey);
                }
            }
        }
    }
    // -------------------------------------------------------------------------
    // OpenTeam: inviter maintenance (expiry + join confirmation + welcome)
    // -------------------------------------------------------------------------
    async function maintainInviterInvites(profile, openteam) {
        const invites = await openteam.listInvites();
        for (const invite of invites) {
            if (invite.status === 'pending'
                && now() > invite.expiresAt * 1000 + openteam_1.OPENTEAM_PENDING_MARGIN_MS) {
                await openteam.updateInvite(invite.inviteId, {
                    status: 'expired',
                    declineReason: 'invite_response_timeout',
                });
                continue;
            }
            if (invite.status !== 'accepted' || invite.memberAddedAt != null)
                continue;
            const respondedAt = invite.respondedAt ?? invite.createdAt;
            if (now() > respondedAt + openteam_1.OPENTEAM_JOIN_CONFIRM_TIMEOUT_MS) {
                await openteam.updateInvite(invite.inviteId, {
                    status: 'expired',
                    declineReason: 'join_confirm_timeout',
                });
                continue;
            }
            let memberIds = null;
            try {
                memberIds = await (0, transport_1.fetchGroupMembers)(invite.groupId, ctx.transport);
            }
            catch {
                memberIds = null;
            }
            const joined = (memberIds ?? []).some((id) => normalizeGmid(id) === normalizeGmid(invite.inviteeGlobalMetaId));
            if (!joined)
                continue;
            const store = storeFor(ctx, profile);
            const task = await store.getTaskById(invite.taskId);
            if (!task) {
                await openteam.updateInvite(invite.inviteId, { memberAddedAt: now() });
                continue;
            }
            const members = await store.listMembers(invite.taskId);
            const alreadySeated = members.some((member) => normalizeGmid(member.globalMetaId) === normalizeGmid(invite.inviteeGlobalMetaId));
            if (!alreadySeated) {
                await store.addMember({
                    taskId: invite.taskId,
                    slug: null,
                    globalMetaId: invite.inviteeGlobalMetaId,
                    role: 'worker',
                    joinedPinId: invite.joinedPinId,
                    displayName: invite.inviteeName,
                });
                const skills = invite.requiredSkills.length > 0
                    ? ` (skills: ${invite.requiredSkills.join(', ')})`
                    : '';
                await postHostNotice(task, profile.slug, `[GROUP_TASK_NOTICE:openteam_joined] ${invite.inviteeName || invite.inviteeGlobalMetaId} `
                    + `joined this task as a remote OpenTeam member${skills}.`);
            }
            await openteam.updateInvite(invite.inviteId, { memberAddedAt: now() });
        }
    }
    // -------------------------------------------------------------------------
    // OpenTeam: guest replies (@-mention only, from this machine)
    // -------------------------------------------------------------------------
    async function runGuestReplies(profile, openteam, membership) {
        const store = storeFor(ctx, profile);
        try {
            const memberIds = await (0, transport_1.fetchGroupMembers)(membership.groupId, ctx.transport);
            await (0, backfill_1.syncGroupMessages)({
                store,
                groupId: membership.groupId,
                trustedGlobalMetaIds: new Set((memberIds ?? []).map((id) => normalizeGmid(id))),
                transport: ctx.transport,
            });
        }
        catch {
            return; // indexer down: retry next tick
        }
        const selfGmid = normalizeGmid(profile.globalMetaId);
        const mentionTarget = {
            name: profile.name,
            globalMetaId: profile.globalMetaId,
            metaId: profile.metaId,
        };
        const budgetKey = `guest:${membership.groupId}:${profile.slug}`;
        const page = await store.listMessages(membership.groupId, { limit: MESSAGE_FETCH_LIMIT });
        const pending = page.messages.filter((message) => message.index > membership.lastProcessedIndex);
        for (const message of pending) {
            const senderGmid = normalizeGmid(message.senderGlobalMetaId);
            const wantsReply = !message.senderSuspect
                && senderGmid !== selfGmid
                && !(0, tags_1.isHostNotice)(message.content)
                && (0, tags_1.isMentioned)(message, mentionTarget);
            if (!wantsReply) {
                await openteam.updateMembershipCursor(membership.groupId, profile.slug, message.index);
                continue;
            }
            const spent = replyCounts.get(budgetKey) ?? 0;
            if (spent >= replyBudget) {
                await openteam.updateMembershipCursor(membership.groupId, profile.slug, message.index);
                continue;
            }
            const last = lastReplyAt.get(budgetKey) ?? 0;
            if (now() - last < workerCooldownMs)
                break; // defer; cursor stays put
            const retryKey = `openteam_msg_retry:${membership.groupId}:${message.index}`;
            try {
                const persona = await loadPersona(profile).catch(() => ({}));
                const chairName = membership.inviterName || membership.inviterGlobalMetaId;
                const systemPrompt = (0, prompts_1.buildGroupTaskSystemPrompt)({
                    identity: {
                        name: profile.name,
                        globalMetaId: profile.globalMetaId,
                        role: persona.role,
                        bio: persona.bio,
                        soul: persona.soul,
                        goal: persona.goal,
                    },
                    task: {
                        title: membership.taskTitle,
                        goal: membership.goalSummary || membership.taskTitle,
                        acceptanceCriteria: null,
                    },
                    seats: [
                        { name: chairName, role: 'chair', remote: true },
                        { name: profile.name, role: 'worker', remote: false },
                    ],
                    chairName,
                    role: 'worker',
                });
                const prompt = (0, prompts_1.buildGroupTaskTurnContext)({
                    task: { id: membership.id, title: membership.taskTitle },
                    recentMessages: page.messages.filter((entry) => entry.index <= message.index),
                    target: message,
                    nowMs: now(),
                });
                const reply = (await options.runLlmTurn({
                    profile,
                    role: 'worker',
                    systemPrompt,
                    prompt,
                })).trim();
                replyCounts.set(budgetKey, spent + 1);
                lastReplyAt.set(budgetKey, now());
                if (reply && !(0, tags_1.isNoReplyResponse)(reply)) {
                    const signer = await ctx.signerForSlug(profile.slug);
                    await (0, transport_1.sendGroupMessageOnChain)(signer, membership.groupId, {
                        content: reply,
                        nickName: profile.name,
                        replyPin: message.pinId ?? undefined,
                    });
                }
                await openteam.updateMembershipCursor(membership.groupId, profile.slug, message.index);
                await openteam.kvDelete(retryKey);
            }
            catch (error) {
                const failures = (Number((await openteam.kvGet(retryKey)) ?? '0') || 0) + 1;
                await openteam.kvSet(retryKey, String(failures));
                log(`[OpenTeam] Guest reply at index ${message.index} of ${membership.groupId} failed `
                    + `(${failures}/${MSG_RETRY_MAX_FAILURES}): ${error instanceof Error ? error.message : String(error)}`);
                if (failures >= MSG_RETRY_MAX_FAILURES) {
                    await openteam.updateMembershipCursor(membership.groupId, profile.slug, message.index);
                    await openteam.kvDelete(retryKey);
                    continue;
                }
                break;
            }
        }
    }
    async function processOpenTeamForProfile(profile) {
        const openteam = (0, service_1.openteamStoreFor)(ctx, profile);
        await scanOpenTeamEnvelopes(profile, openteam);
        await maintainInviterInvites(profile, openteam);
        const memberships = await openteam.listMemberships({ activeOnly: true });
        for (const membership of memberships) {
            if (membership.slug !== profile.slug)
                continue;
            try {
                await runGuestReplies(profile, openteam, membership);
            }
            catch (error) {
                log(`[OpenTeam] Guest drive failed for group ${membership.groupId}: `
                    + `${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    // -------------------------------------------------------------------------
    // Tick
    // -------------------------------------------------------------------------
    async function tick() {
        if (ticking)
            return;
        ticking = true;
        try {
            const profiles = await ctx.listProfiles();
            const profileBySlug = new Map(profiles.map((entry) => [entry.slug, entry]));
            let ownerGmid = null;
            try {
                ownerGmid = (await ctx.ownerIdentity())?.globalMetaId ?? null;
            }
            catch {
                ownerGmid = null;
            }
            for (const profile of profiles) {
                let store;
                let tasks;
                try {
                    store = storeFor(ctx, profile);
                    tasks = await store.listTasks({ includeArchived: true });
                }
                catch {
                    continue;
                }
                const runnable = tasks.filter((task) => task.chairSlug === profile.slug && RUNNABLE_STATUSES.has(task.status));
                for (const task of runnable) {
                    try {
                        await driveTask(profile, store, task, profileBySlug, ownerGmid);
                    }
                    catch (error) {
                        log(`[GroupTaskEngine] Task ${task.id} drive failed: `
                            + `${error instanceof Error ? error.message : String(error)}`);
                    }
                }
                try {
                    await processOpenTeamForProfile(profile);
                }
                catch (error) {
                    log(`[OpenTeam] Profile ${profile.slug} processing failed: `
                        + `${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }
        finally {
            ticking = false;
        }
    }
    return {
        start() {
            if (timer)
                return;
            void tick().catch((error) => {
                log(`[GroupTaskEngine] Initial tick failed: ${error instanceof Error ? error.message : String(error)}`);
            });
            timer = setInterval(() => {
                void tick().catch((error) => {
                    log(`[GroupTaskEngine] Tick failed: ${error instanceof Error ? error.message : String(error)}`);
                });
            }, intervalMs);
            timer.unref?.();
        },
        stop() {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        },
        tick,
    };
}
