"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeGitHubRepoUri = normalizeGitHubRepoUri;
exports.buildLoomBranchName = buildLoomBranchName;
exports.assertGitHubToolsReady = assertGitHubToolsReady;
exports.prepareGitHubForkWorkspace = prepareGitHubForkWorkspace;
exports.pushLoomBranch = pushLoomBranch;
exports.createLoomPullRequest = createLoomPullRequest;
const commandResult_1 = require("../contracts/commandResult");
function isSuccessful(result) {
    return result.exitCode === 0;
}
function commandFailureMessage(action, result) {
    const detail = result.stderr.trim() || result.stdout.trim();
    return detail ? `${action}: ${detail}` : action;
}
function cloneUrlForRepo(repo) {
    return `https://github.com/${repo.fullName}.git`;
}
function hasValue(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function normalizeRepoParts(owner, repo) {
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
function normalizeGitHubRepoUri(value) {
    const trimmed = value.trim();
    const sshMatch = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(trimmed);
    if (sshMatch) {
        return normalizeRepoParts(sshMatch[1], sshMatch[2]);
    }
    const shorthandMatch = /^([^/@:\s]+)\/([^/@:\s]+?)(?:\.git)?$/.exec(trimmed);
    if (shorthandMatch) {
        return normalizeRepoParts(shorthandMatch[1], shorthandMatch[2]);
    }
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
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
function buildLoomBranchName(taskPinId, claimPinId) {
    return `loom/${taskPinId.slice(0, 8)}-${claimPinId.slice(0, 8)}`;
}
async function assertGitHubToolsReady(input) {
    const git = await input.runner.run({ command: 'git', args: ['--version'] });
    if (!isSuccessful(git)) {
        return (0, commandResult_1.commandFailed)('tool_missing', commandFailureMessage('git is not available', git));
    }
    const gh = await input.runner.run({ command: 'gh', args: ['--version'] });
    if (!isSuccessful(gh)) {
        return (0, commandResult_1.commandFailed)('tool_missing', commandFailureMessage('gh is not available', gh));
    }
    const auth = await input.runner.run({ command: 'gh', args: ['auth', 'status'] });
    if (!isSuccessful(auth)) {
        return (0, commandResult_1.commandFailed)('github_auth_unavailable', commandFailureMessage('GitHub CLI authentication is unavailable', auth));
    }
    return (0, commandResult_1.commandSuccess)({
        gitVersion: git.stdout.trim(),
        ghVersion: gh.stdout.trim(),
    });
}
function parseGitHubRepoView(stdout) {
    try {
        const parsed = JSON.parse(stdout);
        return parsed && typeof parsed === 'object' ? parsed : null;
    }
    catch {
        return null;
    }
}
function findExistingFork(view, upstream) {
    const nameWithOwner = typeof view?.nameWithOwner === 'string' ? view.nameWithOwner : null;
    const parentNameWithOwner = typeof view?.parent?.nameWithOwner === 'string'
        ? view.parent.nameWithOwner
        : null;
    if (!nameWithOwner || parentNameWithOwner !== upstream.fullName) {
        return null;
    }
    return normalizeGitHubRepoUri(nameWithOwner);
}
function parseGitHubLogin(stdout) {
    const trimmed = stdout.trim();
    if (!trimmed) {
        return null;
    }
    try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed.login === 'string' && parsed.login.trim()) {
            return parsed.login.trim();
        }
    }
    catch {
        return trimmed;
    }
    return null;
}
async function resolveAuthenticatedGitHubLogin(runner) {
    const user = await runner.run({
        command: 'gh',
        args: ['api', 'user', '--jq', '.login'],
    });
    if (!isSuccessful(user)) {
        return (0, commandResult_1.commandFailed)('github_auth_unavailable', commandFailureMessage('Failed to resolve authenticated GitHub login', user));
    }
    const owner = parseGitHubLogin(user.stdout);
    if (!owner) {
        return (0, commandResult_1.commandFailed)('github_auth_unavailable', 'Failed to resolve authenticated GitHub login: gh api user returned no login.');
    }
    return (0, commandResult_1.commandSuccess)({ login: owner });
}
function extractGitHubPullRequestUrl(stdout) {
    return stdout.match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/)?.[0] ?? null;
}
async function prepareGitHubForkWorkspace(input) {
    const upstreamRepo = normalizeGitHubRepoUri(input.repoUri);
    const baseBranch = input.baseBranch ?? 'main';
    const upstreamRemote = input.upstreamRemote ?? 'origin';
    const forkRemote = input.forkRemote ?? 'fork';
    let authenticatedLogin;
    let candidateForkOwner = hasValue(input.forkOwner) ? input.forkOwner.trim() : undefined;
    if (!candidateForkOwner) {
        const loginResult = await resolveAuthenticatedGitHubLogin(input.runner);
        if (!loginResult.ok) {
            return loginResult;
        }
        authenticatedLogin = loginResult.data.login;
        candidateForkOwner = authenticatedLogin;
    }
    const candidateForkRepo = normalizeGitHubRepoUri(`${candidateForkOwner}/${upstreamRepo.repo}`);
    const view = await input.runner.run({
        command: 'gh',
        args: ['repo', 'view', candidateForkRepo.fullName, '--json', 'parent,nameWithOwner'],
    });
    const existingFork = isSuccessful(view)
        ? findExistingFork(parseGitHubRepoView(view.stdout), upstreamRepo)
        : null;
    let forkRepo = existingFork;
    if (!forkRepo) {
        if (!authenticatedLogin) {
            const loginResult = await resolveAuthenticatedGitHubLogin(input.runner);
            if (!loginResult.ok) {
                return loginResult;
            }
            authenticatedLogin = loginResult.data.login;
        }
        const forkArgs = ['repo', 'fork', upstreamRepo.fullName, '--clone=false'];
        if (hasValue(input.forkOwner)
            && candidateForkOwner.toLowerCase() !== authenticatedLogin.toLowerCase()) {
            forkArgs.push('--org', candidateForkOwner);
        }
        const fork = await input.runner.run({
            command: 'gh',
            args: forkArgs,
        });
        if (!isSuccessful(fork)) {
            return (0, commandResult_1.commandFailed)('github_fork_failed', commandFailureMessage('Failed to fork repository', fork));
        }
        forkRepo = candidateForkRepo;
    }
    const clone = await input.runner.run({
        command: 'git',
        args: ['clone', cloneUrlForRepo(upstreamRepo), input.workspaceRepoPath],
    });
    if (!isSuccessful(clone)) {
        return (0, commandResult_1.commandFailed)('git_clone_failed', commandFailureMessage('Failed to clone repository', clone));
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
        return (0, commandResult_1.commandFailed)('git_remote_failed', commandFailureMessage('Failed to configure fork remote', remoteAdd));
    }
    const checkout = await input.runner.run({
        command: 'git',
        args: ['checkout', '-B', input.branchName, `${upstreamRemote}/${baseBranch}`],
        cwd: input.workspaceRepoPath,
    });
    if (!isSuccessful(checkout)) {
        return (0, commandResult_1.commandFailed)('git_checkout_failed', commandFailureMessage('Failed to create Loom branch', checkout));
    }
    return (0, commandResult_1.commandSuccess)({
        upstreamRepo,
        forkRepo,
        branchName: input.branchName,
        workspacePath: input.workspaceRepoPath,
    });
}
async function pushLoomBranch(input) {
    const forkRemote = input.forkRemote ?? 'fork';
    const push = await input.runner.run({
        command: 'git',
        args: ['push', '-u', forkRemote, input.branchName],
        cwd: input.workspacePath,
    });
    if (!isSuccessful(push)) {
        return (0, commandResult_1.commandFailed)('github_push_failed', commandFailureMessage('Failed to push Loom branch', push));
    }
    return (0, commandResult_1.commandSuccess)({ branchName: input.branchName });
}
async function createLoomPullRequest(input) {
    const pr = await input.runner.run({
        command: 'gh',
        args: [
            'pr',
            'create',
            '--repo',
            input.repo,
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
        return (0, commandResult_1.commandFailed)('github_pr_failed', commandFailureMessage('Failed to create pull request', pr));
    }
    const url = extractGitHubPullRequestUrl(pr.stdout);
    if (!url) {
        return (0, commandResult_1.commandFailed)('github_pr_failed', 'Failed to create pull request: gh pr create did not return a pull request URL.');
    }
    return (0, commandResult_1.commandSuccess)({ url });
}
