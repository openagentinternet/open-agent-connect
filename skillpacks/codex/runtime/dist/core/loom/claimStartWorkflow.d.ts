import { type MetabotCommandResult } from '../contracts/commandResult';
import type { LoomCommandRunner } from './commandRunner';
import { type LoomChainWriteRequest } from './chainRequest';
import { type GitHubRepoRef, type GitHubToolCheckResult, type PrepareGitHubForkWorkspaceInput, type PrepareGitHubForkWorkspaceResult } from './githubWorkflow';
import { type LoomProcessLogInput, type LoomProcessLogWriteResult } from './workflowLog';
import type { LoomWorkflowStore } from './workflowStore';
import type { LoomWorkflowTaskState } from './workflowState';
export interface LoomClaimAndStartWorkflowDryRunResult {
    dryRun: true;
    claimPayload: Record<string, unknown>;
    statusPayload: Record<string, unknown>;
    github: {
        repoUri: string;
        baseBranch: string;
        upstreamRemote: string;
        forkRemote: string;
        upstreamRepo: GitHubRepoRef;
    };
    chainWritePreviews: {
        claim: {
            skipped: false;
            request: LoomClaimAndStartChainWritePreviewRequest;
        } | {
            skipped: true;
            claimPinId: string;
            reason: string;
        };
        status: {
            skipped: false;
            request: LoomClaimAndStartChainWritePreviewRequest;
        };
    };
    preview: {
        claimPinId: string;
        branchName: string;
        stagingRepoPath: string;
        workspaceRepoPath: string;
        processLogFileChain: string;
    };
}
export type LoomClaimAndStartChainWritePreviewRequest = LoomChainWriteRequest & {
    from?: string;
    network?: string;
};
export interface LoomClaimAndStartWorkflowResult {
    dryRun: false;
    taskPinId: string;
    claimPinId: string;
    statusPinId: string;
    branchName: string;
    workspacePath: string;
    processLogPath: string;
    processLogUri: string;
    workflowPath: string;
}
export interface LoomClaimAndStartWorkflowInput {
    from?: string;
    taskPinId: string;
    payoutAddress?: string;
    claimPinId?: string;
    chain?: string;
    fileChain?: string;
    message?: string;
    dryRun?: boolean;
    resetWorkspace?: boolean;
    developerMetaBotSlug: string;
    developerGlobalMetaId: string;
    state?: LoomWorkflowTaskState;
    stateProvider?: (taskPinId: string) => Promise<LoomWorkflowTaskState> | LoomWorkflowTaskState;
    workflowStore: LoomWorkflowStore;
    runner: LoomCommandRunner;
    github: {
        assertToolsReady(input: {
            runner: LoomCommandRunner;
        }): Promise<MetabotCommandResult<GitHubToolCheckResult>>;
        prepareForkWorkspace(input: PrepareGitHubForkWorkspaceInput): Promise<MetabotCommandResult<PrepareGitHubForkWorkspaceResult>>;
    };
    writeChain: (request: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    uploadFile: (input: {
        filePath: string;
        network: string;
        contentType?: string;
    }) => Promise<{
        metafileUri?: string;
        uri?: string;
        pinId?: string;
        network?: string;
    }>;
    writeLogFile: (input: LoomProcessLogInput & {
        directory: string;
        fileName: string;
    }) => Promise<LoomProcessLogWriteResult>;
    removePath: (targetPath: string) => Promise<void>;
    renamePath: (from: string, to: string) => Promise<void>;
    pathExists: (targetPath: string) => Promise<boolean>;
    now?: () => number;
    localRunId?: string;
}
export declare function runLoomClaimAndStartWorkflow(input: LoomClaimAndStartWorkflowInput): Promise<MetabotCommandResult<LoomClaimAndStartWorkflowDryRunResult | LoomClaimAndStartWorkflowResult>>;
