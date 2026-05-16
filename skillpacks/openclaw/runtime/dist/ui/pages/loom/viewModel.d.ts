import type { LoomDashboardColumnId, LoomDashboardStateTone } from '../../../core/loom/dashboardTypes';
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
    developer: LoomBotViewModel;
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
