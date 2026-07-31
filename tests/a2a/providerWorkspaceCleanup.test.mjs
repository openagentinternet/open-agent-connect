import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  PROVIDER_RUN_WORKSPACE_TTL_MS,
  removeProviderRunWorkspace,
  resolveProviderRunWorkspaceDir,
  sweepProviderRunWorkspaces,
} = require('../../dist/core/a2a/provider/providerWorkspaceCleanup.js');
const { promises: fs } = require('node:fs');
const path = require('node:path');
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

async function createAttemptWorkspace(projectRoot, runId, attemptId = 'attempt-1-runtime-codex') {
  const attemptDir = path.join(projectRoot, '.runtime', 'a2a-provider-runs', runId, attemptId);
  await fs.mkdir(attemptDir, { recursive: true });
  await fs.writeFile(path.join(attemptDir, 'result.txt'), 'deliverable bytes', 'utf8');
  return attemptDir;
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

test('removeProviderRunWorkspace removes the whole run dir for a realpath attempt workspace', async () => {
  const projectRoot = await mkdtempTempRoot('oac-provider-workspace-cleanup-');
  const attemptDir = await createAttemptWorkspace(projectRoot, 'order-1-run-1');
  const siblingAttempt = await createAttemptWorkspace(projectRoot, 'order-1-run-1', 'attempt-2-runtime-claude');

  // The runner stores attemptWorkspaceCwd as a real path; on macOS the temp
  // root resolves through /private/var, so pass the realpath explicitly.
  const realAttempt = await fs.realpath(attemptDir);
  const removed = await removeProviderRunWorkspace(projectRoot, realAttempt);

  assert.equal(removed, true);
  assert.equal(await pathExists(attemptDir), false);
  assert.equal(await pathExists(siblingAttempt), false);
  assert.equal(await pathExists(path.join(projectRoot, '.runtime', 'a2a-provider-runs', 'order-1-run-1')), false);
});

test('removeProviderRunWorkspace refuses paths outside the provider runs root', async () => {
  const projectRoot = await mkdtempTempRoot('oac-provider-workspace-cleanup-');
  const outsider = path.join(projectRoot, '.runtime', 'private-chat-work');
  await fs.mkdir(outsider, { recursive: true });
  await fs.writeFile(path.join(outsider, 'keep.txt'), 'keep', 'utf8');

  assert.equal(await resolveProviderRunWorkspaceDir(projectRoot, outsider), null);
  assert.equal(await removeProviderRunWorkspace(projectRoot, outsider), false);
  assert.equal(await resolveProviderRunWorkspaceDir(projectRoot, path.join(projectRoot, '.runtime', 'a2a-provider-runs')), null);
  assert.equal(await resolveProviderRunWorkspaceDir(projectRoot, ''), null);
  assert.equal(await resolveProviderRunWorkspaceDir(projectRoot, null), null);
  assert.equal(await pathExists(outsider), true);
});

test('sweepProviderRunWorkspaces removes TTL-expired runs and keeps fresh ones', async () => {
  const projectRoot = await mkdtempTempRoot('oac-provider-workspace-cleanup-');
  const staleAttempt = await createAttemptWorkspace(projectRoot, 'stale-run');
  const freshAttempt = await createAttemptWorkspace(projectRoot, 'fresh-run');

  const nowMs = Date.now();
  const staleMs = nowMs - PROVIDER_RUN_WORKSPACE_TTL_MS - 60_000;
  const staleDate = new Date(staleMs);
  const staleRunDir = path.dirname(staleAttempt);
  await fs.utimes(staleAttempt, staleDate, staleDate);
  await fs.utimes(staleRunDir, staleDate, staleDate);

  const result = await sweepProviderRunWorkspaces({ projectRoot, nowMs });

  assert.deepEqual(result.removedRunIds, ['stale-run']);
  assert.equal(await pathExists(staleRunDir), false);
  assert.equal(await pathExists(freshAttempt), true);
});

test('sweepProviderRunWorkspaces honors a custom TTL and ignores a missing runs root', async () => {
  const projectRoot = await mkdtempTempRoot('oac-provider-workspace-cleanup-');

  const empty = await sweepProviderRunWorkspaces({ projectRoot });
  assert.deepEqual(empty.removedRunIds, []);

  const attemptDir = await createAttemptWorkspace(projectRoot, 'hour-old-run');
  const nowMs = Date.now();
  const agedMs = nowMs - 2 * 60 * 60_000;
  const agedDate = new Date(agedMs);
  await fs.utimes(attemptDir, agedDate, agedDate);
  await fs.utimes(path.dirname(attemptDir), agedDate, agedDate);

  const kept = await sweepProviderRunWorkspaces({ projectRoot, ttlMs: 24 * 60 * 60_000, nowMs });
  assert.deepEqual(kept.removedRunIds, []);
  assert.equal(await pathExists(attemptDir), true);

  const swept = await sweepProviderRunWorkspaces({ projectRoot, ttlMs: 60 * 60_000, nowMs });
  assert.deepEqual(swept.removedRunIds, ['hour-old-run']);
  assert.equal(await pathExists(attemptDir), false);
});
