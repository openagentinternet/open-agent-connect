"use strict";
/**
 * Group Task engine — the OAC port of the IDBots groupTaskDaemon (single-
 * commander contract): a 5-second tick loop that drives every non-terminal
 * task chaired by a local profile. Per task and per tick it (1) claims the kv
 * driver mutex, (2) stamps the stall heartbeat, (3) syncs the transcript from
 * the chain indexers, (4) runs the one-shot chair planning turn, and (5)
 * processes new messages after the cursor: idempotent tag side effects, then
 * turn-taking LLM replies under cooldowns/budgets. Chain history is the only
 * truth — the engine's own posts are processed when they round-trip through
 * the indexer sync.
 *
 * SINGLE COMMANDER: the host is the environment, never a speaker — it never
 * posts into the group under any identity (the chair is the only coordinator;
 * workers and the human owner are the other participants). Host observations
 * (missing ACKs, rung deadlines, joins, parser verdicts, chain health) are
 * recorded as HOST NOTES (store.recordHostNote) and delivered to the chair in
 * ONE dedicated turn; the chair decides what the group needs to hear in its
 * own voice. Extension rule: if a change would make the host post into the
 * group, it is wrong by construction — record a host note and let the chair
 * decide. The single remaining host-directed group post is the deterministic
 * owner-confirmed kick moderation notice (service.kickGroupTaskMember).
 *
 * All seams (profiles, signers, stores, indexer fetch, LLM runner, persona
 * loader, clock) are injected so tests run fully offline.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GROUP_TASK_GUEST_SELF_CHECK_KV_PREFIX = exports.GROUP_TASK_REVIEW_SUMMARY_KV_PREFIX = exports.GROUP_TASK_HOST_NOTE_ATTEMPTS_KV_PREFIX = exports.GROUP_TASK_DEADLINE_KV_PREFIX = exports.GROUP_TASK_TIMEOUT_OWNER_KV_PREFIX = exports.GROUP_TASK_ACK_SEEN_KV_PREFIX = exports.GROUP_TASK_ACK_REMINDED_KV_PREFIX = exports.GROUP_TASK_ACK_PENDING_KV_PREFIX = exports.GROUP_TASK_DELIVERABLE_VERIFY_KV_PREFIX = exports.GROUP_TASK_WORK_REQ_KV_PREFIX = exports.GROUP_TASK_PLANNING_DEFERRED_KV_PREFIX = exports.GROUP_TASK_MSG_RETRY_KV_PREFIX = exports.GROUP_TASK_PLAN_ATTEMPTS_KV_PREFIX = exports.GROUP_TASK_PLANNED_KV_PREFIX = exports.GROUP_TASK_DRIVER_KV_PREFIX = void 0;
exports.createGroupTaskEngine = createGroupTaskEngine;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const paths_1 = require("../state/paths");
const store_1 = require("./store");
const service_1 = require("./service");
const openteam_1 = require("./openteam");
const transport_1 = require("./transport");
const backfill_1 = require("./backfill");
const deliverableVerification_1 = require("./deliverableVerification");
const uploadFile_1 = require("../files/uploadFile");
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
exports.GROUP_TASK_PLANNING_DEFERRED_KV_PREFIX = 'group_task_planning_deferred:';
exports.GROUP_TASK_WORK_REQ_KV_PREFIX = 'group_task_work_req:';
/**
 * Worker-session handoff (Phase 3): the engine defers a worker turn while a
 * DSH work request is outstanding. If the host never claims (plugin off) or
 * dies mid-turn, the TTLs expire the request and the bare-LLM fallback
 * replies instead — a missing host can never stall a task.
 */
const WORK_REQUEST_PENDING_TTL_MS = 8 * 60_000;
const WORK_REQUEST_CLAIMED_TTL_MS = 20 * 60_000;
/**
 * IDBots roster-settle cap: the one-shot planning turn waits at most this long
 * for OpenTeam invites to resolve before planning with whatever roster exists.
 */
const ROSTER_SETTLE_MAX_WAIT_MS = 10 * 60_000;
/** Deliverable re-verification cadence (indexer lag absorption). */
exports.GROUP_TASK_DELIVERABLE_VERIFY_KV_PREFIX = 'group_task_deliverable_verify:';
const DELIVERABLE_REVERIFY_INTERVAL_MS = 10 * 60_000;
// Assignment ACK watch + member monitors (single-commander: observations are
// recorded as host notes for the chair; the host never posts into the group).
exports.GROUP_TASK_ACK_PENDING_KV_PREFIX = 'group_task_ack_pending:';
exports.GROUP_TASK_ACK_REMINDED_KV_PREFIX = 'group_task_ack_reminded:';
exports.GROUP_TASK_ACK_SEEN_KV_PREFIX = 'group_task_ack_seen:';
exports.GROUP_TASK_TIMEOUT_OWNER_KV_PREFIX = 'group_task_timeout_owner:';
/**
 * Chair-stated step deadlines (single clock — IDBots single-commander): the
 * chair's [DEADLINE: Nm] tag on a dispatch arms one entry per mentioned worker
 * when that worker ACKs; a passed deadline without a [DELIVERABLE] records ONE
 * `deadline` host note (chasing/extending/re-assigning is the chair's call).
 */
