import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  cleanupTempRoot,
  cleanupTempRoots,
  listTrackedTempRoots,
  mkdtempTempRoot,
  mkdtempTempRootSync,
  watchTempRootPrefix,
} from './tempRoots.mjs';

const TEMP_ROOTS_HELPER_URL = pathToFileURL(fileURLToPath(new URL('./tempRoots.mjs', import.meta.url))).href;

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

test('mkdtempTempRoot registers the root and cleanupTempRoot removes it', async () => {
  const root = await mkdtempTempRoot('oac-temp-roots-basic-');
  assert.ok(existsSync(root));
  assert.ok(listTrackedTempRoots().includes(root));

  await cleanupTempRoot(root);

  assert.equal(existsSync(root), false);
  assert.equal(listTrackedTempRoots().includes(root), false);
});

test('mkdtempTempRootSync registers the root and cleanup is idempotent', async () => {
  const root = mkdtempTempRootSync('oac-temp-roots-sync-');
  assert.ok(existsSync(root));

  await cleanupTempRoot(root);
  await cleanupTempRoot(root);

  assert.equal(existsSync(root), false);
});

test('cleanupTempRoot stops a detached daemon process group and waits for exit', async (t) => {
  const root = await mkdtempTempRoot('oac-temp-roots-daemon-');
  const daemonStateDir = path.join(root, '.metabot', 'runtime');
  await mkdir(daemonStateDir, { recursive: true });

  // Emulate a detached `daemon serve`: a group leader whose same-group child
  // survives unless the whole process group is signaled.
  const fakeCliDir = path.join(root, 'dist', 'cli');
  await mkdir(fakeCliDir, { recursive: true });
  const fakeDaemonEntry = path.join(fakeCliDir, 'main.js');
  const childMarkerPath = path.join(root, 'daemon-child.json');
  await writeFile(
    fakeDaemonEntry,
    `const { spawn } = require('node:child_process');
     const fs = require('node:fs');
     const kid = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
     fs.writeFileSync(${JSON.stringify(childMarkerPath)}, JSON.stringify({ childPid: kid.pid }));
     setInterval(() => {}, 1000);`,
    'utf8',
  );

  const daemon = spawn(process.execPath, [fakeDaemonEntry, 'daemon', 'serve'], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
  });
  daemon.unref();
  t.after(() => {
    try {
      process.kill(-daemon.pid, 'SIGKILL');
    } catch {
      // Already stopped by the cleanup under test.
    }
  });

  assert.ok(await waitFor(() => existsSync(childMarkerPath)), 'daemon child marker was written');
  const daemonChildPid = JSON.parse(await readFile(childMarkerPath, 'utf8')).childPid;

  await writeFile(
    path.join(daemonStateDir, 'daemon.json'),
    JSON.stringify({ pid: daemon.pid, baseUrl: 'http://127.0.0.1:9' }),
    'utf8',
  );

  await cleanupTempRoot(root);

  const exited = await waitFor(() => !isProcessAlive(daemon.pid) && !isProcessAlive(daemonChildPid));
  assert.equal(exited, true, 'daemon leader and same-group child both exited');

  assert.equal(existsSync(root), false);
  assert.equal(listTrackedTempRoots().includes(root), false);
});

test('cleanupTempRoot ignores daemon state files that point at unrelated processes', async () => {
  const root = await mkdtempTempRoot('oac-temp-roots-stale-daemon-');
  const daemonStateDir = path.join(root, '.metabot', 'runtime');
  await mkdir(daemonStateDir, { recursive: true });
  await writeFile(
    path.join(daemonStateDir, 'daemon.json'),
    // process.pid is this test runner; teardown must never signal it.
    JSON.stringify({ pid: process.pid }),
    'utf8',
  );

  await cleanupTempRoot(root);

  assert.equal(existsSync(root), false);
  assert.ok(isProcessAlive(process.pid));
});

