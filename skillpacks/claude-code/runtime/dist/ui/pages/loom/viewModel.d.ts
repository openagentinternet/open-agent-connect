import type { LoomDashboardActionId, LoomDashboardColumnId, LoomDashboardStateTone } from '../../../core/loom/dashboardTypes';
type PlainObject = Record<string, unknown>;
export interface LoomCopyLabelViewModel {
    label: string;
    copyValue: string;
}
export interface LoomMetricViewModel {
    id: string;
    label: string;
    value: string;
    tone: 'neutral' | 'warning';
}
export interface LoomBotViewModel {
    displayName: string;
    initials: string;
    fallbackLabel: string;
    globalMetaId: string;
    address: string;
    avatarUri: string | null;
    role: string;
}
export interface LoomActorViewModel {
    profileSlug: string;
    displayLabel: string;
    globalMetaId: LoomCopyLabelViewModel;
    address: LoomCopyLabelViewModel | null;
}
export interface LoomCardViewModel {
    taskPinId: string;
    taskPin: LoomCopyLabelViewModel;
    title: string;
    state: string;
    stateLabel: string;
    stateTone: LoomDashboardStateTone;
    columnId: LoomDashboardColumnId;
    requester: LoomBotViewModel;
    developer: LoomBotViewModel | null;
    bountyLabel: string;
    repoLabel: string;
    tags: string[];
    summaryPreview: string;
    activityLabel: string;
    latestStatusSummary: string;
    prUrl: string;
    paymentTxId: LoomCopyLabelViewModel | null;
    warningCount: number;
    warningLabel: string;
    warningTone: 'neutral' | 'warning';
    actionLabel: string;
    updatedAt: number;
    createdAt: number;
}
export interface LoomColumnViewModel {
    id: LoomDashboardColumnId;
    title: string;
    cards: LoomCardViewModel[];
}
export interface LoomTimelineEventViewModel {
    id: string;
    kind: string;
    title: string;
    summary: string;
    timestamp: number;
    pin: LoomCopyLabelViewModel | null;
    tone: 'neutral' | 'warning';
}
export interface LoomWarningViewModel {
    code: string;
    message: string;
    protocol: string;
    timestamp: number;
    pin: LoomCopyLabelViewModel;
    tone: 'warning';
}
export interface LoomClaimViewModel {
    pin: LoomCopyLabelViewModel;
    active: boolean;
    message: string;
    timestamp: number;
    payoutAddress: string;
    developer: LoomBotViewModel;
}
export interface LoomCommitViewModel {
    sha: string;
    message: string;
    files: string[];
}
export interface LoomLocalWorkflowViewModel {
    claimPinId: string;
    developerMetaBotSlug: string;
    branchName: string;
    workspacePath: string;
    llmSessionIds: string[];
    processLogPaths: string[];
    processLogUris: string[];
    commits: LoomCommitViewModel[];
}
export interface LoomRecordViewModel {
    pin: LoomCopyLabelViewModel;
    timestamp: number;
    globalMetaId: string;
    address: string;
    payload: PlainObject;
}
export interface LoomNextActionViewModel {
    id: LoomDashboardActionId;
    label: string;
    tone: 'primary' | 'neutral' | 'warning' | 'danger';
    actorRole: 'requester' | 'developer' | 'any';
    requiresActor: boolean;
    requiresConfirmation: boolean;
    disabledReason: string;
    cliFallback: string;
}
export interface LoomDetailViewModel {
    taskPinId: string;
    taskPin: LoomCopyLabelViewModel;
    title: string;
    state: string;
    stateLabel: string;
    columnId: LoomDashboardColumnId;
    requirement: string;
    criteria: string;
    requester: LoomBotViewModel;
    claims: LoomClaimViewModel[];
    warnings: LoomWarningViewModel[];
    timeline: LoomTimelineEventViewModel[];
    localWorkflow: LoomLocalWorkflowViewModel[];
    nextActions: LoomNextActionViewModel[];
    validRecords: {
        statuses: LoomRecordViewModel[];
        deliveries: LoomRecordViewModel[];
        acceptances: LoomRecordViewModel[];
        claimRejects: LoomRecordViewModel[];
    };
}
export interface LoomDashboardViewModel {
    actor: LoomActorViewModel;
    summary: {
        metrics: LoomMetricViewModel[];
        newestActivityLabel: string;
    };
    columns: LoomColumnViewModel[];
    cards: LoomCardViewModel[];
    details: LoomDetailViewModel[];
    emptyState: {
        title: string;
        body: string;
    };
    refresh: {
        isStale: boolean;
        tone: 'neutral' | 'warning';
        warningLabel: string;
        updatedLabel: string;
    };
}
export declare function buildLoomDashboardViewModel(input: unknown, now?: number): LoomDashboardViewModel;
export {};
