import {
  commandFailed,
  commandSuccess,
  type MetabotCommandResult,
} from '../contracts/commandResult';
import type { LoomCommandRunResult, LoomCommandRunner } from './commandRunner';

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
  baseBranch: string;
  head: string;
  title: string;
  body: string;
}

export interface CreateLoomPullRequestResult {
  url: string;
}

interface GitHubRepoViewJson {
  nameWithOwner?: unknown;
  parent?: {
    nameWithOwner?: unknown;
  } | null;
}

function isSuccessful(result: LoomCommandRunResult): boolean {
  return result.exitCode === 0;
}

function commandFailureMessage(action: string, result: LoomCommandRunResult): string {
  const detail = result.stderr.trim() || result.stdout.trim();
  return detail ? `${action}: ${detail}` : action;
}

function cloneUrlForRepo(repo: GitHubRepoRef): string {
  return `https://github.com/${repo.fullName}.git`;
}

function hasValue(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeRepoParts(owner: string, repo: string): GitHubRepoRef {
  const normalizedOwner = owner.trim();
  const normalizedRepo = repo.trim().endsWith('.git') ? repo.trim().slice(0, -4) : repo.trim();
  if (!normalizedOwner
    || !normalizedRepo
    || normalizedOwner.includes('/')
    || normalizedRepo.includes('/')
    || /\s/.test(normalizedOwner)
    || /\s/.test(normalizedRepo)) {
    throw new Error(`Invalid GitHub repository URI: ${owner}/${repo}`);
  }

  return {
    owner: normalizedOwner,
    repo: normalizedRepo,
    fullName: `${normalizedOwner}/${normalizedRepo}`,
  };
}

export function normalizeGitHubRepoUri(value: string): GitHubRepoRef {
  const trimmed = value.trim();
  const shorthandMatch = /^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(trimmed);
  if (shorthandMatch) {
    return normalizeRepoParts(shorthandMatch[1], shorthandMatch[2]);
  }

  const sshMatch = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(trimmed);
  if (sshMatch) {
    return normalizeRepoParts(sshMatch[1], sshMatch[2]);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid GitHub repository URI: ${value}`);
  }

  if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
    throw new Error(`Invalid GitHub repository URI: ${value}`);
  }

  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (parts.length !== 2) {
    throw new Error(`Invalid GitHub repository URI: ${value}`);
  }

  return normalizeRepoParts(parts[0], parts[1]);
}

export function buildLoomBranchName(taskPinId: string, claimPinId: string): string {
  return `loom/${taskPinId.slice(0, 8)}-${claimPinId.slice(0, 8)}`;
}

export async function assertGitHubToolsReady(
  input: GitHubToolCheckInput,
): Promise<MetabotCommandResult<GitHubToolCheckResult>> {
  const git = await input.runner.run({ command: 'git', args: ['--version'] });
  if (!isSuccessful(git)) {
    return commandFailed('tool_missing', commandFailureMessage('git is not available', git));
  }

  const gh = await input.runner.run({ command: 'gh', args: ['--version'] });
  if (!isSuccessful(gh)) {
    return commandFailed('tool_missing', commandFailureMessage('gh is not available', gh));
  }

  const auth = await input.runner.run({ command: 'gh', args: ['auth', 'status'] });
  if (!isSuccessful(auth)) {
    return commandFailed(
      'github_auth_unavailable',
      commandFailureMessage('GitHub CLI authentication is unavailable', auth),
    );
  }

  return commandSuccess({
    gitVersion: git.stdout.trim(),
    ghVersion: gh.stdout.trim(),
  });
}

function parseGitHubRepoView(stdout: string): GitHubRepoViewJson | null {
  try {
    const parsed = JSON.parse(stdout) as GitHubRepoViewJson;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function findExistingFork(view: GitHubRepoViewJson | null, upstream: GitHubRepoRef): GitHubRepoRef | null {
  const nameWithOwner = typeof view?.nameWithOwner === 'string' ? view.nameWithOwner : null;
  const parentNameWithOwner = typeof view?.parent?.nameWithOwner === 'string'
    ? view.parent.nameWithOwner
    : null;

  if (!nameWithOwner || parentNameWithOwner !== upstream.fullName) {
    return null;
  }

  return normalizeGitHubRepoUri(nameWithOwner);
}

function parseGitHubLogin(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as { login?: unknown };
    if (typeof parsed.login === 'string' && parsed.login.trim()) {
      return parsed.login.trim();
    }
  } catch {
    return trimmed;
  }

  return null;
}

async function resolveForkOwner(
  input: PrepareGitHubForkWorkspaceInput,
): Promise<MetabotCommandResult<{ owner: string }>> {
  if (hasValue(input.forkOwner)) {
    return commandSuccess({ owner: input.forkOwner.trim() });
  }

  const user = await input.runner.run({
    command: 'gh',
    args: ['api', 'user', '--jq', '.login'],
  });
  if (!isSuccessful(user)) {
    return commandFailed(
      'github_auth_unavailable',
      commandFailureMessage('Failed to resolve authenticated GitHub login', user),
    );
  }

  const owner = parseGitHubLogin(user.stdout);
  if (!owner) {
    return commandFailed(
      'github_auth_unavailable',
      'Failed to resolve authenticated GitHub login: gh api user returned no login.',
    );
  }

  return commandSuccess({ owner });
}

function extractGitHubPullRequestUrl(stdout: string): string | null {
  return stdout.match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/)?.[0] ?? null;
}

export async function prepareGitHubForkWorkspace(
  input: PrepareGitHubForkWorkspaceInput,
): Promise<MetabotCommandResult<PrepareGitHubForkWorkspaceResult>> {
  const upstreamRepo = normalizeGitHubRepoUri(input.repoUri);
  const baseBranch = input.baseBranch ?? 'main';
  const upstreamRemote = input.upstreamRemote ?? 'origin';
  const forkRemote = input.forkRemote ?? 'fork';

  const ownerResult = await resolveForkOwner(input);
  if (!ownerResult.ok) {
    return ownerResult;
  }

  const candidateForkRepo = normalizeGitHubRepoUri(`${ownerResult.data.owner}/${upstreamRepo.repo}`);
  const view = await input.runner.run({
    command: 'gh',
    args: ['repo', 'view', candidateForkRepo.fullName, '--json', 'parent,nameWithOwner'],
  });
  const existingFork = isSuccessful(view)
    ? findExistingFork(parseGitHubRepoView(view.stdout), upstreamRepo)
    : null;
  let forkRepo = existingFork;
  if (!forkRepo) {
    const fork = await input.runner.run({
      command: 'gh',
      args: ['repo', 'fork', upstreamRepo.fullName, '--clone=false'],
    });
    if (!isSuccessful(fork)) {
      return commandFailed('github_fork_failed', commandFailureMessage('Failed to fork repository', fork));
    }

    forkRepo = candidateForkRepo;
  }

  const clone = await input.runner.run({
    command: 'git',
    args: ['clone', cloneUrlForRepo(upstreamRepo), input.workspaceRepoPath],
  });
  if (!isSuccessful(clone)) {
    return commandFailed('git_clone_failed', commandFailureMessage('Failed to clone repository', clone));
  }

  await input.runner.run({
    command: 'git',
    args: ['remote', 'remove', forkRemote],
    cwd: input.workspaceRepoPath,
  });

  const remoteAdd = await input.runner.run({
    command: 'git',
    args: ['remote', 'add', forkRemote, cloneUrlForRepo(forkRepo)],
    cwd: input.workspaceRepoPath,
  });
  if (!isSuccessful(remoteAdd)) {
    return commandFailed(
      'git_remote_failed',
      commandFailureMessage('Failed to configure fork remote', remoteAdd),
    );
  }

  const checkout = await input.runner.run({
    command: 'git',
    args: ['checkout', '-B', input.branchName, `${upstreamRemote}/${baseBranch}`],
    cwd: input.workspaceRepoPath,
  });
  if (!isSuccessful(checkout)) {
    return commandFailed('git_checkout_failed', commandFailureMessage('Failed to create Loom branch', checkout));
  }

  return commandSuccess({
    upstreamRepo,
    forkRepo,
    branchName: input.branchName,
    workspacePath: input.workspaceRepoPath,
  });
}

export async function pushLoomBranch(
  input: PushLoomBranchInput,
): Promise<MetabotCommandResult<PushLoomBranchResult>> {
  const forkRemote = input.forkRemote ?? 'fork';
  const push = await input.runner.run({
    command: 'git',
    args: ['push', '-u', forkRemote, input.branchName],
    cwd: input.workspacePath,
  });
  if (!isSuccessful(push)) {
    return commandFailed('github_push_failed', commandFailureMessage('Failed to push Loom branch', push));
  }

  return commandSuccess({ branchName: input.branchName });
}

export async function createLoomPullRequest(
  input: CreateLoomPullRequestInput,
): Promise<MetabotCommandResult<CreateLoomPullRequestResult>> {
  const pr = await input.runner.run({
    command: 'gh',
    args: [
      'pr',
      'create',
      '--base',
      input.baseBranch,
      '--head',
      input.head,
      '--title',
      input.title,
      '--body',
      input.body,
    ],
    cwd: input.workspacePath,
  });
  if (!isSuccessful(pr)) {
    return commandFailed('github_pr_failed', commandFailureMessage('Failed to create pull request', pr));
  }

  const url = extractGitHubPullRequestUrl(pr.stdout);
  if (!url) {
    return commandFailed(
      'github_pr_failed',
      'Failed to create pull request: gh pr create did not return a pull request URL.',
    );
  }

  return commandSuccess({ url });
}
