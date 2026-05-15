import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
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
  assert.match(paths.workflowPath, /\.runtime\/loom\/workflows\/a+.*\/b+.*\.json$/);
  assert.match(paths.workspaceRepoPath, /\.runtime\/loom\/workspaces\/a+.*\/b+.*\/repo$/);
  assert.match(paths.stagingRepoPath, /\.runtime\/loom\/staging\/a+.*\/run-1\/repo$/);
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

test('workflow store returns null for missing state', async () => {
  const profileHome = path.join(await mkdtemp(path.join(os.tmpdir(), 'loom-store-missing-')), '.metabot', 'profiles', 'eric');
  const store = createLoomWorkflowStore(profileHome);
  assert.equal(await store.read(taskPinId, claimPinId), null);
});
