import { type MetabotPaths } from '../state/paths';
import type { LoomWorkflowState } from './workflowTypes';
export interface LoomWorkflowPathInput {
    taskPinId: string;
    claimPinId?: string;
    localRunId?: string;
}
export interface LoomWorkflowPaths {
    loomRuntimeRoot: string;
    workflowsRoot: string;
    stagingRoot: string;
    workspacesRoot: string;
    logsRoot: string;
    workflowPath: string;
    stagingRepoPath: string;
    workspaceRepoPath: string;
    taskLogsRoot: string;
}
export interface LoomWorkflowStore {
    paths: MetabotPaths;
    resolve(taskPinId: string, claimPinId?: string, localRunId?: string): LoomWorkflowPaths;
    read(taskPinId: string, claimPinId: string): Promise<LoomWorkflowState | null>;
    write(state: LoomWorkflowState): Promise<LoomWorkflowState>;
}
export declare function resolveLoomWorkflowPaths(homeDirOrPaths: string | MetabotPaths, input: LoomWorkflowPathInput): LoomWorkflowPaths;
export declare function createLoomWorkflowStore(homeDirOrPaths: string | MetabotPaths): LoomWorkflowStore;
