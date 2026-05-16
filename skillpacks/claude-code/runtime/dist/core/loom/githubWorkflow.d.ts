import { type MetabotCommandResult } from '../contracts/commandResult';
import type { LoomCommandRunner } from './commandRunner';
export interface GitHubRepoRef {
    owner: string;
    repo: string;
    fullName: string;
}
export interface GitHubToolCheckInput {
    runner: LoomCommandRunner;
}
export interface GitHubToolCheckResult {
    gitVersion: string;
    ghVersion: string;
}
export interface PrepareGitHubForkWorkspaceInput {
    runner: LoomCommandRunner;
    repoUri: string;
    forkOwner?: string;
    workspaceRepoPath: string;
    branchName: string;
    baseBranch?: string;
    upstreamRemote?: string;
    forkRemote?: string;
}
export interface PrepareGitHubForkWorkspaceResult {
    upstreamRepo: GitHubRepoRef;
    forkRepo: GitHubRepoRef;
    branchName: string;
    workspacePath: string;
}
export interface PushLoomBranchInput {
    runner: LoomCommandRunner;
    workspacePath: string;
    forkRemote?: string;
    branchName: string;
}
export interface PushLoomBranchResult {
    branchName: string;
}
export interface CreateLoomPullRequestInput {
    runner: LoomCommandRunner;
    workspacePath: string;
    repo: string;
    baseBranch: string;
    head: string;
    title: string;
    body: string;
}
export interface CreateLoomPullRequestResult {
    url: string;
}
export declare function normalizeGitHubRepoUri(value: string): GitHubRepoRef;
export declare function buildLoomBranchName(taskPinId: string, claimPinId: string): string;
export declare function assertGitHubToolsReady(input: GitHubToolCheckInput): Promise<MetabotCommandResult<GitHubToolCheckResult>>;
export declare function prepareGitHubForkWorkspace(input: PrepareGitHubForkWorkspaceInput): Promise<MetabotCommandResult<PrepareGitHubForkWorkspaceResult>>;
export declare function pushLoomBranch(input: PushLoomBranchInput): Promise<MetabotCommandResult<PushLoomBranchResult>>;
export declare function createLoomPullRequest(input: CreateLoomPullRequestInput): Promise<MetabotCommandResult<CreateLoomPullRequestResult>>;
