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

import {
  GroupTaskStaffingError,
  assertCreateRosterCap,
  buildStaffingSlateText,
  detectSkipConfirmInWish,
  isStaffingProposalExpired,
  localSeatSlugs,
  normalizeStaffingPlan,
  remoteSeats,
  resolveStaffingOwnerGate,
  splitSessionMessagesForStaffingGate,
  validateStaffingPlan,
  type GroupTaskStaffingOwnerDecision,
  type GroupTaskStaffingPlan,
  type GroupTaskStaffingSeat,
  type StaffingSessionMessage,
} from './staffing';
import {
  staffingProposalUsableAt,
  type GroupTaskStaffingProposalRecord,
  type StaffingOwnerDecisionMarker,
} from './staffingStore';
import {
  createGroupTask,
  requireProfile,
  resolveChairProfile,
  staffingStoreFor,
  GroupTaskServiceError,
  type GroupTaskServiceContext,
} from './service';

export interface ProposeStaffingInput {
  chairSlug?: string;
  title: string;
  goal: string;
  acceptanceCriteria?: string | null;
  plan: unknown;
  /** The user message that triggered this proposal (skip-confirm detection). */
  triggeringWish?: string;
  sourceSessionId?: string | null;
  language?: 'zh' | 'en';
}

export interface ProposeStaffingResult {
  proposal: GroupTaskStaffingProposalRecord;
  slateText: string;
  ownerConfirmRequired: boolean;
  validation: ReturnType<typeof validateStaffingPlan>;
}

export async function proposeGroupTaskStaffing(
  ctx: GroupTaskServiceContext,
  input: ProposeStaffingInput,
  now: () => number = Date.now,
): Promise<ProposeStaffingResult> {
  const chair = input.chairSlug?.trim()
    ? await requireProfile(ctx, input.chairSlug)
    : await resolveChairProfile(ctx);

  const plan = normalizeStaffingPlan(input.plan);
  const validation = validateStaffingPlan(plan);
  if (!validation.ok) {
    throw new GroupTaskStaffingError(
      'STAFFING_PLAN_INVALID',
      `Staffing plan invalid: ${validation.errors.join('; ')}`,
    );
  }

  const triggeringWish = input.triggeringWish?.trim() ?? '';
  const skipAuthorized = detectSkipConfirmInWish(triggeringWish);
  const store = staffingStoreFor(ctx, chair);
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
  const slateText = buildStaffingSlateText({
    title: input.title,
    goal: input.goal,
    acceptanceCriteria: input.acceptanceCriteria ?? null,
    plan,
    ownerConfirmRequired,
    language: input.language,
  });
  return { proposal, slateText, ownerConfirmRequired, validation };
}

export async function recordStaffingOwnerDecision(
  ctx: GroupTaskServiceContext,
  chairSlug: string,
  proposalId: number,
  decision: StaffingOwnerDecisionMarker,
): Promise<GroupTaskStaffingProposalRecord> {
  const chair = await requireProfile(ctx, chairSlug);
  return staffingStoreFor(ctx, chair).setOwnerDecision(proposalId, decision);
}

export interface EvaluateStaffingGateInput {
  chairSlug?: string;
  proposalId: number;
  /** Optional session transcript; replies after the proposal drive the gate. */
  sessionMessages?: StaffingSessionMessage[];
  now?: () => number;
}

export interface StaffingGateOutcome {
  allowed: boolean;
  decision: GroupTaskStaffingOwnerDecision;
  proposal: GroupTaskStaffingProposalRecord;
}

export async function evaluateStaffingOwnerGate(
  ctx: GroupTaskServiceContext,
  input: EvaluateStaffingGateInput,
): Promise<StaffingGateOutcome> {
  const now = input.now ?? Date.now;
  const chair = input.chairSlug?.trim()
    ? await requireProfile(ctx, input.chairSlug)
    : await resolveChairProfile(ctx);
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
    const { triggeringWish, repliesAfterPropose } = splitSessionMessagesForStaffingGate(
      input.sessionMessages,
      proposal.createdAt,
    );
    const gate = resolveStaffingOwnerGate({
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

export interface CreateFromProposalResult {
  chairSlug: string;
  task: Awaited<ReturnType<typeof createGroupTask>>;
  pendingRemoteSeats: GroupTaskStaffingSeat[];
  decision: GroupTaskStaffingOwnerDecision;
}

export async function createGroupTaskFromProposal(
  ctx: GroupTaskServiceContext,
  input: EvaluateStaffingGateInput,
): Promise<CreateFromProposalResult> {
  const now = input.now ?? Date.now;
  const gate = await evaluateStaffingOwnerGate(ctx, input);
  if (!gate.allowed) {
    const code = gate.decision === 'owner_revise' ? 'OWNER_REVISE_REQUIRED' : 'OWNER_CONFIRM_REQUIRED';
    throw new GroupTaskStaffingError(
      code,
      gate.decision === 'owner_revise'
        ? 'The owner asked for a revised roster before creating the group task.'
        : 'Owner confirmation is required before creating the group task.',
    );
  }

  const plan: GroupTaskStaffingPlan = gate.proposal.plan;
  assertCreateRosterCap(plan.seats.length);

  const store = staffingStoreFor(
    ctx,
    await requireProfile(ctx, gate.proposal.chairSlug),
  );
  // CAS claim: a concurrent create cannot double-open the on-chain group.
  await store.claimProposal(input.proposalId);
  try {
    const created = await createGroupTask(ctx, {
      title: gate.proposal.title,
      goal: gate.proposal.goal,
      acceptanceCriteria: gate.proposal.acceptanceCriteria,
      workerSlugs: localSeatSlugs(plan),
      chairSlug: gate.proposal.chairSlug,
      createdBy: 'twinbot',
      sourceSessionId: gate.proposal.sourceSessionId,
    });
    await store.markProposalCreated(input.proposalId, created.task.id);
    return {
      chairSlug: gate.proposal.chairSlug,
      task: created,
      pendingRemoteSeats: remoteSeats(plan),
      decision: gate.decision,
    };
  } catch (error) {
    // Release the claim so the slate is not burned by a failed chain create.
    await store.releaseProposal(input.proposalId).catch(() => undefined);
    throw error;
  }
}

export async function listStaffingProposals(
  ctx: GroupTaskServiceContext,
  chairSlug?: string,
): Promise<GroupTaskStaffingProposalRecord[]> {
  const chair = chairSlug?.trim()
    ? await requireProfile(ctx, chairSlug)
    : await resolveChairProfile(ctx);
  const now = Date.now();
  const rows = await staffingStoreFor(ctx, chair).listProposals();
  return rows.filter((row) => !isStaffingProposalExpired(row.createdAt, now) || row.createdTaskId !== null);
}

async function requireUsableProposal(
  ctx: GroupTaskServiceContext,
  chair: { slug: string },
  proposalId: number,
  nowMs: number,
): Promise<GroupTaskStaffingProposalRecord> {
  const store = staffingStoreFor(ctx, await requireProfile(ctx, chair.slug));
  const proposal = await store.getProposal(proposalId);
  if (!proposal) {
    throw new GroupTaskStaffingError('PROPOSAL_NOT_FOUND', `Staffing proposal ${proposalId} not found`);
  }
  const usable = staffingProposalUsableAt(proposal, nowMs);
  if (!usable.usable) {
    throw new GroupTaskStaffingError(
      'PROPOSAL_NOT_USABLE',
      `Staffing proposal ${proposalId} is not usable (${usable.reason})`,
    );
  }
  return proposal;
}

export { GroupTaskServiceError };
