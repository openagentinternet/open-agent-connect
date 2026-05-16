import { type MetabotCommandResult } from '../contracts/commandResult';
import type { LoomCommandRunner } from './commandRunner';
import { type LoomChainWriteRequest } from './chainRequest';
import type { CreateLoomPullRequestInput, CreateLoomPullRequestResult, GitHubToolCheckResult, PushLoomBranchInput, PushLoomBranchResult } from './githubWorkflow';
import type { LoomWorkflowTaskState } from './workflowState';
import type { LoomWorkflowStore } from './workflowStore';
export type LoomDeliverChainWritePreviewRequest = LoomChainWriteRequest & {
    from?: string;
    network?: string;
};
export interface LoomDeliverDryRunResult {
    dryRun: true;
    push: {
        workspacePath: string;
        forkRemote: string;
        branchName: string;
    };
    pullRequest: {
        repo: string;
        baseBranch: string;
        head: string;
        title: string;
        body: string;
    };
    deliveryPayload: Record<string, unknown>;
    chainWritePreview: {
        request: LoomDeliverChainWritePreviewRequest;
    };
}
export interface LoomDeliverWorkflowResult {
    dryRun: false;
    taskPinId: string;
    claimPinId: string;
    deliveryPinId: string;
    prUrl: string;
    prTitle: string;
    branchName: string;
    baseBranch: string;
    workspacePath: string;
}
export interface LoomDeliverWorkflowInput {
    from?: string;
    taskPinId: string;
    claimPinId: string;
    chain?: string;
    prTitle?: string;
    deliverySummary?: string;
    dryRun?: boolean;
    developerMetaBotSlug: string;
    developerGlobalMetaId: string;
    state: LoomWorkflowTaskState;
    workflowStore: LoomWorkflowStore;
    runner: LoomCommandRunner;
    github: {
        assertToolsReady(input: {
            runner: LoomCommandRunner;
        }): Promise<MetabotCommandResult<GitHubToolCheckResult>>;
        pushLoomBranch(input: PushLoomBranchInput): Promise<MetabotCommandResult<PushLoomBranchResult>>;
        createLoomPullRequest(input: CreateLoomPullRequestInput): Promise<MetabotCommandResult<CreateLoomPullRequestResult>>;
    };
    writeChain: (request: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    now?: () => number;
}
export declare function runLoomDeliverWorkflow(input: LoomDeliverWorkflowInput): Promise<MetabotCommandResult<LoomDeliverDryRunResult | LoomDeliverWorkflowResult>>;
