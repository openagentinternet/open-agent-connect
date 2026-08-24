"use strict";
/**
 * Staffing service — the wish → slate → owner-gate → staffed-task pipeline
 * (OAC port of the IDBots staffing flow, 2026-08-22/24 release).
 *
 * propose: validate the twin's plan, persist a proposal, hand back the slate
 * text for the owner. decide: record the owner's explicit confirm/revise/skip
 * (the DSH slate card is the primary surface; the chat-reply classifier from
 * staffing.ts still drives gate evaluation whenever a session transcript is
 * supplied, e.g. CLI-driven flows). create: gate → CAS claim →
 * createGroupTask with the confirmed local seats; remote seats are returned
 * as `pendingRemoteSeats` for OpenTeam invites.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupTaskServiceError = void 0;
exports.proposeGroupTaskStaffing = proposeGroupTaskStaffing;
exports.recordStaffingOwnerDecision = recordStaffingOwnerDecision;
exports.evaluateStaffingOwnerGate = evaluateStaffingOwnerGate;
exports.createGroupTaskFromProposal = createGroupTaskFromProposal;
exports.listStaffingProposals = listStaffingProposals;
const staffing_1 = require("./staffing");
const staffingStore_1 = require("./staffingStore");
const service_1 = require("./service");
Object.defineProperty(exports, "GroupTaskServiceError", { enumerable: true, get: function () { return service_1.GroupTaskServiceError; } });
async function proposeGroupTaskStaffing(ctx, input, now = Date.now) {
    const chair = input.chairSlug?.trim()
        ? await (0, service_1.requireProfile)(ctx, input.chairSlug)
        : await (0, service_1.resolveChairProfile)(ctx);
    const plan = (0, staffing_1.normalizeStaffingPlan)(input.plan);
    const validation = (0, staffing_1.validateStaffingPlan)(plan);
    if (!validation.ok) {
        throw new staffing_1.GroupTaskStaffingError('STAFFING_PLAN_INVALID', `Staffing plan invalid: ${validation.errors.join('; ')}`);
    }
    const triggeringWish = input.triggeringWish?.trim() ?? '';
    const skipAuthorized = (0, staffing_1.detectSkipConfirmInWish)(triggeringWish);
    const store = (0, service_1.staffingStoreFor)(ctx, chair);
    const proposal = await store.createProposal({
        chairSlug: chair.slug,
        sourceSessionId: input.sourceSessionId ?? null,
        title: input.title,
        goal: input.goal,
        acceptanceCriteria: input.acceptanceCriteria ?? null,
        plan,
        skipAuthorized,
    });
    const ownerConfirmRequired = !skipAuthorized;
    const slateText = (0, staffing_1.buildStaffingSlateText)({
        title: input.title,
        goal: input.goal,
        acceptanceCriteria: input.acceptanceCriteria ?? null,
        plan,
        ownerConfirmRequired,
        language: input.language,
    });
    return { proposal, slateText, ownerConfirmRequired, validation };
}
async function recordStaffingOwnerDecision(ctx, chairSlug, proposalId, decision) {
    const chair = await (0, service_1.requireProfile)(ctx, chairSlug);
    return (0, service_1.staffingStoreFor)(ctx, chair).setOwnerDecision(proposalId, decision);
}
async function evaluateStaffingOwnerGate(ctx, input) {
    const now = input.now ?? Date.now;
    const chair = input.chairSlug?.trim()
        ? await (0, service_1.requireProfile)(ctx, input.chairSlug)
        : await (0, service_1.resolveChairProfile)(ctx);
    const proposal = await requireUsableProposal(ctx, chair, input.proposalId, now());
    // 1. Explicit recorded decision wins (DSH slate card / CLI verb).
    if (proposal.ownerDecision === 'confirm') {
        return { allowed: true, decision: 'owner_confirmed', proposal };
    }
    if (proposal.ownerDecision === 'skip') {
        return { allowed: true, decision: 'skip_authorized', proposal };
    }
    if (proposal.ownerDecision === 'revise') {
        return { allowed: false, decision: 'owner_revise', proposal };
    }
    // 2. Chat replies after the propose (last-intent gate), when a transcript
    //    is available (CLI/session-driven flows).
    if (input.sessionMessages?.length) {
        const { triggeringWish, repliesAfterPropose } = (0, staffing_1.splitSessionMessagesForStaffingGate)(input.sessionMessages, proposal.createdAt);
        const gate = (0, staffing_1.resolveStaffingOwnerGate)({
            triggeringWish,
            repliesAfterPropose,
            persistedSkip: proposal.skipAuthorized,
        });
        return { ...gate, proposal };
    }
    // 3. Fall back to the persisted skip flag from the triggering wish.
    if (proposal.skipAuthorized) {
        return { allowed: true, decision: 'skip_authorized', proposal };
    }
    return { allowed: false, decision: 'awaiting_owner', proposal };
}
async function createGroupTaskFromProposal(ctx, input) {
    const now = input.now ?? Date.now;
    const gate = await evaluateStaffingOwnerGate(ctx, input);
    if (!gate.allowed) {
        const code = gate.decision === 'owner_revise' ? 'OWNER_REVISE_REQUIRED' : 'OWNER_CONFIRM_REQUIRED';
        throw new staffing_1.GroupTaskStaffingError(code, gate.decision === 'owner_revise'
            ? 'The owner asked for a revised roster before creating the group task.'
            : 'Owner confirmation is required before creating the group task.');
    }
    const plan = gate.proposal.plan;
    (0, staffing_1.assertCreateRosterCap)(plan.seats.length);
    const store = (0, service_1.staffingStoreFor)(ctx, await (0, service_1.requireProfile)(ctx, gate.proposal.chairSlug));
    // CAS claim: a concurrent create cannot double-open the on-chain group.
    await store.claimProposal(input.proposalId);
    try {
        const created = await (0, service_1.createGroupTask)(ctx, {
            title: gate.proposal.title,
            goal: gate.proposal.goal,
            acceptanceCriteria: gate.proposal.acceptanceCriteria,
            workerSlugs: (0, staffing_1.localSeatSlugs)(plan),
            chairSlug: gate.proposal.chairSlug,
            createdBy: 'twinbot',
        });
        await store.markProposalCreated(input.proposalId, created.task.id);
        return {
            chairSlug: gate.proposal.chairSlug,
            task: created,
            pendingRemoteSeats: (0, staffing_1.remoteSeats)(plan),
            decision: gate.decision,
        };
    }
    catch (error) {
        // Release the claim so the slate is not burned by a failed chain create.
        await store.releaseProposal(input.proposalId).catch(() => undefined);
        throw error;
    }
}
async function listStaffingProposals(ctx, chairSlug) {
    const chair = chairSlug?.trim()
        ? await (0, service_1.requireProfile)(ctx, chairSlug)
        : await (0, service_1.resolveChairProfile)(ctx);
    const now = Date.now();
    const rows = await (0, service_1.staffingStoreFor)(ctx, chair).listProposals();
    return rows.filter((row) => !(0, staffing_1.isStaffingProposalExpired)(row.createdAt, now) || row.createdTaskId !== null);
}
async function requireUsableProposal(ctx, chair, proposalId, nowMs) {
    const store = (0, service_1.staffingStoreFor)(ctx, await (0, service_1.requireProfile)(ctx, chair.slug));
    const proposal = await store.getProposal(proposalId);
    if (!proposal) {
        throw new staffing_1.GroupTaskStaffingError('PROPOSAL_NOT_FOUND', `Staffing proposal ${proposalId} not found`);
    }
    const usable = (0, staffingStore_1.staffingProposalUsableAt)(proposal, nowMs);
    if (!usable.usable) {
        throw new staffing_1.GroupTaskStaffingError('PROPOSAL_NOT_USABLE', `Staffing proposal ${proposalId} is not usable (${usable.reason})`);
    }
    return proposal;
}
