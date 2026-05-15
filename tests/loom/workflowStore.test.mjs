import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createLoomWorkflowStore,
  resolveLoomWorkflowPaths,
} = require('../../dist/core/loom/index.js');

const taskPinId = `${'a'.repeat(64)}i0`;
const claimPinId = `${'b'.repeat(64)}i0`;

test('resolves workflow paths under profile runtime loom root', async () => {
  const profileHome = path.join(await mkdtemp(path.join(os.tmpdir(), 'loom-store-')), '.metabot', 'profiles', 'eric');
  const paths = resolveLoomWorkflowPaths(profileHome, { taskPinId, claimPinId, localRunId: 'run-1' });
  assert.match(paths.loomRuntimeRoot, /\.runtime\/loom$/);
  assert.match(paths.workflowsRoot, /\.runtime\/loom\/workflows$/);
  assert.match(paths.stagingRoot, /\.runtime\/loom\/staging$/);
  assert.match(paths.workspacesRoot, /\.runtime\/loom\/workspaces$/);
  assert.match(paths.logsRoot, /\.runtime\/loom\/logs$/);
  assert.match(paths.taskLogsRoot, /\.runtime\/loom\/logs\/a+.*$/);
  assert.match(paths.workflowPath, /\.runtime\/loom\/workflows\/a+.*\/b+.*\.json$/);
  assert.match(paths.workspaceRepoPath, /\.runtime\/loom\/workspaces\/a+.*\/b+.*\/repo$/);
  assert.match(paths.stagingRepoPath, /\.runtime\/loom\/staging\/a+.*\/run-1\/repo$/);
});

test('resolves pending claim preview paths with run fallback', async () => {
  const profileHome = path.join(await mkdtemp(path.join(os.tmpdir(), 'loom-store-preview-')), '.metabot', 'profiles', 'eric');
  const paths = resolveLoomWorkflowPaths(profileHome, { taskPinId });
  assert.match(paths.workflowPath, /\.runtime\/loom\/workflows\/a+.*\/pending-claim\.json$/);
  assert.match(paths.workspaceRepoPath, /\.runtime\/loom\/workspaces\/a+.*\/pending-claim\/repo$/);
  assert.match(paths.stagingRepoPath, /\.runtime\/loom\/staging\/a+.*\/run\/repo$/);
});

test('workflow store resolve supports pending claim preview paths', async () => {
  const profileHome = path.join(await mkdtemp(path.join(os.tmpdir(), 'loom-store-resolve-preview-')), '.metabot', 'profiles', 'eric');
  const store = createLoomWorkflowStore(profileHome);
  const paths = store.resolve(taskPinId);
  assert.match(paths.workflowPath, /\.runtime\/loom\/workflows\/a+.*\/pending-claim\.json$/);
  assert.match(paths.workspaceRepoPath, /\.runtime\/loom\/workspaces\/a+.*\/pending-claim\/repo$/);

  const declaration = await readFile(path.join('dist', 'core', 'loom', 'workflowStore.d.ts'), 'utf8');
  assert.match(declaration, /resolve\(taskPinId: string, claimPinId\?: string, localRunId\?: string\): LoomWorkflowPaths;/);
});

test('workflow store writes and reads normalized state', async () => {
  const profileHome = path.join(await mkdtemp(path.join(os.tmpdir(), 'loom-store-state-')), '.metabot', 'profiles', 'eric');
  const store = createLoomWorkflowStore(profileHome);
  const written = await store.write({
    version: 1,
    taskPinId,
    claimPinId,
    developerMetaBotSlug: 'eric',
    requesterGlobalMetaId: 'requester-global',
    developerGlobalMetaId: 'developer-global',
    repoUri: 'https://github.com/example/repo',
    baseBranch: 'main',
    upstreamRemote: 'origin',
    forkRemote: 'loom-fork',
    forkRepo: 'eric/repo',
    branchName: 'loom/aaaaaaaa-bbbbbbbb',
    workspacePath: '/tmp/repo',
    statuses: [],
    updatedAt: '2026-05-16T00:00:00.000Z',
  });
  assert.equal(written.taskPinId, taskPinId);
  const read = await store.read(taskPinId, claimPinId);
  assert.equal(read.branchName, 'loom/aaaaaaaa-bbbbbbbb');
  const raw = JSON.parse(await readFile(store.resolve(taskPinId, claimPinId).workflowPath, 'utf8'));
  assert.equal(raw.version, 1);
});

