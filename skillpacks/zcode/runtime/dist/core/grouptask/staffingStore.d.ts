/**
 * Staffing proposal store: file-backed CRUD for the wish→slate→owner-gate
 * pipeline (OAC port of the IDBots `group_task_staffing_proposals` table).
 *
 * Layout (storage layout v2, under the CHAIR profile's grouptask root):
 *   .runtime/grouptask/staffing.json — proposals + id sequence
 *
 * Writes are atomic (tmp + rename) and serialized through an in-process
 * queue; the daemon is the only writer (CLI verbs delegate over HTTP). The
 * claim/release pair is the CAS that keeps two concurrent create attempts
 * from double-opening an on-chain group: `claim` only succeeds while the
 * proposal sits in a creatable state, `release` restores that state when the
 * chain create failed so the slate is not burned.
 */
import type { MetabotPaths } from '../state/paths';
import { type GroupTaskStaffingPlan, type GroupTaskStaffingProposalStatus } from './staffing';
export type StaffingOwnerDecisionMarker = 'confirm' | 'revise' | 'skip';
export interface GroupTaskStaffingProposalRecord {
    id: number;
    chairSlug: string;
    sourceSessionId: string | null;
    title: string;
    goal: string;
    acceptanceCriteria: string | null;
    plan: GroupTaskStaffingPlan;
    status: GroupTaskStaffingProposalStatus;
    skipAuthorized: boolean;
    /** Last explicit owner decision recorded via UI/CLI ('confirm'|'revise'|'skip'). */
    ownerDecision: StaffingOwnerDecisionMarker | null;
    createdTaskId: number | null;
    createdAt: number;
    confirmedAt: number | null;
    updatedAt: number;
}
export interface CreateStaffingProposalInput {
    chairSlug: string;
    sourceSessionId?: string | null;
    title: string;
    goal: string;
    acceptanceCriteria?: string | null;
    plan: unknown;
    skipAuthorized: boolean;
}
export declare class StaffingStoreError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export interface StaffingStore {
    /** Absolute staffing file path (…/.runtime/grouptask/staffing.json). */
    readonly filePath: string;
    createProposal(input: CreateStaffingProposalInput): Promise<GroupTaskStaffingProposalRecord>;
    listProposals(options?: {
        status?: GroupTaskStaffingProposalStatus;
    }): Promise<GroupTaskStaffingProposalRecord[]>;
    getProposal(id: number): Promise<GroupTaskStaffingProposalRecord | null>;
    /** CAS: consumed only while the proposal is still creatable. */
    claimProposal(id: number): Promise<GroupTaskStaffingProposalRecord>;
    /** Restores the pre-claim creatable state after a failed chain create. */
    releaseProposal(id: number): Promise<GroupTaskStaffingProposalRecord>;
    /** Records the created task on a claimed proposal. */
    markProposalCreated(id: number, taskId: number): Promise<GroupTaskStaffingProposalRecord>;
    setOwnerDecision(id: number, decision: StaffingOwnerDecisionMarker): Promise<GroupTaskStaffingProposalRecord>;
    cancelProposal(id: number): Promise<GroupTaskStaffingProposalRecord>;
}
export declare function createStaffingStore(paths: MetabotPaths): StaffingStore;
/** Read-time usability check shared by the service gate. */
export declare function staffingProposalUsableAt(record: GroupTaskStaffingProposalRecord, nowMs: number): {
    usable: boolean;
    reason: 'ok' | 'consumed' | 'cancelled' | 'created' | 'expired';
};
