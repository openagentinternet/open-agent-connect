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
import { validateStaffingPlan, type GroupTaskStaffingOwnerDecision, type GroupTaskStaffingSeat, type StaffingSessionMessage } from './staffing';
import { type GroupTaskStaffingProposalRecord, type StaffingOwnerDecisionMarker } from './staffingStore';
import { createGroupTask, GroupTaskServiceError, type GroupTaskServiceContext } from './service';
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
export declare function proposeGroupTaskStaffing(ctx: GroupTaskServiceContext, input: ProposeStaffingInput, now?: () => number): Promise<ProposeStaffingResult>;
export declare function recordStaffingOwnerDecision(ctx: GroupTaskServiceContext, chairSlug: string, proposalId: number, decision: StaffingOwnerDecisionMarker): Promise<GroupTaskStaffingProposalRecord>;
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
export declare function evaluateStaffingOwnerGate(ctx: GroupTaskServiceContext, input: EvaluateStaffingGateInput): Promise<StaffingGateOutcome>;
export interface CreateFromProposalResult {
    chairSlug: string;
    task: Awaited<ReturnType<typeof createGroupTask>>;
    pendingRemoteSeats: GroupTaskStaffingSeat[];
    decision: GroupTaskStaffingOwnerDecision;
}
export declare function createGroupTaskFromProposal(ctx: GroupTaskServiceContext, input: EvaluateStaffingGateInput): Promise<CreateFromProposalResult>;
export declare function listStaffingProposals(ctx: GroupTaskServiceContext, chairSlug?: string): Promise<GroupTaskStaffingProposalRecord[]>;
export { GroupTaskServiceError };