test('workflow store normalizes missing statuses on read', async () => {
  const profileHome = path.join(await mkdtemp(path.join(os.tmpdir(), 'loom-store-read-')), '.metabot', 'profiles', 'eric');
  const store = createLoomWorkflowStore(profileHome);
  const workflowPath = store.resolve(taskPinId, claimPinId).workflowPath;
  await mkdir(path.dirname(workflowPath), { recursive: true });
  await writeFile(workflowPath, `${JSON.stringify({
    version: 1,
    taskPinId,
    claimPinId,
    developerMetaBotSlug: 'eric',
    repoUri: 'https://github.com/example/repo',
    baseBranch: 'main',
    upstreamRemote: 'origin',
    forkRemote: 'loom-fork',
    branchName: 'loom/aaaaaaaa-bbbbbbbb',
    workspacePath: '/tmp/repo',
    updatedAt: '2026-05-16T00:00:00.000Z',
  })}\n`, 'utf8');
  const read = await store.read(taskPinId, claimPinId);
  assert.deepEqual(read.statuses, []);
});

test('workflow store returns null for malformed state', async () => {
  const profileHome = path.join(await mkdtemp(path.join(os.tmpdir(), 'loom-store-malformed-')), '.metabot', 'profiles', 'eric');
  const store = createLoomWorkflowStore(profileHome);
  const workflowPath = store.resolve(taskPinId, claimPinId).workflowPath;
  await mkdir(path.dirname(workflowPath), { recursive: true });
  await writeFile(workflowPath, `${JSON.stringify({
    version: 1,
    taskPinId,
    claimPinId,
  })}\n`, 'utf8');
  assert.equal(await store.read(taskPinId, claimPinId), null);
});

test('workflow store returns null when statuses is not an array', async () => {
  const profileHome = path.join(await mkdtemp(path.join(os.tmpdir(), 'loom-store-bad-statuses-')), '.metabot', 'profiles', 'eric');
  const store = createLoomWorkflowStore(profileHome);
  const workflowPath = store.resolve(taskPinId, claimPinId).workflowPath;
  await mkdir(path.dirname(workflowPath), { recursive: true });
  await writeFile(workflowPath, `${JSON.stringify({
    version: 1,
    taskPinId,
    claimPinId,
    developerMetaBotSlug: 'eric',
    repoUri: 'https://github.com/example/repo',
    baseBranch: 'main',
    upstreamRemote: 'origin',
    forkRemote: 'loom-fork',
    branchName: 'loom/aaaaaaaa-bbbbbbbb',
    workspacePath: '/tmp/repo',
    statuses: 'started',
    updatedAt: '2026-05-16T00:00:00.000Z',
  })}\n`, 'utf8');
  assert.equal(await store.read(taskPinId, claimPinId), null);
});

test('workflow store write does not create repo directories', async () => {
  const profileHome = path.join(await mkdtemp(path.join(os.tmpdir(), 'loom-store-side-effects-')), '.metabot', 'profiles', 'eric');
  const store = createLoomWorkflowStore(profileHome);
  const paths = store.resolve(taskPinId, claimPinId);
  await store.write({
    version: 1,
    taskPinId,
    claimPinId,
    developerMetaBotSlug: 'eric',
    repoUri: 'https://github.com/example/repo',
    baseBranch: 'main',
    upstreamRemote: 'origin',
    forkRemote: 'loom-fork',
    branchName: 'loom/aaaaaaaa-bbbbbbbb',
    workspacePath: '/tmp/repo',
    statuses: [],
    updatedAt: '2026-05-16T00:00:00.000Z',
  });
  await assert.rejects(readFile(paths.workspaceRepoPath), { code: 'ENOENT' });
  await assert.rejects(readFile(paths.stagingRepoPath), { code: 'ENOENT' });
});

test('workflow store returns null for missing state', async () => {
  const profileHome = path.join(await mkdtemp(path.join(os.tmpdir(), 'loom-store-missing-')), '.metabot', 'profiles', 'eric');
  const store = createLoomWorkflowStore(profileHome);
  assert.equal(await store.read(taskPinId, claimPinId), null);
});
