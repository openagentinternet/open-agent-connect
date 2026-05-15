import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

const {
  assertGitHubToolsReady,
  buildLoomBranchName,
  createLoomPullRequest,
  normalizeGitHubRepoUri,
  prepareGitHubForkWorkspace,
  pushLoomBranch,
} = require('../../dist/core/loom/index.js');

function commandResult(input, overrides = {}) {
  return {
    command: input.command,
    args: input.args,
    cwd: input.cwd,
    exitCode: 0,
    stdout: '',
    stderr: '',
    durationMs: 1,
    ...overrides,
  };
}

function createFakeRunner(handler) {
  const calls = [];
  return {
    calls,
    runner: {
      async run(input) {
        calls.push({ ...input, args: [...input.args] });
        return handler(input, calls.length - 1);
      },
    },
  };
}

function commandLines(calls) {
  return calls.map((call) => [call.command, ...call.args].join(' '));
}

test('normalizes HTTPS GitHub repository URLs', () => {
  assert.deepEqual(
    normalizeGitHubRepoUri('https://github.com/openagentinternet/open-agent-connect.git'),
    {
      owner: 'openagentinternet',
      repo: 'open-agent-connect',
      fullName: 'openagentinternet/open-agent-connect',
    },
  );
});

test('normalizes owner/repo shorthand', () => {
  assert.deepEqual(normalizeGitHubRepoUri('openagentinternet/open-agent-connect'), {
    owner: 'openagentinternet',
    repo: 'open-agent-connect',
    fullName: 'openagentinternet/open-agent-connect',
  });
});

test('rejects invalid GitHub repository URLs', () => {
  assert.throws(
    () => normalizeGitHubRepoUri('https://example.com/openagentinternet/open-agent-connect'),
    /Invalid GitHub repository URI/,
  );
});

test('assertGitHubToolsReady returns tool_missing when git is unavailable', async () => {
  const { runner } = createFakeRunner((input) => commandResult(input, {
    exitCode: input.command === 'git' ? -1 : 0,
    stderr: input.command === 'git' ? 'spawn git ENOENT' : '',
  }));

  const result = await assertGitHubToolsReady({ runner });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'tool_missing');
});

test('assertGitHubToolsReady returns github_auth_unavailable when gh auth is unavailable', async () => {
  const { runner } = createFakeRunner((input) => commandResult(input, {
    exitCode: input.command === 'gh' && input.args[0] === 'auth' ? 1 : 0,
    stderr: input.command === 'gh' && input.args[0] === 'auth' ? 'not logged in' : '',
  }));

  const result = await assertGitHubToolsReady({ runner });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'github_auth_unavailable');
});

test('builds stable Loom branch names from task and claim pin ids', () => {
  assert.equal(
    buildLoomBranchName(`${'a'.repeat(64)}i0`, `${'b'.repeat(64)}i0`),
    'loom/aaaaaaaa-bbbbbbbb',
  );
});

