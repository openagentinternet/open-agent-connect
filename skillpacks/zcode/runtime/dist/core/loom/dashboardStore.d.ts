import { type MetabotPaths } from '../state/paths';
import type { LoomDashboardState } from './dashboardTypes';
export interface LoomDashboardStore {
    indexPath: string;
    read(): Promise<LoomDashboardState | null>;
    write(state: LoomDashboardState): Promise<LoomDashboardState>;
}
export declare function resolveLoomDashboardIndexPath(homeDirOrPaths: string | MetabotPaths): string;
export declare function createLoomDashboardStore(homeDirOrPaths: string | MetabotPaths): LoomDashboardStore;
