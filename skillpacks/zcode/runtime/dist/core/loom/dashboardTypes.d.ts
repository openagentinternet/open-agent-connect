import type { LoomCachedRecord, LoomRawCacheState } from './rawCache';
import type { LoomDerivedTaskState, LoomWorkflowCommitRecord, LoomWorkflowState } from './workflowTypes';
export type LoomDashboardTaskState = LoomDerivedTaskState;
export type LoomDashboardStateTone = 'neutral' | 'info' | 'progress' | 'review' | 'warning' | 'success' | 'danger';
export type LoomDashboardColumnId = 'open' | 'claimed' | 'working' | 'review' | 'revision' | 'closed';
export type LoomDashboardTimelineEventKind = 'task' | 'claim' | 'status' | 'delivery' | 'acceptance' | 'claim_reject' | 'local_workflow' | 'invalid_record';
export type LoomDashboardBotRole = 'requester' | 'developer' | 'reviewer' | 'unknown';
export type LoomDashboardActionId = 'postTask' | 'claimAndStart' | 'runDevRound' | 'deliver' | 'acceptAndPay' | 'requestRevision' | 'reject' | 'openPr' | 'copyCli';
export interface LoomDashboardNextAction {
    id: LoomDashboardActionId;
    label: string;
    tone: 'primary' | 'neutral' | 'warning' | 'danger';
    actorRole: 'requester' | 'developer' | 'any';
    requiresActor: boolean;
    requiresConfirmation: boolean;
    disabledReason?: string;
    cliFallback?: string;
}
export interface LoomDashboardIdentityProfile {
    displayName?: string;
    name?: string;
    avatarUri?: string;
    avatarUrl?: string;
}
export type LoomDashboardIdentityMap = Record<string, LoomDashboardIdentityProfile | undefined>;
export interface LoomDashboardBotIdentity {
    role: LoomDashboardBotRole;
    displayName: string;
    fallbackLabel: string;
    initials: string;
    globalMetaId?: string;
    address?: string;
    avatarUri?: string;
}
export interface LoomDashboardActorContext {
    profileSlug?: string;
    globalMetaId?: string;
    address?: string;
}
export interface LoomDashboardTaskActorContext {
    isRequester: boolean;
    isDeveloper: boolean;
    needsMyAction: boolean;
    role: 'requester' | 'developer' | 'both' | 'none';
}
export interface LoomDashboardFilters {
    state?: LoomDashboardTaskState | LoomDashboardColumnId;
    role?: 'all' | 'requester' | 'developer' | 'needs_action';
    query?: string;
    limit?: number;
}
export interface LoomDashboardWarning {
    taskPinId: string;
    recordPinId: string;
    protocol: LoomCachedRecord['protocol'];
    code: string;
    message: string;
    timestamp: number;
}
export interface LoomDashboardTimelineEvent {
    id: string;
    kind: LoomDashboardTimelineEventKind;
    taskPinId: string;
    timestamp: number;
    title: string;
    summary?: string;
    pinId?: string;
    protocol?: LoomCachedRecord['protocol'];
    warningCode?: string;
}
export interface LoomDashboardLocalEvidence {
    claimPinId: string;
    developerMetaBotSlug: string;
    branchName: string;
    workspacePath: string;
    updatedAt: string;
    llmSessionIds: string[];
    processLogPaths: string[];
    processLogUris: string[];
    commits: LoomWorkflowCommitRecord[];
}
export interface LoomDashboardClaimSummary {
    pinId: string;
    taskPinId: string;
    timestamp: number;
    active: boolean;
    payoutAddress?: string;
    message?: string;
    developer: LoomDashboardBotIdentity;
}
export interface LoomDashboardTaskCard {
    taskPinId: string;
    state: LoomDashboardTaskState;
    stateTone: LoomDashboardStateTone;
    columnId: LoomDashboardColumnId;
    title: string;
    requester: LoomDashboardBotIdentity;
    developer?: LoomDashboardBotIdentity;
    bounty?: {
        amount?: string;
        currency?: string;
    };
    repo?: {
        repoUri?: string;
        baseBranch?: string;
    };
    tags: string[];
    createdAt: number;
    updatedAt: number;
    activeClaimCount: number;
    latestStatusSummary?: string;
    summaryPreview?: string;
    prUrl?: string;
    paymentTxId?: string;
    warningCount: number;
    actorContext: LoomDashboardTaskActorContext;
    nextAction?: LoomDashboardNextAction;
    local?: LoomDashboardLocalEvidence;
}
export interface LoomDashboardTaskDetail {
    taskPinId: string;
    state: LoomDashboardTaskState;
    columnId: LoomDashboardColumnId;
    title: string;
    requirement?: string;
    criteria?: string;
    requester: LoomDashboardBotIdentity;
    claims: LoomDashboardClaimSummary[];
    warnings: LoomDashboardWarning[];
    timeline: LoomDashboardTimelineEvent[];
    localWorkflow: LoomDashboardLocalEvidence[];
    nextActions: LoomDashboardNextAction[];
    task: LoomCachedRecord;
    validRecords: {
        claims: LoomCachedRecord[];
        statuses: LoomCachedRecord[];
        deliveries: LoomCachedRecord[];
        acceptances: LoomCachedRecord[];
        claimRejects: LoomCachedRecord[];
    };
}
export interface LoomDashboardColumn {
    id: LoomDashboardColumnId;
    title: string;
    states: LoomDashboardTaskState[];
    cards: LoomDashboardTaskCard[];
}
export interface LoomDashboardSummary {
    totalTasks: number;
    open: number;
    claimed: number;
    inProgress: number;
    delivered: number;
    revisionNeeded: number;
    rejected: number;
    acceptedPaid: number;
    failed: number;
    invalidRecords: number;
    needsMyAction: number;
    newestActivityAt?: number;
}
export interface LoomDashboardRefreshState {
    requested: boolean;
    succeeded: boolean;
    updatedAt?: number;
    warning?: string | null;
}
export interface LoomDashboardState {
    version: 1;
    updatedAt: number;
    rawCacheUpdatedAt: number;
    actor?: LoomDashboardActorContext;
    summary: LoomDashboardSummary;
    filters: LoomDashboardFilters;
    columns: LoomDashboardColumn[];
    tasks: LoomDashboardTaskCard[];
    details: LoomDashboardTaskDetail[];
    warnings: LoomDashboardWarning[];
    refresh: LoomDashboardRefreshState;
}
export type LoomDashboardStateModel = LoomDashboardState;
export interface BuildLoomDashboardOptions {
    workflowStates?: LoomWorkflowState[];
    actorContext?: LoomDashboardActorContext;
    identityMap?: LoomDashboardIdentityMap;
    filters?: LoomDashboardFilters;
    now?: number;
    refresh?: Partial<LoomDashboardRefreshState>;
}
export interface BuildLoomDashboardInput {
    rawState: LoomRawCacheState;
    options?: BuildLoomDashboardOptions;
}
