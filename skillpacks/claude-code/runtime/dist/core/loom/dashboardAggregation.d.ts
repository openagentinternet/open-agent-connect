import type { LoomRawCacheState } from './rawCache';
import type { BuildLoomDashboardOptions, LoomDashboardStateModel, LoomDashboardTaskDetail } from './dashboardTypes';
export declare function buildLoomDashboard(rawState: LoomRawCacheState, options?: BuildLoomDashboardOptions): LoomDashboardStateModel;
export declare function findLoomDashboardTaskDetail(dashboard: LoomDashboardStateModel, taskPinId: string): LoomDashboardTaskDetail | undefined;
