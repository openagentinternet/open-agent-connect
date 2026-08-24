/**
 * Group-task staffing: decompose → coarse seats → one bot per seat →
 * owner-confirm (unless the triggering wish said "just start") → create.
 *
 * OAC port of the IDBots groupTaskStaffing module (2026-08-22 release,
 * review fixes through 2026-08-24): the pattern tables, the interrogative
 * skip filter, the last-intent owner gate, and the 24 h proposal TTL are
 * ported verbatim so both clients behave identically around a shared slate.
 * Local seats are identified by profile slug (OAC has no numeric metabot
 * ids); remote seats by GlobalMetaId, exactly like the OpenTeam envelope.
 *
 * Research is a basic capability of every seat, not a seat of its own.
 * Match-first; local is a tie-break, not a gate.
 */
export declare const GROUP_TASK_SEAT_ROLES: readonly ["content", "design", "engineering", "promotion", "domain"];
export type GroupTaskSeatRole = (typeof GROUP_TASK_SEAT_ROLES)[number];
export declare const GROUP_TASK_TYPICAL_TEAM_SIZE = 5;
export declare const GROUP_TASK_HARD_TEAM_SIZE = 8;
export type GroupTaskStaffingProposalStatus = 'pending' | 'confirmed' | 'skip_authorized' | 'consumed' | 'cancelled';
export type GroupTaskStaffingOwnerDecision = 'skip_authorized' | 'owner_confirmed' | 'owner_revise' | 'awaiting_owner';
export interface GroupTaskStaffingStage {
    id: string;
    title: string;
    seatRole: GroupTaskSeatRole;
    dependsOn: string[];
}
export interface GroupTaskStaffingSeat {
    role: GroupTaskSeatRole;
    /** Required when role is `domain` (e.g. "legal"). */
    domainLabel?: string;
    candidateName: string;
    candidateSlug?: string;
    candidateGlobalMetaId?: string;
    source: 'local' | 'remote';
    reason: string;
    backupName?: string;
}
export interface GroupTaskStaffingPlan {
    stages: GroupTaskStaffingStage[];
    seats: GroupTaskStaffingSeat[];
}
export interface StaffingSessionMessage {
    type: string;
    content: string;
    timestamp: number;
}
export interface StaffingPlanValidation {
    ok: boolean;
    errors: string[];
    warnings: string[];
    teamSize: number;
}
export declare class GroupTaskStaffingError extends Error {
    readonly code: 'STAFFING_PLAN_INVALID' | 'OWNER_CONFIRM_REQUIRED' | 'OWNER_REVISE_REQUIRED' | 'PROPOSAL_NOT_FOUND' | 'PROPOSAL_NOT_USABLE' | 'ROSTER_CAP_EXCEEDED' | 'SOURCE_SESSION_REQUIRED';
    constructor(code: GroupTaskStaffingError['code'], message: string);
}
/** Pending / confirmed / skip-authorized slates expire after 24h. */
export declare const STAFFING_PROPOSAL_TTL_MS: number;
export declare function normalizeStaffingPlan(raw: unknown): GroupTaskStaffingPlan;
export declare function validateStaffingPlan(plan: GroupTaskStaffingPlan): StaffingPlanValidation;
export declare function detectSkipConfirmInWish(text: string): boolean;
export declare function classifyOwnerStaffingReply(text: string): 'confirm' | 'revise' | 'unknown';
export declare function pickTriggeringWishText(messages: StaffingSessionMessage[], atOrBeforeMs: number): string;
export declare function isStaffingProposalExpired(createdAt: number, nowMs: number): boolean;
export declare function resolveStaffingOwnerGate(input: {
    triggeringWish: string;
    repliesAfterPropose: string[];
    persistedSkip?: boolean;
}): {
    allowed: boolean;
    decision: GroupTaskStaffingOwnerDecision;
};
export declare function splitSessionMessagesForStaffingGate(messages: StaffingSessionMessage[], proposedAtMs: number): {
    triggeringWish: string;
    repliesAfterPropose: string[];
};
export declare function localSeatSlugs(plan: GroupTaskStaffingPlan): string[];
export declare function remoteSeats(plan: GroupTaskStaffingPlan): GroupTaskStaffingSeat[];
export declare function buildStaffingSlateText(input: {
    title: string;
    goal: string;
    acceptanceCriteria?: string | null;
    plan: GroupTaskStaffingPlan;
    ownerConfirmRequired: boolean;
    language?: 'zh' | 'en';
}): string;
export declare function assertCreateRosterCap(workerCount: number): void;