test('prepareGitHubForkWorkspace forks when no matching fork exists and prepares branch', async () => {
  const { calls, runner } = createFakeRunner((input) => commandResult(input, {
    exitCode: input.command === 'gh' && input.args[0] === 'repo' && input.args[1] === 'view' ? 1 : 0,
    stderr: input.command === 'gh' && input.args[0] === 'repo' && input.args[1] === 'view' ? 'not found' : '',
    stdout: '',
  }));

  const result = await prepareGitHubForkWorkspace({
    runner,
    repoUri: 'https://github.com/openagentinternet/open-agent-connect.git',
    forkOwner: 'loom-developer',
    workspaceRepoPath: '/tmp/loom/repo',
    branchName: 'loom/aaaaaaaa-bbbbbbbb',
    baseBranch: 'main',
    upstreamRemote: 'origin',
    forkRemote: 'loom-fork',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(commandLines(calls), [
    'gh repo view loom-developer/open-agent-connect --json parent,nameWithOwner',
    'gh repo fork openagentinternet/open-agent-connect --clone=false',
    'git clone https://github.com/openagentinternet/open-agent-connect.git /tmp/loom/repo',
    'git remote remove loom-fork',
    'git remote add loom-fork https://github.com/loom-developer/open-agent-connect.git',
    'git checkout -B loom/aaaaaaaa-bbbbbbbb origin/main',
  ]);
  assert.equal(result.data.forkRepo.fullName, 'loom-developer/open-agent-connect');
  assert.equal(result.data.workspacePath, '/tmp/loom/repo');
});

test('prepareGitHubForkWorkspace resolves authenticated login before forking', async () => {
  const { calls, runner } = createFakeRunner((input) => commandResult(input, {
    exitCode: input.command === 'gh' && input.args[0] === 'repo' && input.args[1] === 'view' ? 1 : 0,
    stderr: input.command === 'gh' && input.args[0] === 'repo' && input.args[1] === 'view' ? 'not found' : '',
    stdout: input.command === 'gh' && input.args[0] === 'api' && input.args[1] === 'user'
      ? 'loom-developer\n'
      : '',
  }));

  const result = await prepareGitHubForkWorkspace({
    runner,
    repoUri: 'https://github.com/openagentinternet/open-agent-connect.git',
    workspaceRepoPath: '/tmp/loom/repo',
    branchName: 'loom/aaaaaaaa-bbbbbbbb',
    baseBranch: 'main',
    upstreamRemote: 'origin',
    forkRemote: 'loom-fork',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(commandLines(calls), [
    'gh api user --jq .login',
    'gh repo view loom-developer/open-agent-connect --json parent,nameWithOwner',
    'gh repo fork openagentinternet/open-agent-connect --clone=false',
    'git clone https://github.com/openagentinternet/open-agent-connect.git /tmp/loom/repo',
    'git remote remove loom-fork',
    'git remote add loom-fork https://github.com/loom-developer/open-agent-connect.git',
    'git checkout -B loom/aaaaaaaa-bbbbbbbb origin/main',
  ]);
  assert.equal(result.data.forkRepo.fullName, 'loom-developer/open-agent-connect');
  assert.equal(result.data.workspacePath, '/tmp/loom/repo');
});

test('prepareGitHubForkWorkspace reuses an existing matching fork', async () => {
  const { calls, runner } = createFakeRunner((input) => commandResult(input, {
    stdout: input.command === 'gh' && input.args[0] === 'repo' && input.args[1] === 'view'
      ? JSON.stringify({
        nameWithOwner: 'loom-developer/open-agent-connect',
        parent: { nameWithOwner: 'openagentinternet/open-agent-connect' },
      })
      : input.command === 'gh' && input.args[0] === 'api' && input.args[1] === 'user'
        ? 'loom-developer\n'
      : '',
  }));

  const result = await prepareGitHubForkWorkspace({
    runner,
    repoUri: 'openagentinternet/open-agent-connect',
    workspaceRepoPath: '/tmp/loom/reused',
    branchName: 'loom/aaaaaaaa-bbbbbbbb',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(commandLines(calls), [
    'gh api user --jq .login',
    'gh repo view loom-developer/open-agent-connect --json parent,nameWithOwner',
    'git clone https://github.com/openagentinternet/open-agent-connect.git /tmp/loom/reused',
    'git remote remove fork',
    'git remote add fork https://github.com/loom-developer/open-agent-connect.git',
    'git checkout -B loom/aaaaaaaa-bbbbbbbb origin/main',
  ]);
  assert.equal(result.data.forkRepo.fullName, 'loom-developer/open-agent-connect');
});

test('prepareGitHubForkWorkspace maps fork failures', async () => {
  const { runner } = createFakeRunner((input) => commandResult(input, {
    exitCode: input.command === 'gh' && input.args[0] === 'repo' && input.args[1] === 'fork' ? 1 : 0,
    stderr: input.command === 'gh' && input.args[0] === 'repo' && input.args[1] === 'fork' ? 'fork failed' : '',
    stdout: input.command === 'gh' && input.args[0] === 'repo' && input.args[1] === 'view'
      ? JSON.stringify({ nameWithOwner: 'loom-developer/open-agent-connect', parent: null })
      : '',
  }));

  const result = await prepareGitHubForkWorkspace({
    runner,
    repoUri: 'openagentinternet/open-agent-connect',
    forkOwner: 'loom-developer',
    workspaceRepoPath: '/tmp/loom/repo',
    branchName: 'loom/aaaaaaaa-bbbbbbbb',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'github_fork_failed');
});

test('prepareGitHubForkWorkspace maps clone failures', async () => {
  const { runner } = createFakeRunner((input) => commandResult(input, {
    exitCode: input.command === 'git' && input.args[0] === 'clone' ? 1 : 0,
    stderr: input.command === 'git' && input.args[0] === 'clone' ? 'clone failed' : '',
    stdout: input.command === 'gh' && input.args[0] === 'repo' && input.args[1] === 'view'
      ? JSON.stringify({ nameWithOwner: 'loom-developer/open-agent-connect', parent: null })
      : '',
  }));

  const result = await prepareGitHubForkWorkspace({
    runner,
    repoUri: 'openagentinternet/open-agent-connect',
    forkOwner: 'loom-developer',
    workspaceRepoPath: '/tmp/loom/repo',
    branchName: 'loom/aaaaaaaa-bbbbbbbb',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'git_clone_failed');
});

test('pushLoomBranch maps push failures', async () => {
  const { calls, runner } = createFakeRunner((input) => commandResult(input, {
    exitCode: 1,
    stderr: 'push rejected',
  }));

  const result = await pushLoomBranch({
    runner,
    workspacePath: '/tmp/loom/repo',
    forkRemote: 'fork',
    branchName: 'loom/aaaaaaaa-bbbbbbbb',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'github_push_failed');
  assert.deepEqual(commandLines(calls), ['git push -u fork loom/aaaaaaaa-bbbbbbbb']);
  assert.equal(calls[0].cwd, '/tmp/loom/repo');
});

test('createLoomPullRequest parses the created pull request URL from noisy stdout', async () => {
  const { calls, runner } = createFakeRunner((input) => commandResult(input, {
    stdout: 'Creating pull request...\nhttps://github.com/openagentinternet/open-agent-connect/pull/123\nDone.\n',
  }));

  const result = await createLoomPullRequest({
    runner,
    workspacePath: '/tmp/loom/repo',
    baseBranch: 'main',
    head: 'loom-developer:loom/aaaaaaaa-bbbbbbbb',
    title: 'Loom task',
    body: 'Implemented by Loom.',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.url, 'https://github.com/openagentinternet/open-agent-connect/pull/123');
  assert.deepEqual(commandLines(calls), [
    'gh pr create --base main --head loom-developer:loom/aaaaaaaa-bbbbbbbb --title Loom task --body Implemented by Loom.',
  ]);
});

test('createLoomPullRequest maps success without pull request URL to github_pr_failed', async () => {
  const { runner } = createFakeRunner((input) => commandResult(input, {
    stdout: 'Pull request created.\n',
  }));

  const result = await createLoomPullRequest({
    runner,
    workspacePath: '/tmp/loom/repo',
    baseBranch: 'main',
    head: 'loom-developer:loom/aaaaaaaa-bbbbbbbb',
    title: 'Loom task',
    body: 'Implemented by Loom.',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'github_pr_failed');
});