exports.GROUP_TASK_DEADLINE_KV_PREFIX = 'group_task_deadline:';
/** Consecutive-failure budget for the host-notes delivery chair turn. */
exports.GROUP_TASK_HOST_NOTE_ATTEMPTS_KV_PREFIX = 'group_task_host_note_attempts:';
const HOST_NOTE_TURN_MAX_ATTEMPTS = 3;
const ACK_TIMEOUT_MS = 3 * 60_000;
const MEMBER_UNREACHABLE_AFTER_MS = 30 * 60_000;
const MEMBER_TIMEOUT_AFTER_MS = 20 * 60_000;
const MEMBER_ESCALATE_AFTER_MS = 10 * 60_000;
const ROLL_CALL_RE = /确认在线|请[^\n]{0,12}在线|roll.?call|presence check/i;
exports.GROUP_TASK_REVIEW_SUMMARY_KV_PREFIX = 'group_task_review_summary:';
const DEFAULT_INTERVAL_MS = 5_000;
const MIN_INTERVAL_MS = 1_000;
const DEFAULT_DRIVER_GRACE_MS = 20_000;
const DEFAULT_MAX_WORKER_REPLIES_PER_TICK = 3;
const DEFAULT_WORKER_COOLDOWN_MS = 20_000;
const DEFAULT_CHAIR_COOLDOWN_MS = 10_000;
const DEFAULT_REPLY_BUDGET = 40;
const MSG_RETRY_MAX_FAILURES = 5;
/** IDBots guest daemon bound: 3 consecutive failures per guest message. */
const GUEST_MSG_RETRY_MAX_FAILURES = 3;
// Guest membership self-check (IDBots cadence): 5-min probe, 15-min
// activation grace, 2 consecutive absences before marking left.
const GUEST_SELF_CHECK_INTERVAL_MS = 5 * 60_000;
const GUEST_ACTIVATION_GRACE_MS = 15 * 60_000;
const GUEST_SELF_CHECK_ABSENCE_LIMIT = 2;
exports.GROUP_TASK_GUEST_SELF_CHECK_KV_PREFIX = 'openteam_self_check:';
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
    const uploadDeliverableFile = options.uploadDeliverableFile
        ?? (async (input) => {
            const signer = await ctx.signerForSlug(input.slug);
            const uploaded = await (0, uploadFile_1.uploadLocalFileToChain)({ filePath: input.filePath, signer });
            return { metafileUri: uploaded.metafileUri, pinId: uploaded.pinId };
        });
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
        // The authoritative state line leads directive prompts (IDBots order) and
        // rides the volatile context on reply turns.
        const prompt = input.promptOverride
            ? (input.stateLine ? `${input.stateLine}\n\n${input.promptOverride}` : input.promptOverride)
            : (0, prompts_1.buildGroupTaskTurnContext)({
                task: input.task,
                recentMessages: input.recentMessages,
                target: input.target,
                stateLine: input.stateLine,
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
    /**
     * Single-commander host→chair one-way channel: record one environment fact
     * (NEVER a group post). The store dedupes unconsumed notes by dedupeKey.
     */
    async function recordHostNote(store, taskId, input) {
        const note = await store.recordHostNote({ taskId, ...input });
        log(`[GroupTaskEngine] Task ${taskId}: host note [${note.kind}${note.target ? ` → ${note.target}` : ''}] recorded`);
    }
    // Chain-health environment facts (IDBots task #66① parity): consecutive
    // send failures at the single post choke point ring ONE note per 10-min
    // bucket; the first success after a degraded window records the recovery.
    const chainHealth = new Map();
    async function noteChainHealthDegraded(store, task, error) {
        const state = chainHealth.get(task.id) ?? { failures: 0, downSince: null };
        state.failures += 1;
        state.downSince = state.downSince ?? now();
        chainHealth.set(task.id, state);
        if (state.failures < 2)
            return;
        const reason = (error instanceof Error ? error.message : String(error)).slice(0, 160);
        const bucket = Math.floor(now() / 600_000);
        await recordHostNote(store, task.id, {
            kind: 'chain_health',
            target: 'on-chain backend',
            body: `On-chain group sends have failed ${state.failures} consecutive times (last error: ${reason}). `
                + 'This is usually the chain backend being unreachable — every on-chain post (group messages, file '
                + 'uploads, publishes) will keep failing and retrying until it recovers. Local work can continue; a '
                + 'recovery note will follow when sends succeed again. Avoid stacking extra retries on top of the '
                + 'automatic ones.',
            dedupeKey: `chain_health_down:${task.id}:${bucket}`,
        }).catch(() => undefined);
    }
    async function noteChainHealthRecovered(store, task) {
        const state = chainHealth.get(task.id);
        if (!state || state.downSince == null)
            return;
        chainHealth.delete(task.id);
        if (state.failures < 2)
            return;
        await recordHostNote(store, task.id, {
            kind: 'chain_health',
            target: 'on-chain backend',
            body: 'On-chain sends have RECOVERED (the failure window lasted '
                + `~${Math.max(1, Math.round((now() - (state.downSince ?? now())) / 60_000))} min). `
                + 'Pending retries and queued publications can proceed now.',
            dedupeKey: `chain_health_recovered:${task.id}:${state.downSince}`,
        }).catch(() => undefined);
    }
    /**
     * The single engine post choke point: every engine-driven group post goes
     * through here so chain-health facts stay accurate. Posts are always signed
     * by a PARTICIPANT (chair or worker) — the host itself never speaks.
     */
    async function enginePost(store, task, input) {
        try {
            const posted = await (0, service_1.postGroupTaskMessage)(ctx, task.chairSlug, task.id, input);
            await noteChainHealthRecovered(store, task);
            return posted.pinId ?? null;
        }
        catch (error) {
            await noteChainHealthDegraded(store, task, error);
            throw error;
        }
    }
    /** The authoritative host-DB state line carried into every chair turn. */
    async function chairStateLine(store, task) {
        const deliverables = await store.listDeliverables(task.id).catch(() => []);
        const confirmed = deliverables.filter((row) => row.confirmation === 'confirmed').length;
        const reviewClause = task.status === 'review'
            ? 'the task IS in review — owner acceptance is pending'
            : 'the task is NOT in review — never announce that it is finished or awaiting owner acceptance until [STATUS:REVIEW] has been applied';
        return `[Authoritative task state (host DB): status=${task.status}; deliverables on ledger: ${deliverables.length} (${confirmed} on-chain confirmed); ${reviewClause}]`;
    }
    async function applyChairStatusTag(store, task, chairSlug, target, message, ownerGmid, chairProfile) {
        if (task.status === target)
            return task;
        if (!types_1.GROUP_TASK_LEGAL_TRANSITIONS[task.status].includes(target)) {
            // Parser feedback (single-commander): a silently-dropped chair tag is
            // how stuck-review feedback loops were born — record a `parse` note so
            // the chair learns the verdict in its own turn context.
            await recordHostNote(store, task.id, {
                kind: 'parse',
                body: `Your [STATUS:${target.toUpperCase()}] from message #${message.index} was NOT applied: `
                    + `${task.status} → ${target} is not a legal transition (legal from ${task.status}: `
                    + `${types_1.GROUP_TASK_LEGAL_TRANSITIONS[task.status].join(' → ') || 'none'}). Check the authoritative `
                    + 'state line and re-issue the correct lifecycle move if it is still warranted.',
                dedupeKey: `parse:${task.id}:${message.index}:${target}`,
            }).catch(() => undefined);
            return task;
        }
        if (target === 'review' && task.status === 'executing') {
            const reworkRaw = await store.kvGet(`${service_1.GROUP_TASK_REWORK_AT_KV_PREFIX}${task.id}`);
            const reworkAt = Number(reworkRaw);
            if (Number.isFinite(reworkAt) && now() - reworkAt < REVIEW_REENTRY_DEBOUNCE_MS) {
                await recordHostNote(store, task.id, {
                    kind: 'parse',
                    body: `Your [STATUS:REVIEW] from message #${message.index} was debounced: the task re-entered `
                        + 'executing less than a minute ago (a fresh rework). Re-verify the ledger against the '
                        + 'acceptance criteria, then re-issue the review verdict only if the goal is genuinely met.',
                    dedupeKey: `parse:${task.id}:${message.index}:review_debounce`,
                }).catch(() => undefined);
                return task; // stale review re-entry right after a rework
            }
        }
        const updated = await store.updateTaskStatus(task.id, target, {
            actor: { kind: 'chair', globalMetaId: message.senderGlobalMetaId, name: message.senderName },
            reason: `[STATUS:${target.toUpperCase()}]`,
        });
        // Source-session relay: the origin chat learns when dispatch starts.
        if (target === 'executing' && task.status === 'planning') {
            await (0, service_1.emitGroupTaskRelay)(ctx, chairProfile, updated, 'dispatch', 'The plan is out and work is underway; members have been @-assigned.');
        }
        if (target === 'review') {
            await (0, service_1.emitGroupTaskRelay)(ctx, chairProfile, updated, 'review', 'The chair entered review — the task awaits your acceptance in the Group Tasks panel.');
        }
        if (target === 'executing' && task.status === 'review') {
            await store.kvSet(`${service_1.GROUP_TASK_REWORK_AT_KV_PREFIX}${task.id}`, String(now()));
            await (0, service_1.clearGroupTaskReviewDeliveryGuards)(store, task.id);
            await store.kvDelete(`${exports.GROUP_TASK_REVIEW_SUMMARY_KV_PREFIX}${task.id}`);
        }
        if (target === 'review') {
            await store.kvDelete(`${service_1.GROUP_TASK_REWORK_AT_KV_PREFIX}${task.id}`);
            await store.closeOpenCheckpoints(task.id, 'resolved', 'superseded by review entry');
            await runReviewCeremony(store, updated, chairSlug, message, ownerGmid, chairProfile);
        }
        return updated;
    }
    /** IDBots parity label: verified on-chain, indexer lag, or unverified. */
    function deliverableVerificationLabel(row) {
        if (row.confirmation === 'confirmed')
            return 'on-chain ✓';
        if (row.verification && row.verification.includes('"not_found"'))
            return 'pending sync';
        return 'unverified';
    }
    /** Absolute local paths mentioned in a reply (guest file delivery). */
    function extractLocalFilePaths(text) {
        const matches = text.match(/(?:^|[\s('"])(\/[^\s'")]+\.[A-Za-z0-9]{1,8})/gu) ?? [];
        return [...new Set(matches.map((match) => match.trim().replace(/^[('"]/, '')))];
    }
    /** Bare local path (no URI scheme) that the upload seam can upgrade. */
    function looksLikeLocalFilePath(uri) {
        const value = (uri ?? '').trim();
        // "//…" is a scheme-relative URI (or a stripped "pin://" payload), never a local path.
        if (!value || value.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(value))
            return false;
        return value.startsWith('/') || value.startsWith('./') || value.startsWith('~/');
    }
    /** Checkpoint pause-line clause: the decision asked of the owner. */
    function checkpointDecisionSummary(topic) {
        const value = topic.replace(/\s+/gu, ' ').trim();
        if (!value)
            return null;
        const clause = /(?:decision|决定)[:：]\s*([^;；]+)$/i.exec(value);
        return (clause ? clause[1] : value).slice(0, 80) || null;
    }
    function preview(text, cap) {
        const value = (text ?? '').replace(/\s+/gu, ' ').trim();
        return value.length > cap ? `${value.slice(0, cap)}…` : value;
    }
    /** Deterministic fallback conclusion from the chair's review message. */
    function fallbackConclusion(reviewMessage) {
        return reviewMessage.content
            .replace(/\[[A-Z_]+(?::[^\]]*)?\]/gu, '')
            .replace(/\s+/gu, ' ')
            .trim()
            .slice(0, 120) || null;
    }
    /** Extract the 【结论】 first line from the LLM owner report. */
    function extractChairConclusion(report) {
        const match = /【结论】\s*([^\n]{1,160})/.exec(report);
        if (!match)
            return null;
        return match[1].trim().slice(0, 120) || null;
    }
    async function runReviewCeremony(store, task, chairSlug, reviewMessage, ownerGmid, chairProfile) {
        const guardKey = `${exports.GROUP_TASK_REVIEW_SUMMARY_KV_PREFIX}${task.id}`;
        if (await store.kvGet(guardKey))
            return;
        const members = await store.listMembers(task.id);
        const deliverables = await store.listDeliverables(task.id);
        const planChanges = await store.listPlanChanges(task.id);
        let conclusion = fallbackConclusion(reviewMessage);
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
        // LLM owner private report (IDBots maybeSendOwnerReport parity): the
        // chair narrates the saved summary to the owner PRIVATELY; the 【结论】
        // first line becomes the stamped conclusion. Single-commander: nothing is
        // posted to the group — the chair's own [STATUS:REVIEW] message is the
        // group-facing wrap-up.
        if (ownerGmid && ctx.sendPrivateMessage) {
            try {
                const supervisorSignals = await store.listSupervisorSignals(task.id).catch(() => []);
                const record = {
                    goal: preview(task.goal, 160),
                    acceptanceCriteria: preview(task.acceptanceCriteria, 160) || '(none specified)',
                    deliverables: deliverables.map((row) => ({
                        kind: row.kind, uri: row.uri, status: row.status,
                        verification: deliverableVerificationLabel(row),
                    })),
                    members: members
                        .filter((member) => member.removedAt == null)
                        .map((member) => ({ name: member.displayName ?? member.slug, role: member.role })),
                    planChanges: planChanges.slice(0, 3).map((change) => preview(change.summary, 160)),
                    supervisorInterventions: supervisorSignals
                        .map((signal) => `${signal.signalType}${signal.memberName ? ` → ${signal.memberName}` : ''}${signal.note ? `: ${signal.note}` : ''}`)
                        .slice(0, 5),
                };
                const report = (await options.runLlmTurn({
                    profile: chairProfile,
                    role: 'chair',
                    systemPrompt: 'You are the chair of a group task reporting to the owner. Reply in the owner\'s language.',
                    prompt: [
                        'The task below just entered review. Write a short private report to the owner.',
                        'First line must be exactly 【结论】followed by a one-sentence verdict (max 120 chars).',
                        'Then 3-6 bullet lines: goal, deliverables with their verification labels, member contributions, plan changes.',
                        'Facts only — every claim must come from the record below; never invent outcomes or ratings.',
                        'Every MetaWeb URI (metaid://, pin://, metafile://, metaapp://, map://) must appear in FULL — never abbreviated or truncated with an ellipsis; a shortened URI is neither clickable nor copyable.',
                        JSON.stringify(record),
                    ].join('\n'),
                })).trim();
                const extracted = extractChairConclusion(report);
                if (extracted) {
                    conclusion = extracted;
                    await store.updateAcceptanceSummaryConclusion(task.id, extracted);
                }
                await ctx.sendPrivateMessage({
                    fromSlug: chairSlug,
                    toGlobalMetaId: ownerGmid,
                    content: report,
                }).catch(() => undefined);
            }
            catch (error) {
                log(`[GroupTaskEngine] Owner report failed for task ${task.id}: `
                    + `${error instanceof Error ? error.message : String(error)}`);
            }
        }
        // Single-commander: NO group-facing review summary post. The acceptance
        // summary row above feeds the Tasks panel acceptance card; the owner heard
        // privately; the chair's own [STATUS:REVIEW] message is the wrap-up.
        await store.kvSet(guardKey, String(now()));
    }
    // -------------------------------------------------------------------------
    // Assignment ACK watch + member monitors (IDBots P0-3 / R6 parity)
    // -------------------------------------------------------------------------
    /** Chair mention of a worker arms the 3-min no-ACK watch; worker speech
     *  (explicit [WORKING] or any) clears it and records ack-seen. A chair
     *  [DEADLINE: Nm] tag on the dispatch arms the SINGLE deadline clock for
     *  each mentioned worker; the clock starts when the worker ACKs. */
    async function trackAssignmentAcks(store, task, message, members, tags) {
        const senderGmid = normalizeGmid(message.senderGlobalMetaId);
        const chairMember = members.find((member) => member.role === 'chair' && member.removedAt == null);
        const fromChair = chairMember != null && normalizeGmid(chairMember.globalMetaId) === senderGmid;
        const workers = members.filter((member) => member.role === 'worker'
            && member.removedAt == null && member.slug != null);
        if (fromChair) {
            const mentioned = new Set((message.mention ?? []).map((gmid) => normalizeGmid(gmid)).filter(Boolean));
            for (const member of workers) {
                if (!mentioned.has(normalizeGmid(member.globalMetaId)))
                    continue;
                // Single deadline clock: the chair's [DEADLINE: Nm] tag is the ONLY
                // deadline source; it arms (starts ticking) on the worker's ACK.
                if (tags.deadlineMinutes != null) {
                    await store.kvSet(`${exports.GROUP_TASK_DEADLINE_KV_PREFIX}${task.id}:${member.slug}`, JSON.stringify({
                        minutes: tags.deadlineMinutes,
                        msgIndex: message.index,
                        armedAt: null,
                        dueAt: null,
                    }));
                }
                // P5: legal silent states never arm the watch.
                if (ROLL_CALL_RE.test(message.content))
                    continue;
                if (member.status === 'standby')
                    continue;
                if (tags.dependsOn && (0, tags_1.isEnforceableDependencyToken)(tags.dependsOn))
                    continue;
                const seenKey = `${exports.GROUP_TASK_ACK_SEEN_KV_PREFIX}${task.id}:${message.index}`;
                if (await store.kvGet(seenKey))
                    continue;
                const pendingKey = `${exports.GROUP_TASK_ACK_PENDING_KV_PREFIX}${task.id}:${member.slug}`;
                const remindedKey = `${exports.GROUP_TASK_ACK_REMINDED_KV_PREFIX}${task.id}:${member.slug}`;
                if ((await store.kvGet(pendingKey)) == null && await store.kvGet(remindedKey) !== '1') {
                    await store.kvSet(pendingKey, JSON.stringify({ assignedAt: now(), msgIndex: message.index }));
                    log(`[GroupTaskEngine] Task ${task.id}: assignment to ${member.slug} `
                        + `(message ${message.index}); waiting for [WORKING] ACK`);
                }
            }
            return;
        }
        const member = workers.find((candidate) => normalizeGmid(candidate.globalMetaId) === senderGmid);
        if (!member)
            return;
        const pendingKey = `${exports.GROUP_TASK_ACK_PENDING_KV_PREFIX}${task.id}:${member.slug}`;
        const remindedKey = `${exports.GROUP_TASK_ACK_REMINDED_KV_PREFIX}${task.id}:${member.slug}`;
        const clearPendingAck = async () => {
            const raw = await store.kvGet(pendingKey);
            if (raw != null) {
                try {
                    const entry = JSON.parse(raw);
                    if (entry && typeof entry.msgIndex === 'number') {
                        await store.kvSet(`${exports.GROUP_TASK_ACK_SEEN_KV_PREFIX}${task.id}:${entry.msgIndex}`, '1');
                    }
                }
                catch {
                    // unparsable pending entry: drop it without ack-seen
                }
            }
            await store.kvDelete(pendingKey);
            await store.kvDelete(remindedKey);
        };
        if (tags.working) {
            await store.setMemberStatus(task.id, member.slug, 'working', member.globalMetaId);
            await clearPendingAck();
            // The worker ACK starts the chair-stated deadline clock (worker ETA
            // numbers are planning information for the chair, never a clock).
            const deadlineKey = `${exports.GROUP_TASK_DEADLINE_KV_PREFIX}${task.id}:${member.slug}`;
            const deadlineRaw = await store.kvGet(deadlineKey);
            if (deadlineRaw) {
                try {
                    const entry = JSON.parse(deadlineRaw);
                    if (typeof entry.minutes === 'number' && entry.armedAt == null) {
                        const parsed = JSON.parse(deadlineRaw);
                        await store.kvSet(deadlineKey, JSON.stringify({
                            ...parsed,
                            armedAt: now(),
                            dueAt: now() + entry.minutes * 60_000,
                        }));
                    }
                }
                catch {
                    // unparsable deadline entry: drop it
                    await store.kvDelete(deadlineKey);
                }
            }
            return;
        }
        if (tags.standby) {
            await store.setMemberStatus(task.id, member.slug, 'standby', member.globalMetaId);
            return;
        }
        // Implicit ACK: any worker speech counts as engaged.
        if (member.status === 'assigned') {
            await store.setMemberStatus(task.id, member.slug, 'working', member.globalMetaId);
        }
        await clearPendingAck();
    }
    /** An outstanding (pending/claimed, unexpired) work request means the
     *  worker's turn is LIVE: the member is engaged, so monitors must not flag
     *  a working member (the single-commander "engaged branch"). */
    async function hasOutstandingWorkRequest(store, taskId, slug) {
        const requests = await store.listWorkRequests({ workerSlug: slug }).catch(() => []);
        return requests.some((request) => request.taskId === taskId
            && ((request.status === 'pending' && now() - request.createdAt <= WORK_REQUEST_PENDING_TTL_MS)
                || (request.status === 'claimed'
                    && now() - (request.claimedAt ?? request.createdAt) <= WORK_REQUEST_CLAIMED_TTL_MS)));
    }
    /** Monitors record environment facts as host notes — the chair decides what
     *  the group needs to hear; the host never posts. The L3 escalation briefs
     *  the owner PRIVATELY. */
    async function monitorAssignmentsAndMembers(store, task, members, seats, ownerGmid, chairSlug, chairGmid) {
        if (task.status !== 'planning' && task.status !== 'executing')
            return;
        if (!task.groupId)
            return;
        const chairSeat = seats.find((seat) => seat.role === 'chair') ?? null;
        const workers = members.filter((member) => member.role === 'worker'
            && member.removedAt == null && member.slug != null);
        // No-ACK facts (once per pending assignment; never auto-fails).
        for (const member of workers) {
            if (member.status === 'standby')
                continue;
            const pendingKey = `${exports.GROUP_TASK_ACK_PENDING_KV_PREFIX}${task.id}:${member.slug}`;
            const raw = await store.kvGet(pendingKey);
            if (!raw)
                continue;
            let entry;
            try {
                entry = JSON.parse(raw);
            }
            catch {
                continue;
            }
            const assignedAt = typeof entry.assignedAt === 'number' ? entry.assignedAt : 0;
            if (now() - assignedAt < ACK_TIMEOUT_MS)
                continue;
            // Engaged branch: a live work request means the worker's turn is
            // running — retire the watch silently (no note, no host speech).
            if (await hasOutstandingWorkRequest(store, task.id, member.slug)) {
                await store.kvDelete(pendingKey);
                await store.kvDelete(`${exports.GROUP_TASK_ACK_REMINDED_KV_PREFIX}${task.id}:${member.slug}`);
                continue;
            }
            const remindedKey = `${exports.GROUP_TASK_ACK_REMINDED_KV_PREFIX}${task.id}:${member.slug}`;
            if (await store.kvGet(remindedKey) === '1')
                continue;
            await store.kvSet(remindedKey, '1');
            await recordHostNote(store, task.id, {
                kind: 'no_ack',
                target: member.displayName ?? member.slug,
                body: `${member.displayName ?? member.slug} has NOT sent a [WORKING] ACK for the assignment`
                    + `${typeof entry.msgIndex === 'number' ? ` (message #${entry.msgIndex})` : ''} — `
                    + `${Math.round((now() - assignedAt) / 60_000)} min elapsed. Once you next speak, verify the `
                    + 'assignment was actually received and re-dispatch if it was not; whether to nudge them in the '
                    + 'group is your call.',
                dedupeKey: `no_ack:${task.id}:${member.slug}:${assignedAt}`,
            }).catch(() => undefined);
        }
        // Chair-stated deadlines (single clock): ring the bell once per armed
        // clock — one `deadline` host note, then the clock is done.
        for (const member of workers) {
            const deadlineKey = `${exports.GROUP_TASK_DEADLINE_KV_PREFIX}${task.id}:${member.slug}`;
            const deadlineRaw = await store.kvGet(deadlineKey);
            if (!deadlineRaw)
                continue;
            let entry;
            try {
                entry = JSON.parse(deadlineRaw);
            }
            catch {
                await store.kvDelete(deadlineKey);
                continue;
            }
            if (entry.armedAt == null || entry.dueAt == null || typeof entry.minutes !== 'number')
                continue;
            if (now() <= entry.dueAt)
                continue;
            const gmid = normalizeGmid(member.globalMetaId);
            const armedAt = entry.armedAt;
            const delivered = await store.listDeliverables(task.id).then((rows) => rows.some((row) => normalizeGmid(row.authorGlobalMetaId) === gmid
                && row.status !== 'rejected'
                && row.createdAt >= armedAt)).catch(() => false);
            await store.kvDelete(deadlineKey);
            if (delivered)
                continue;
            await recordHostNote(store, task.id, {
                kind: 'deadline',
                target: member.displayName ?? member.slug,
                body: `The ${entry.minutes}-min deadline you set for ${member.displayName ?? member.slug} `
                    + `(assignment message #${entry.msgIndex ?? '?'}) rang ${Math.round((now() - entry.dueAt) / 60_000)} `
                    + 'min ago with no [DELIVERABLE] recorded since the ACK. Chasing the member, extending the '
                    + 'deadline, or re-assigning the step is your decision.',
                dedupeKey: `deadline:${task.id}:${member.slug}:${entry.msgIndex ?? armedAt}`,
            }).catch(() => undefined);
        }
        if (task.status !== 'executing')
            return;
        const active = workers.filter((member) => member.status === 'assigned' || member.status === 'working');
        if (active.length === 0)
            return;
        const gmids = active.map((member) => member.globalMetaId);
        const [speakMap, workingMap] = await Promise.all([
            store.getMembersLastSpeakAt(task.groupId, gmids).catch(() => new Map()),
            store.getMembersWorkingAt(task.groupId, gmids).catch(() => new Map()),
        ]);
        for (const member of active) {
            const gmid = normalizeGmid(member.globalMetaId);
            const outstanding = await hasOutstandingWorkRequest(store, task.id, member.slug);
            // Unreachable: no speech for 30+ min (baseline: join time). A live work
            // request means the turn is running — never flag an engaged member.
            const lastSpeakMs = (speakMap.get(gmid) ?? 0) * 1000 || member.createdAt;
            if (!outstanding && lastSpeakMs && now() - lastSpeakMs > MEMBER_UNREACHABLE_AFTER_MS) {
                if (member.status !== 'unreachable') {
                    await store.setMemberStatus(task.id, member.slug, 'unreachable', member.globalMetaId);
                    log(`[GroupTaskEngine] Task ${task.id}: member ${member.slug} marked unreachable `
                        + '(no speech for 30+ min)');
                }
            }
            // Timeout L2: [WORKING] signal stale past 20 min → one `long_turn` fact
            // for the chair; L3 past +10 min → private owner brief.
            const lastWorkingMs = (workingMap.get(gmid) ?? 0) * 1000;
            if (!lastWorkingMs)
                continue;
            const staleMs = now() - lastWorkingMs;
            if (staleMs <= MEMBER_TIMEOUT_AFTER_MS)
                continue;
            if (outstanding)
                continue; // live DSH turn in flight: engaged, not timed out
            await store.setMemberStatus(task.id, member.slug, 'unreachable', member.globalMetaId).catch(() => undefined);
            const standbyNames = workers
                .filter((row) => row.status === 'standby')
                .map((row) => row.displayName ?? row.slug);
            const reAssign = standbyNames.length > 0
                ? `Standby members available for re-assignment: ${standbyNames.join(', ')}.`
                : 'No standby members on the roster.';
            await recordHostNote(store, task.id, {
                kind: 'long_turn',
                target: member.displayName ?? member.slug,
                body: `${member.displayName ?? member.slug}'s [WORKING] signal has been silent for `
                    + `${Math.round(staleMs / 60_000)} min (past the ${MEMBER_TIMEOUT_AFTER_MS / 60_000}-min window) `
                    + `with no live turn on record. ${reAssign} Chasing, re-assigning, or marking the step suspended `
                    + 'is your call — the host never auto-fails anyone.',
                dedupeKey: `long_turn:${task.id}:${member.slug}:${lastWorkingMs}`,
            }).catch(() => undefined);
            log(`[GroupTaskEngine] Task ${task.id}: ${member.slug} [WORKING] stale 20+ min; long_turn note recorded`);
            // L3: still silent past +10 min → brief the owner once per streak.
            if (staleMs <= MEMBER_TIMEOUT_AFTER_MS + MEMBER_ESCALATE_AFTER_MS)
                continue;
            const ownerKey = `${exports.GROUP_TASK_TIMEOUT_OWNER_KV_PREFIX}${task.id}:${member.slug}`;
            if (await store.kvGet(ownerKey) === '1')
                continue;
            if (!ownerGmid || !chairSeat || !ctx.sendPrivateMessage)
                continue;
            await store.kvSet(ownerKey, '1');
            await ctx.sendPrivateMessage({
                fromSlug: chairSlug,
                toGlobalMetaId: ownerGmid,
                content: `[GroupTask] Task "${task.title}": member "${member.displayName ?? member.slug}" has been silent for `
                    + `${Math.round(staleMs / 60_000)}+ min (past the [WORKING] window). The chair has been informed `
                    + 'through its environment notes; please decide whether to wait, reassign, or close the task.',
            }).catch(() => undefined);
        }
    }
    async function applyTagSideEffects(store, task, chairSlug, message, tags, seats, ownerGmid, chairProfile) {
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
                // The chair's own [CHECKPOINT_RESOLVED] message IS the resume signal —
                // the host posts nothing into the group (single-commander).
                await store.resolveCheckpoint(task.id, tags.checkpointDecision, message.pinId);
            }
            else if (tags.checkpointTopic
                && current.status !== 'review'
                && !(await hasOpenCheckpoint(store, task.id))) {
                const opened = await store.openCheckpoint(task.id, tags.checkpointTopic, message.pinId);
                // The owner hears about the pause PRIVATELY (source-session relay +
                // private report); the chair's [CHECKPOINT] message itself is the
                // group-facing signal.
                const summary = checkpointDecisionSummary(tags.checkpointTopic);
                await (0, service_1.emitGroupTaskRelay)(ctx, chairProfile, current, 'checkpoint', `Paused for your decision: ${tags.checkpointTopic}${summary ? ` (decision needed: ${summary})` : ''}`
                    + ' — reply in the group or open the Group Tasks panel.');
                // One private owner report per checkpoint (IDBots parity).
                if (ownerGmid && ctx.sendPrivateMessage && opened) {
                    await ctx.sendPrivateMessage({
                        fromSlug: chairSlug,
                        toGlobalMetaId: ownerGmid,
                        content: `[GroupTask] Task "${current.title}" paused by a checkpoint and needs your decision:\n`
                            + `Question: ${tags.checkpointTopic}\n`
                            + (summary ? `Decision needed: ${summary}\n` : '')
                            + 'Reply in the group to resolve it; work resumes automatically.',
                    }).catch(() => undefined);
                }
            }
            if (tags.status) {
                current = await applyChairStatusTag(store, current, chairSlug, tags.status, message, ownerGmid, chairProfile);
            }
        }
        // Member tags (non-chair local members)
        if (senderSeat && !fromChair) {
            if (tags.deliverables.length > 0 && message.pinId) {
                // A delivery settles the chair-stated deadline clock for this member.
                await store.kvDelete(`${exports.GROUP_TASK_DEADLINE_KV_PREFIX}${task.id}:${senderSeat.slug}`);
                let recordedAny = false;
                for (const candidate of tags.deliverables) {
                    // Per-(msgPin, uri, kind) dedupe (IDBots parity): the same line
                    // replayed through indexer re-sync never double-records.
                    const existing = await store.findDeliverableByMsgPinAndUri(task.id, message.pinId, candidate.uri, candidate.kind);
                    if (existing)
                        continue;
                    // Fold-by-pin (IDBots R-03/7d617f2e): the same author re-posting the
                    // same artifact (same on-chain pin) folds into the original row —
                    // a viewer URL for it never mints a second row or a second author.
                    const candidatePin = (0, deliverableVerification_1.extractDeliverablePinId)(candidate.uri);
                    if (candidatePin) {
                        const priorRows = await store.listDeliverables(task.id);
                        const prior = priorRows.find((row) => row.authorGlobalMetaId === message.senderGlobalMetaId
                            && (0, deliverableVerification_1.extractDeliverablePinId)(row.uri) === candidatePin);
                        if (prior) {
                            log(`[GroupTaskEngine] Deliverable from message ${message.index} of task ${task.id} `
                                + `folded into row ${prior.id} (same author + pin)`);
                            continue;
                        }
                    }
                    const recorded = await store.addDeliverable({
                        taskId: task.id,
                        msgPinId: message.pinId,
                        authorGlobalMetaId: message.senderGlobalMetaId,
                        kind: candidate.kind,
                        uri: candidate.uri,
                    });
                    recordedAny = true;
                    // Inviter-side upgrade: a local-file deliverable is uploaded as a
                    // metafile and the row rewritten to the on-chain URI (IDBots
                    // parity). Bare paths stay in the payload (uri null). Best-effort
                    // — the raw path row survives on failure. The payload fallback only
                    // applies when the tag carried NO uri at all: a candidate that
                    // already has a classified uri (pin/metaapp/metafile/link) is
                    // on-chain and must never be re-read as a file — stripping its
                    // scheme ("pin://…" → "//…") would fake an absolute path.
                    const payloadPath = candidate.uri == null
                        ? candidate.payload.replace(/^file:\s*/i, '').trim()
                        : '';
                    const localPath = (looksLikeLocalFilePath(candidate.uri) ? candidate.uri : null)
                        ?? (looksLikeLocalFilePath(payloadPath) ? payloadPath : null);
                    if (localPath) {
                        try {
                            const uploaded = await uploadDeliverableFile({
                                slug: senderSeat.slug,
                                filePath: localPath,
                            });
                            await store.updateDeliverableUri(recorded.id, uploaded.metafileUri, 'metafile');
                            log(`[GroupTaskEngine] Deliverable ${recorded.id} of task ${task.id} upgraded to `
                                + `${uploaded.metafileUri}`);
                        }
                        catch (error) {
                            log(`[GroupTaskEngine] Deliverable upload failed for task ${task.id}: `
                                + `${error instanceof Error ? error.message : String(error)}`);
                        }
                    }
                    if (candidate.correction) {
                        // Correction supersede: reopen this author's superseded row
                        // (same URI pin, else the NEWEST rejected row) for re-check.
                        const rows = await store.listDeliverables(task.id);
                        const pinOf = (uri) => {
                            const match = /([0-9a-f]{64}i\d+)/i.exec(uri ?? '');
                            return match ? match[1].toLowerCase() : null;
                        };
                        const targetPin = pinOf(candidate.uri);
                        // Supersede targets PRIOR rows by this author: never the
                        // correction row just recorded, and rejected rows first (a
                        // delivered row is live work, not a superseded one).
                        const mine = rows.filter((row) => row.id !== recorded.id
                            && row.authorGlobalMetaId === message.senderGlobalMetaId
                            && row.status !== 'accepted');
                        const superseded = (targetPin && mine.find((row) => pinOf(row.uri) === targetPin && row.status === 'rejected'))
                            ?? (targetPin && mine.find((row) => pinOf(row.uri) === targetPin))
                            ?? [...mine].reverse().find((row) => row.status === 'rejected')
                            ?? mine[0]
                            ?? null;
                        if (superseded) {
                            await store.reopenDeliverable(superseded.id);
                            log(`[GroupTaskEngine] Deliverable ${superseded.id} of task ${task.id} superseded `
                                + `by correction in message ${message.index}`);
                        }
                    }
                }
                if (!recordedAny) {
                    log(`[GroupTaskEngine] Deliverable candidates of message ${message.index} `
                        + `on task ${task.id} were duplicates; nothing recorded`);
                }
                if (recordedAny && options.verifyPin) {
                    await (0, deliverableVerification_1.verifyTaskDeliverables)(store, task.id, options.verifyPin, { now, log }).catch(() => undefined);
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
    /**
     * Worker-session handoff for one local-worker decision. Returns 'defer'
     * (a request is outstanding — wait for the host), 'done' (the host already
     * posted the reply on-chain; the cursor may advance), or 'fallback' (no
     * request yet, expired, or failed — run the bare-LLM turn instead).
     */
    async function handleWorkerSessionTurn(store, task, seat, message) {
        const kvKey = `${exports.GROUP_TASK_WORK_REQ_KV_PREFIX}${task.id}:${message.index}:${seat.slug}`;
        const existingId = await store.kvGet(kvKey);
        if (!existingId) {
            const request = await store.createWorkRequest({
                taskId: task.id,
                groupId: task.groupId,
                workerSlug: seat.slug,
                targetIndex: message.index,
                targetPinId: message.pinId ?? null,
            });
            await store.kvSet(kvKey, String(request.id));
            log(`[GroupTaskEngine] Task ${task.id}: worker turn for ${seat.slug} `
                + `(message ${message.index}) deferred to a DSH work request #${request.id}`);
            return 'defer';
        }
        const request = await store.getWorkRequest(Number(existingId));
        if (!request) {
            await store.kvDelete(kvKey);
            return 'fallback';
        }
        if (request.status === 'pending') {
            if (now() - request.createdAt > WORK_REQUEST_PENDING_TTL_MS) {
                await store.updateWorkRequest(request.id, { status: 'expired', error: 'claim_ttl_expired' });
                log(`[GroupTaskEngine] Task ${task.id}: work request #${request.id} expired unclaimed; `
                    + 'falling back to the bare-LLM turn');
                return 'fallback';
            }
            return 'defer';
        }
        if (request.status === 'claimed') {
            const since = request.claimedAt ?? request.createdAt;
            if (now() - since > WORK_REQUEST_CLAIMED_TTL_MS) {
                await store.updateWorkRequest(request.id, { status: 'expired', error: 'claimed_ttl_expired' });
                log(`[GroupTaskEngine] Task ${task.id}: claimed work request #${request.id} timed out; `
                    + 'falling back to the bare-LLM turn');
                return 'fallback';
            }
            return 'defer';
        }
        if (request.status === 'completed') {
            log(`[GroupTaskEngine] Task ${task.id}: work request #${request.id} completed by the host; `
                + 'advancing the cursor');
            return 'done';
        }
        return 'fallback'; // failed or expired
    }
    async function runReplies(input) {
        for (const decision of input.decisions) {
            const seat = input.seats.find((entry) => entry.slug === decision.slug);
            if (!seat)
                continue;
            const key = seatKey(input.chairSlug, input.task.id, seat.slug);
            // Worker-session handoff (Phase 3): local worker turns are executed by
            // the DSH host as real sub-sessions. Chair turns stay bare-LLM by design.
            if (decision.role === 'worker' && seat.slug && options.workerSessions !== false) {
                const handling = await handleWorkerSessionTurn(input.store, input.task, seat, input.message);
                if (handling === 'defer')
                    return 'defer';
                if (handling === 'done')
                    continue;
                // 'fallback': proceed with the bare-LLM turn below.
            }
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
            // Single-commander: [DEPENDS_ON] is a DECLARATIVE marker — the host
            // never holds or re-orders dispatches; sequencing is the chair's
            // judgment (the marker only keeps timeout flags off a waiting member).
            const reply = (await runSeatTurn({
                seat,
                task: input.task,
                promptSeats: input.promptSeats,
                chairName: input.chairName,
                ownerGmid: input.ownerGmid,
                recentMessages: input.recentMessages,
                target: input.message,
                stateLine: decision.role === 'chair'
                    ? await chairStateLine(input.store, input.task)
                    : null,
            })).trim();
            replyCounts.set(key, spent + 1);
            lastReplyAt.set(key, now());
            if (decision.role === 'worker')
                input.counters.workerReplies += 1;
            else if (decision.reason !== 'chair_mentioned')
                input.counters.chairAutoReplies += 1;
            if (!reply || (0, tags_1.isNoReplyResponse)(reply))
                continue;
            await enginePost(input.store, input.task, {
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
    /** Deterministic [STATUS:EXECUTING] footer for planning replies that carry
     *  no honored status tag (IDBots parity: the bootstrap must move the task). */
    function ensurePlanningStatusFooter(reply) {
        return (0, tags_1.parseGroupTaskTags)(reply).status ? reply : `${reply}\n[STATUS:EXECUTING]`;
    }
    /** EP33 P2 planning dedupe: any chair-authored message beyond the
     *  auto-kickoff that @-mentions a seated worker means the chair already
     *  dispatched in its own voice — the bootstrap must not duplicate it. */
    function chairAlreadyDispatched(messages, chairGmid, seats) {
        const workers = seats.filter((seat) => seat.role === 'worker');
        if (workers.length === 0)
            return false;
        return messages.some((message) => {
            if (normalizeGmid(message.senderGlobalMetaId) !== chairGmid)
                return false;
            if (message.content.trimStart().startsWith('[GROUP TASK]'))
                return false; // auto-kickoff
            return workers.some((worker) => (0, tags_1.isMentioned)(message, worker));
        });
    }
    /** Planning coverage guard: the posted plan must NAME every seated worker —
     *  an assignment or an explicit [STANDBY]. A plan that silently drops a seat
     *  leaves that member waiting forever (they only act when addressed), so the
     *  gap goes to the chair as a host note for a follow-up turn — the host
     *  never posts into the group. */
    async function notePlanningCoverage(store, task, promptSeats, planText) {
        const plan = planText.toLowerCase();
        const uncovered = promptSeats
            .filter((seat) => seat.role === 'worker')
            .map((seat) => seat.name)
            .filter((name) => !plan.includes(name.toLowerCase()));
        if (uncovered.length === 0)
            return;
        await store.recordHostNote({
            taskId: task.id,
            kind: 'plan_coverage',
            target: uncovered.join(', '),
            body: 'Your posted plan never mentioned these seated workers: ' + uncovered.join(', ')
                + '. Every seated worker must be either assigned a subtask or explicitly put on [STANDBY] '
                + 'by name — members only act when addressed. Post a short follow-up covering them now.',
            dedupeKey: `plan_coverage:${task.id}`,
        });
        log(`[GroupTaskEngine] Task ${task.id}: plan never mentioned ${uncovered.length} seated worker(s) `
            + `(${uncovered.join(', ')}); plan_coverage host note recorded`);
    }
    async function runPlanningTurn(input) {
        const { store, task } = input;
        const plannedKey = `${exports.GROUP_TASK_PLANNED_KV_PREFIX}${task.id}`;
        if (await store.kvGet(plannedKey))
            return;
        const stateLine = await chairStateLine(store, task);
        // EP33 P2: the planning bootstrap never duplicates an active chair. The
        // minimal directive completes planning WITHOUT burning the 3-attempt
        // budget; a [NO_REPLY] answer posts nothing.
        if (chairAlreadyDispatched(input.recentMessages, normalizeGmid(input.chair.globalMetaId), input.seats)) {
            const minimal = (0, prompts_1.buildMinimalPlanningDirective)({
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
                promptOverride: minimal,
                stateLine,
            })).trim();
            if (!reply || (0, tags_1.isNoReplyResponse)(reply)) {
                await store.kvSet(plannedKey, String(now()));
                log(`[GroupTaskEngine] Planning for task ${task.id} completed minimally `
                    + '(chair already dispatched; nothing missing)');
                return;
            }
            await enginePost(store, task, { content: ensurePlanningStatusFooter(reply) });
            await store.kvSet(plannedKey, String(now()));
            await refreshDriverClaim(store, task.id);
            log(`[GroupTaskEngine] Planning for task ${task.id} completed minimally (chair already dispatched)`);
            return;
        }
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
            stateLine,
        })).trim();
        if (!reply || (0, tags_1.isNoReplyResponse)(reply))
            return; // counts as a failed attempt
        const postedPlan = ensurePlanningStatusFooter(reply);
        await enginePost(store, task, { content: postedPlan });
        await notePlanningCoverage(store, task, input.promptSeats, postedPlan);
        await store.kvSet(plannedKey, String(now()));
        await refreshDriverClaim(store, task.id);
    }
    /**
     * IDBots roster-settle gate: hold the one-shot planning turn while OpenTeam
     * invites for this task are still pending, so the chair plans with the full
     * roster instead of a chair-only one (the live DSH round-trip showed the
     * plan landing seconds after create, before any remote accept, and the
     * chair committing to self-execute). Bounded by ROSTER_SETTLE_MAX_WAIT_MS
     * so a never-answering invitee cannot wedge the task in planning.
     */
    async function rosterSettledForPlanning(profile, task) {
        const openteam = (0, service_1.openteamStoreFor)(ctx, profile);
        const invites = await openteam.listInvites(task.id).catch(() => []);
        const pending = invites.filter((invite) => invite.status === 'pending');
        if (pending.length === 0)
            return { settled: true };
        if (now() - task.createdAt >= ROSTER_SETTLE_MAX_WAIT_MS)
            return { settled: true };
        return { settled: false, reason: `${pending.length} OpenTeam invite(s) pending` };
    }
    // Note: remote-member joins wake the chair through a `join` HOST NOTE
    // (recorded by maintainInviterInvites) — the host-notes turn delivers it and
    // the chair greets/re-dispatches in its own voice (single-commander: no
    // welcome broadcast, no host-directed wake post).
    /**
     * Owner-supervise wake (nudge / resume): ONE directive-driven chair turn.
     * The request kv is cleared by the caller before the turn; the attempts kv
     * caps repeated failures so a wedged LLM cannot spin.
     */
    async function runSupervisorWake(input) {
        const directive = (0, prompts_1.buildSupervisorWakeDirective)({
            task: input.task,
            kind: input.kind,
            memberName: input.memberName,
            memberNote: input.memberNote,
            recentMessages: input.recentMessages,
            nowMs: now(),
        });
        const reply = (await runSeatTurn({
            seat: input.chair,
            task: input.task,
            promptSeats: input.promptSeats,
            chairName: input.chairName,
            ownerGmid: input.ownerGmid,
            recentMessages: input.recentMessages,
            target: null,
            promptOverride: directive,
            stateLine: await chairStateLine(input.store, input.task),
        })).trim();
        if (!reply || (0, tags_1.isNoReplyResponse)(reply))
            return;
        await enginePost(input.store, input.task, { content: reply });
        await refreshDriverClaim(input.store, input.task.id);
        log(`[GroupTaskEngine] Supervisor ${input.kind} wake for task ${input.task.id}`);
    }
    /**
     * Host-notes delivery (the single-commander host→chair channel): pending
     * environment notes are delivered in ONE dedicated chair turn. The chair
     * speaks in its own voice (or stays silent with [NO_REPLY]); either way the
     * batch is consumed. Three consecutive turn failures drop the batch with an
     * origin-session anomaly relay — notes must never wedge the task.
     */
    async function processHostNotes(input) {
        const { store, task } = input;
        if (task.status !== 'planning' && task.status !== 'executing')
            return;
        if (task.dispatchPausedAt != null)
            return; // owner paused: the room waits
        if (await hasOpenCheckpoint(store, task.id))
            return; // owner is mid-decision
        const pending = await store.listPendingHostNotes(task.id);
        if (pending.length === 0)
            return;
        const attemptsKey = `${exports.GROUP_TASK_HOST_NOTE_ATTEMPTS_KV_PREFIX}${task.id}`;
        const attempts = Number((await store.kvGet(attemptsKey)) ?? '0') || 0;
        if (attempts >= HOST_NOTE_TURN_MAX_ATTEMPTS) {
            await store.markHostNotesConsumed(task.id, pending.map((note) => note.id), null);
            await store.kvDelete(attemptsKey);
            await (0, service_1.emitGroupTaskRelay)(ctx, input.profile, task, 'alert', `The host dropped ${pending.length} environment note(s) addressed to the chair after `
                + `${attempts} failed delivery attempts (LLM/chain failures). Facts dropped: `
                + pending.map((note) => `[${note.kind}${note.target ? ` → ${note.target}` : ''}]`).join(', '));
            log(`[GroupTaskEngine] Task ${task.id}: dropped ${pending.length} host note(s) after ${attempts} attempts`);
            return;
        }
        // Respect the chair cooldown so a notes turn never double-speaks right
        // after a regular chair reply.
        const key = seatKey(input.chair.slug, task.id, input.chair.slug);
        const last = lastReplyAt.get(key) ?? 0;
        if (now() - last < chairCooldownMs)
            return;
        const noteLines = pending.map((note) => `[${note.kind}${note.target ? ` → ${note.target}` : ''}] ${note.body}`);
        const directive = (0, prompts_1.buildHostNotesDirective)({
            task,
            noteLines,
            recentMessages: input.recentMessages,
            nowMs: now(),
        });
        try {
            const reply = (await runSeatTurn({
                seat: input.chair,
                task,
                promptSeats: input.promptSeats,
                chairName: input.chairName,
                ownerGmid: input.ownerGmid,
                recentMessages: input.recentMessages,
                target: null,
                promptOverride: directive,
                stateLine: await chairStateLine(store, task),
            })).trim();
            lastReplyAt.set(key, now());
            if (!reply || (0, tags_1.isNoReplyResponse)(reply)) {
                await store.markHostNotesConsumed(task.id, pending.map((note) => note.id), null);
            }
            else {
                const pinId = await enginePost(store, task, { content: reply });
                await store.markHostNotesConsumed(task.id, pending.map((note) => note.id), pinId);
                await refreshDriverClaim(store, task.id);
            }
            await store.kvDelete(attemptsKey);
            log(`[GroupTaskEngine] Task ${task.id}: delivered ${pending.length} host note(s) to the chair`);
        }
        catch (error) {
            await store.kvSet(attemptsKey, String(attempts + 1));
            log(`[GroupTaskEngine] Host-notes turn failed for task ${task.id} (${attempts + 1}/${HOST_NOTE_TURN_MAX_ATTEMPTS}): `
                + `${error instanceof Error ? error.message : String(error)}`);
        }
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
        // Deliverable re-verification pass (10 min cadence per task): indexer
        // lag should not leave confirmed-on-chain pins unconfirmed forever.
        if (options.verifyPin && task.status !== 'done' && task.status !== 'cancelled') {
            const reverifyKey = `${exports.GROUP_TASK_DELIVERABLE_VERIFY_KV_PREFIX}${task.id}`;
            const lastCheck = Number((await store.kvGet(reverifyKey)) ?? '0') || 0;
            if (now() - lastCheck >= DELIVERABLE_REVERIFY_INTERVAL_MS) {
                await store.kvSet(reverifyKey, String(now()));
                await (0, deliverableVerification_1.verifyTaskDeliverables)(store, task.id, options.verifyPin, { now, log }).catch(() => undefined);
            }
        }
        const members = await store.listMembers(task.id, { includeRemoved: true });
        const { seats, promptSeats, chair } = await buildSeats(task, members, profileBySlug);
        const chairName = chair?.name ?? profile.name;
        const page = await store.listMessages(task.groupId, { limit: MESSAGE_FETCH_LIMIT });
        let current = task;
        if (current.status === 'planning' && chair && current.dispatchPausedAt == null) {
            const settle = await rosterSettledForPlanning(profile, current);
            if (!settle.settled) {
                // Log the deferral once per task, not once per tick.
                const deferredKey = `${exports.GROUP_TASK_PLANNING_DEFERRED_KV_PREFIX}${current.id}`;
                if (!(await store.kvGet(deferredKey))) {
                    await store.kvSet(deferredKey, String(now()));
                    log(`[GroupTaskEngine] Planning deferred for task ${current.id}: ${settle.reason}`);
                }
            }
            else {
                try {
                    await runPlanningTurn({
                        store,
                        task: current,
                        chair,
                        seats,
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
        }
        // Supervisor wake (owner nudge / resume): the service queues a request kv;
        // the engine turns it into ONE directive-driven chair turn (attempt-capped).
        // Single-commander teeth: an OPEN CHECKPOINT defers the wake (the owner is
        // mid-decision); review status does NOT — the review-exception clause in
        // the directive lets a genuine defect reopen rework.
        const nudgeRaw = await store.kvGet(`${service_1.GROUP_TASK_NUDGE_REQUEST_KV_PREFIX}${current.id}`);
        if (nudgeRaw && chair) {
            if (await hasOpenCheckpoint(store, current.id)) {
                // Deferred: leave the request queued for a later tick.
            }
            else {
                await store.kvDelete(`${service_1.GROUP_TASK_NUDGE_REQUEST_KV_PREFIX}${current.id}`);
                try {
                    const request = JSON.parse(nudgeRaw);
                    const attempts = (Number((await store.kvGet(`${service_1.GROUP_TASK_NUDGE_ATTEMPTS_KV_PREFIX}${current.id}`)) ?? '0') || 0) + 1;
                    await store.kvSet(`${service_1.GROUP_TASK_NUDGE_ATTEMPTS_KV_PREFIX}${current.id}`, String(attempts));
                    if (attempts <= 3) {
                        await runSupervisorWake({
                            store,
                            task: current,
                            chair,
                            promptSeats,
                            chairName,
                            ownerGmid,
                            recentMessages: page.messages,
                            kind: request.kind === 'resume' ? 'resume' : 'nudge',
                            memberName: request.name ?? null,
                            memberNote: request.note ?? null,
                        });
                    }
                    else {
                        log(`[GroupTaskEngine] Supervisor wake for task ${current.id} dropped after ${attempts - 1} attempts`);
                        await (0, service_1.emitGroupTaskRelay)(ctx, profile, current, 'alert', `A supervisor ${request.kind === 'resume' ? 'resume' : 'nudge'} wake was dropped after `
                            + `${attempts - 1} failed attempts (LLM/chain failures). The supervision signal stays on the `
                            + 'task ledger; nudge again if it still matters.');
                    }
                }
                catch (error) {
                    log(`[GroupTaskEngine] Supervisor wake failed for task ${current.id}: `
                        + `${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }
        const pending = page.messages.filter((message) => message.index > current.lastProcessedIndex);
        const counters = { workerReplies: 0, chairAutoReplies: 0 };
        for (const message of pending) {
            const retryKey = `${exports.GROUP_TASK_MSG_RETRY_KV_PREFIX}${current.id}:${message.index}`;
            try {
                const tags = (0, tags_1.parseGroupTaskTags)(message.content);
                current = await applyTagSideEffects(store, current, profile.slug, message, tags, seats, ownerGmid, profile);
                await trackAssignmentAcks(store, current, message, members, tags).catch(() => undefined);
                if (current.status === 'done' || current.status === 'cancelled') {
                    await store.updateTaskCursor(current.id, message.index);
                    break;
                }
                // Remote joins no longer ride the group transcript: the inviter side
                // records a `join` HOST NOTE (see maintainInviterInvites) and the
                // host-notes turn wakes the chair to greet/re-dispatch in its own
                // voice. Historical [GROUP_TASK_NOTICE:openteam_joined] messages stay
                // inert (isHostNotice keeps them out of the responder decision).
                const decisions = (0, tags_1.decideGroupTaskResponders)({
                    message,
                    taskStatus: current.status,
                    hasOpenCheckpoint: await hasOpenCheckpoint(store, current.id),
                    dispatchPaused: current.dispatchPausedAt != null,
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
                    // Poison message: give up on replies, keep the cursor moving — but
                    // run the idempotent tag side effects once so a dying [STATUS:*] or
                    // [DELIVERABLE] line is not lost (IDBots GT#26 parity).
                    try {
                        current = await applyTagSideEffects(store, current, profile.slug, message, (0, tags_1.parseGroupTaskTags)(message.content), seats, ownerGmid, profile);
                    }
                    catch {
                        // Tag reprocess is best-effort; the cursor advances regardless.
                    }
                    await store.updateTaskCursor(current.id, message.index);
                    await store.kvDelete(retryKey);
                    continue;
                }
                break; // fail-stop: later messages wait for this one
            }
        }
        // Review stragglers: NO host re-assert (single-commander — a straggler
        // message after review entry is recorded on the ledger but the host stays
        // silent; the human gate already keeps workers quiet).
        // Assignment ACK watch + member monitors (host-note facts, unreachable,
        // deadline ring, timeout escalation with the L3 private owner brief).
        await monitorAssignmentsAndMembers(store, current, members, seats, ownerGmid, profile.slug, chair ? normalizeGmid(chair.globalMetaId) : null).catch(() => undefined);
        // Host-notes delivery: pending environment facts reach the chair in ONE
        // dedicated turn (the host never posts into the group).
        if (chair) {
            await processHostNotes({
                profile,
                store,
                task: current,
                chair,
                promptSeats,
                chairName,
                ownerGmid,
                recentMessages: page.messages,
            }).catch((error) => {
                log(`[GroupTaskEngine] Host-notes processing failed for task ${current.id}: `
                    + `${error instanceof Error ? error.message : String(error)}`);
            });
        }
    }
    // -------------------------------------------------------------------------
    // OpenTeam: envelope scan (both sides)
    // -------------------------------------------------------------------------
    const inboundReader = options.readInboundPrivateMessages ?? defaultInboundPrivateMessages;
    async function declineGuestInvite(profile, openteam, payload, status, reason) {
        const expiryLagSeconds = status === 'expired'
            ? Math.max(0, Math.floor(now() / 1000) - payload.expiresAt)
            : 0;
        log(`[OpenTeam] Guest invite ${payload.inviteId} (task "${payload.taskTitle}") for `
            + `${profile.slug} from ${payload.inviterName || payload.inviterGlobalMetaId} `
            + `→ ${status}/${reason}`
            + (status === 'expired' ? ` — expired ${expiryLagSeconds}s before processing (engine offline at arrival?)` : ''));
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
                    ? ` Invited for: ${invite.requiredSkills.join(', ')}.`
                    : '';
                // Single-commander: no welcome broadcast from the host — a `join`
                // environment note wakes the chair, which greets the joiner and
                // reconciles the plan in its own voice.
                await store.recordHostNote({
                    taskId: invite.taskId,
                    kind: 'join',
                    target: invite.inviteeName || invite.inviteeGlobalMetaId,
                    body: `${invite.inviteeName || invite.inviteeGlobalMetaId} just joined the task as a remote `
                        + `OpenTeam teammate.${skills} Greet them in the group and fold them into the plan (or state `
                        + 'why the current plan already covers their seat) — never leave a joiner unacknowledged.',
                    dedupeKey: `join:${invite.taskId}:${normalizeGmid(invite.inviteeGlobalMetaId)}`,
                });
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
            // Sender names resolve by identity (inviter snapshot + own profile),
            // never by the spoofable chain nickname (IDBots R-04 parity).
            const senderNames = new Map();
            if (membership.inviterGlobalMetaId && membership.inviterName) {
                senderNames.set(normalizeGmid(membership.inviterGlobalMetaId), membership.inviterName);
            }
            if (profile.globalMetaId && profile.name) {
                senderNames.set(normalizeGmid(profile.globalMetaId), profile.name);
            }
            await (0, backfill_1.syncGroupMessages)({
                store,
                groupId: membership.groupId,
                trustedGlobalMetaIds: new Set((memberIds ?? []).map((id) => normalizeGmid(id))),
                senderNames,
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
                    // Guest file delivery (IDBots parity): local paths mentioned in
                    // the reply are uploaded as metafiles (max 3 per turn, paid by the
                    // guest) and appended as [DELIVERABLE] lines to the same message.
                    const deliverableLines = [];
                    for (const filePath of extractLocalFilePaths(reply).slice(0, 3)) {
                        try {
                            const uploaded = await uploadDeliverableFile({ slug: profile.slug, filePath });
                            deliverableLines.push(`[DELIVERABLE] metafile: ${uploaded.metafileUri}`);
                        }
                        catch (error) {
                            log(`[OpenTeam] Guest deliverable upload failed for ${membership.groupId}: `
                                + `${error instanceof Error ? error.message : String(error)}`);
                        }
                    }
                    const signer = await ctx.signerForSlug(profile.slug);
                    await (0, transport_1.sendGroupMessageOnChain)(signer, membership.groupId, {
                        content: deliverableLines.length > 0
                            ? `${reply}\n${deliverableLines.join('\n')}`
                            : reply,
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
                    + `(${failures}/${GUEST_MSG_RETRY_MAX_FAILURES}): ${error instanceof Error ? error.message : String(error)}`);
                if (failures >= GUEST_MSG_RETRY_MAX_FAILURES) {
                    await openteam.updateMembershipCursor(membership.groupId, profile.slug, message.index);
                    await openteam.kvDelete(retryKey);
                    continue;
                }
                break;
            }
        }
    }
    /**
     * Guest membership self-check (IDBots cadence): the kick envelope may
     * never arrive, so the guest periodically verifies it is still on the
     * on-chain member list; two consecutive absences (after the activation
     * grace) mark the membership left.
     */
    async function runMembershipSelfCheck(profile, openteam, membership) {
        const selfMetaId = (profile.metaId ?? '').trim().toLowerCase();
        if (!selfMetaId)
            return;
        const checkKey = `${exports.GROUP_TASK_GUEST_SELF_CHECK_KV_PREFIX}${membership.groupId}`;
        const last = Number((await openteam.kvGet(checkKey)) ?? '0') || 0;
        if (last && now() - last < GUEST_SELF_CHECK_INTERVAL_MS)
            return;
        await openteam.kvSet(checkKey, String(now()));
        if (membership.activatedAt == null
            || now() - membership.activatedAt < GUEST_ACTIVATION_GRACE_MS) {
            return;
        }
        const members = await (0, transport_1.fetchGroupMembers)(membership.groupId, ctx.transport).catch(() => null);
        if (members == null)
            return; // indexer unreachable: not an absence
        const present = members.some((entry) => String(entry ?? '').trim().toLowerCase() === selfMetaId);
        if (present) {
            await openteam.kvDelete(`${checkKey}:absent`).catch(() => undefined);
            return;
        }
        const absentKey = `${checkKey}:absent`;
        const absences = (Number((await openteam.kvGet(absentKey)) ?? '0') || 0) + 1;
        if (absences < GUEST_SELF_CHECK_ABSENCE_LIMIT) {
            await openteam.kvSet(absentKey, String(absences));
            log(`[OpenTeam] Self-check: ${profile.slug} absent from group ${membership.groupId} `
                + `(${absences}/${GUEST_SELF_CHECK_ABSENCE_LIMIT})`);
            return;
        }
        await openteam.leaveMembership(membership.groupId, profile.slug, 'self_check', 'absent from the on-chain member list twice').catch(() => undefined);
        log(`[OpenTeam] Self-check: ${profile.slug} marked membership ${membership.groupId} left `
            + '(2-strike absence)');
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
                await runMembershipSelfCheck(profile, openteam, membership);
            }
            catch (error) {
                log(`[OpenTeam] Self-check failed for group ${membership.groupId}: `
                    + `${error instanceof Error ? error.message : String(error)}`);
            }
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
        const tickStartedAt = now();
        try {
            const profiles = await ctx.listProfiles();
            log(`[GroupTaskEngine] Tick over ${profiles.length} profiles started`);
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
            const elapsed = now() - tickStartedAt;
            if (elapsed > 30_000) {
                log(`[GroupTaskEngine] Tick took ${Math.round(elapsed / 1000)}s — investigate the slow phase`);
            }
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
