import type { LoomDashboardActorContext, LoomDashboardNextAction, LoomDashboardTaskCard, LoomDashboardTaskDetail } from './dashboardTypes';
export interface ProjectLoomDashboardActionsInput {
    card: LoomDashboardTaskCard;
    detail: LoomDashboardTaskDetail;
    actor?: LoomDashboardActorContext;
}
export declare function projectLoomDashboardNextActions(input: ProjectLoomDashboardActionsInput): LoomDashboardNextAction[];
export declare function selectLoomDashboardCardAction(actions: LoomDashboardNextAction[]): LoomDashboardNextAction | undefined;
export declare function buildLoomDashboardSummaryPreview(input: {
    card: Pick<LoomDashboardTaskCard, 'latestStatusSummary'>;
    detail: Pick<LoomDashboardTaskDetail, 'requirement' | 'validRecords'>;
}): string | undefined;
