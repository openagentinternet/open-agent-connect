import { type MetabotCommandResult } from '../contracts/commandResult';
import type { LoomDashboardActorContext, LoomDashboardState, LoomDashboardTaskDetail } from './dashboardTypes';
import type { LoomDashboardStore } from './dashboardStore';
import type { LoomRawCacheState } from './rawCache';
import type { LoomWorkflowState } from './workflowTypes';
export interface LoomDashboardServiceInput {
    rawCacheStore: {
        read(): Promise<LoomRawCacheState>;
    };
    dashboardStore: LoomDashboardStore;
    refreshRawCache?: (input: {
        limit?: number;
    }) => Promise<LoomRawCacheState>;
    readWorkflowStates?: () => Promise<LoomWorkflowState[]>;
    resolveActorContext?: (input: {
        from?: string;
    }) => Promise<LoomDashboardActorContext | null>;
    now?: () => number;
}
export interface LoomDashboardRequest {
    from?: string;
    refresh?: boolean;
    limit?: number;
    state?: string;
    role?: string;
    query?: string;
}
export interface LoomDashboardTaskDetailRequest {
    taskPinId: string;
    from?: string;
    refresh?: boolean;
}
export interface LoomDashboardRefreshRequest {
    from?: string;
    limit?: number;
    state?: string;
    role?: string;
    query?: string;
}
export interface LoomDashboardServiceResult {
    dashboard: LoomDashboardState;
    indexPath: string;
    cache: {
        updatedAt: number;
        refreshed: boolean;
    };
    refresh?: {
        requested: boolean;
        succeeded: boolean;
        warning?: string;
    };
}
export interface LoomDashboardTaskDetailResult extends LoomDashboardServiceResult {
    detail: LoomDashboardTaskDetail;
}
export interface LoomDashboardService {
    getDashboard(input?: LoomDashboardRequest): Promise<MetabotCommandResult<LoomDashboardServiceResult>>;
    getTaskDetail(input: LoomDashboardTaskDetailRequest): Promise<MetabotCommandResult<LoomDashboardTaskDetailResult>>;
    refresh(input?: LoomDashboardRefreshRequest): Promise<MetabotCommandResult<LoomDashboardServiceResult>>;
}
export declare function createLoomDashboardService(input: LoomDashboardServiceInput): LoomDashboardService;