test('cleanupTempRoot moves the process cwd out of the removed root', async () => {
  const root = await mkdtempTempRoot('oac-temp-roots-cwd-');
  const previousCwd = process.cwd();
  process.chdir(root);

  await cleanupTempRoot(root);

  assert.equal(existsSync(root), false);
  assert.equal(process.cwd(), previousCwd);
});

test('watchTempRootPrefix sweeps matching roots created after the watch starts', async () => {
  const prefix = 'oac-temp-roots-watch-';
  // Created before the watch and intentionally untracked: must be preserved.
  const preExisting = await mkdtemp(path.join(os.tmpdir(), prefix));
  watchTempRootPrefix(prefix);

  const stray = path.join(os.tmpdir(), `${prefix}stray-${process.pid}`);
  await mkdir(stray, { recursive: true });

  await cleanupTempRoots();

  assert.equal(existsSync(stray), false, 'stray matching root was swept');
  assert.equal(existsSync(preExisting), true, 'pre-existing root is untouched');
  await rm(preExisting, { recursive: true, force: true });
});

test('a root re-created by a late write after cleanup is removed by the exit fallback', async () => {
  const sandbox = await mkdtempTempRoot('oac-temp-roots-late-write-');
  const markerPath = path.join(sandbox, 'recreated-root.txt');
  const fixturePath = path.join(sandbox, 'late-write.fixture.test.mjs');
  await writeFile(
    fixturePath,
    `import test from 'node:test';
     import { mkdirSync, writeFileSync } from 'node:fs';
     import path from 'node:path';
     import { mkdtempTempRoot, cleanupTempRoot } from ${JSON.stringify(TEMP_ROOTS_HELPER_URL)};
     test('cleans a root that a late write then recreates', async () => {
       const root = await mkdtempTempRoot('oac-temp-roots-late-');
       await cleanupTempRoot(root);
       // Simulate a fire-and-forget async writer (e.g. trace export) that
       // recreates the root after its cleanup already ran.
       mkdirSync(path.join(root, '.metabot', 'profiles', 'test-profile', '.runtime'), { recursive: true });
       writeFileSync(${JSON.stringify(markerPath)}, root);
     });`,
    'utf8',
  );

  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ['--test', fixturePath], {
    encoding: 'utf8',
    env,
  });

  assert.equal(run.status, 0, `fixture must pass:\n${run.stdout}\n${run.stderr}`);
  const recreatedRoot = (await readFile(markerPath, 'utf8')).trim();
  assert.equal(existsSync(recreatedRoot), false, `exit fallback removed late-recreated ${recreatedRoot}`);
});

test('a failing test file leaves no tracked temp roots behind', async () => {
  const sandbox = await mkdtempTempRoot('oac-temp-roots-e2e-');
  const markerPath = path.join(sandbox, 'created-root.txt');
  const fixturePath = path.join(sandbox, 'leaky.fixture.test.mjs');
  await writeFile(
    fixturePath,
    `import test from 'node:test';
     import assert from 'node:assert/strict';
     import { writeFileSync } from 'node:fs';
     import { mkdtempTempRoot } from ${JSON.stringify(TEMP_ROOTS_HELPER_URL)};
     test('creates a root then fails', async () => {
       const root = await mkdtempTempRoot('oac-temp-roots-leaky-');
       writeFileSync(${JSON.stringify(markerPath)}, root);
       assert.equal(1, 2);
     });`,
    'utf8',
  );

  const env = { ...process.env };
  // A nested `node --test` must behave as a standalone runner, not as a child
  // of this file's runner.
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ['--test', fixturePath], {
    encoding: 'utf8',
    env,
  });

  assert.notEqual(run.status, 0, `fixture test file must fail:\n${run.stdout}\n${run.stderr}`);
  const leakedRoot = (await readFile(markerPath, 'utf8')).trim();
  const realTmpdir = await import('node:fs/promises').then((fs) => fs.realpath(os.tmpdir()));
  assert.ok(leakedRoot.startsWith(realTmpdir), `fixture recorded its temp root under ${realTmpdir}`);
  assert.equal(existsSync(leakedRoot), false, `teardown removed ${leakedRoot} even after failure`);
});
