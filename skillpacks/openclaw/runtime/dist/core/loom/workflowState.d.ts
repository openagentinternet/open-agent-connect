import type { LoomCachedRecord, LoomRawCacheState } from './rawCache';
import type { LoomDerivedTaskState } from './workflowTypes';
export interface LoomWorkflowStateInvalidReason {
    code: string;
    message: string;
}
export interface LoomWorkflowStateInvalidRecord {
    record: LoomCachedRecord;
    reason: LoomWorkflowStateInvalidReason;
}
export interface LoomWorkflowTaskStateBuckets {
    claims: LoomCachedRecord[];
    statuses: LoomCachedRecord[];
    deliveries: LoomCachedRecord[];
    acceptances: LoomCachedRecord[];
    claimRejects: LoomCachedRecord[];
}
export interface LoomWorkflowTaskInvalidBuckets {
    tasks: LoomWorkflowStateInvalidRecord[];
    claims: LoomWorkflowStateInvalidRecord[];
    statuses: LoomWorkflowStateInvalidRecord[];
    deliveries: LoomWorkflowStateInvalidRecord[];
    acceptances: LoomWorkflowStateInvalidRecord[];
    claimRejects: LoomWorkflowStateInvalidRecord[];
}
export interface LoomWorkflowTaskStateFound {
    found: true;
    taskPinId: string;
    state: LoomDerivedTaskState;
    task: LoomCachedRecord;
    valid: LoomWorkflowTaskStateBuckets;
    invalid: LoomWorkflowTaskInvalidBuckets;
    latestStatus?: LoomCachedRecord;
    latestDelivery?: LoomCachedRecord;
    latestAcceptance?: LoomCachedRecord;
    paymentTxId?: string;
}
export interface LoomWorkflowTaskStateNotFound {
    found: false;
    code: 'task_not_found';
    message: string;
    taskPinId: string;
    state?: never;
    task?: never;
    valid: LoomWorkflowTaskStateBuckets;
    invalid: LoomWorkflowTaskInvalidBuckets;
    latestStatus?: never;
    latestDelivery?: never;
    latestAcceptance?: never;
    paymentTxId?: never;
}
export type LoomWorkflowTaskState = LoomWorkflowTaskStateFound | LoomWorkflowTaskStateNotFound;
export interface BuildLoomWorkflowTaskStateOptions {
    includeUnrelatedInvalid?: boolean;
}
export declare function buildLoomWorkflowTaskState(rawState: LoomRawCacheState, taskPinId: string, _options?: BuildLoomWorkflowTaskStateOptions): LoomWorkflowTaskState;
export declare function findLatestValidDelivery(state: LoomWorkflowTaskState, deliveryPinId?: string): LoomCachedRecord | undefined;
export declare function findValidClaimForDelivery(state: LoomWorkflowTaskState, deliveryPinId: string): LoomCachedRecord | undefined;
