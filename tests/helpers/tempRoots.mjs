// Tracked temporary roots for tests.
//
// Every fs.mkdtemp(os.tmpdir(), ...) creation point in tests must go through
// mkdtempTempRoot()/mkdtempTempRootSync() (or through profileHome.mjs, which
// delegates here). Each created root is registered once and removed in a
// finally-style teardown:
//   1. a root-level after() hook per test-file process (runs on success,
//      failure, and test timeouts), and
//   2. a synchronous process-exit fallback for hard crashes.
// Cleanup first stops any test-spawned daemon recorded under the root
// (.metabot/runtime/daemon.json and legacy per-profile .runtime/daemon.json),
// killing the whole detached process group instead of only the parent pid,
// moves the process cwd out of the root if it ever landed inside, and only
// then removes the directory tree with retry.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';

const DAEMON_STOP_TIMEOUT_MS = 10_000;
const DAEMON_STOP_POLL_INTERVAL_MS = 50;
const RM_RETRY_COUNT = 6;
const RM_RETRY_BASE_DELAY_MS = 40;

const trackedRoots = new Set();
// Roots already cleaned once. Async writers (e.g. fire-and-forget trace
// exports) can re-create a root after its cleanup ran; the process-exit
// fallback sweeps this set again so late writes cannot resurrect a leak.
const cleanedRoots = new Set();
const prefixWatches = [];
const initialCwd = process.cwd();
const underTestRunner = Boolean(process.env.NODE_TEST_CONTEXT);

// Register teardown hooks at module load. Import time is outside any running
// test, so the after() hook attaches to the test file's root suite and runs
// once when the file finishes (success, failure, or timeout). Registering it
// lazily inside a test would instead attach to that single test and remove
// roots that later tests still share (e.g. module-level build caches).
if (underTestRunner) {
  after(async () => {
    await cleanupTempRoots();
  });
}
process.once('exit', () => {
  cleanupTempRootsSync();
});

// macOS returns /var/folders/... from os.tmpdir() while /var is a symlink to
// /private/var; normalize through realpath so cwd comparisons and tracked
// paths always agree.
function resolveReal(rootDir) {
  const resolved = path.resolve(rootDir);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function registerTempRoot(rootDir) {
  const resolved = resolveReal(rootDir);
  trackedRoots.add(resolved);
  return resolved;
}

export async function mkdtempTempRoot(prefix = 'oac-test-') {
  return registerTempRoot(await mkdtemp(path.join(os.tmpdir(), prefix)));
}

export function mkdtempTempRootSync(prefix = 'oac-test-') {
  return registerTempRoot(mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function listTrackedTempRoots() {
  return [...trackedRoots];
}

function snapshotTmpdirEntries(prefix) {
  try {
    return new Set(readdirSync(os.tmpdir()).filter((entry) => entry.startsWith(prefix)));
  } catch {
    return new Set();
  }
}

// Watch a tmpdir entry prefix for roots created OUTSIDE this helper (e.g.
// staging directories that business code such as metaapp publish leaves in
// os.tmpdir() on purpose). Entries that appear after the watch starts are
// swept by the same teardown that removes tracked roots; pre-existing entries
// are never touched.
export function watchTempRootPrefix(prefix) {
  const watch = { prefix, snapshot: snapshotTmpdirEntries(prefix) };
  prefixWatches.push(watch);
  return watch;
}

async function sweepWatchedPrefixes() {
  for (const watch of prefixWatches) {
    let entries = [];
    try {
      entries = readdirSync(os.tmpdir());
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.startsWith(watch.prefix) || watch.snapshot.has(entry)) {
        continue;
      }
      await cleanupTempRoot(path.join(os.tmpdir(), entry)).catch(() => undefined);
    }
  }
}

function sweepWatchedPrefixesSync() {
  for (const watch of prefixWatches) {
    let entries = [];
    try {
      entries = readdirSync(os.tmpdir());
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.startsWith(watch.prefix) || watch.snapshot.has(entry)) {
        continue;
      }
      try {
        rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
      } catch {
        // Best effort only during process exit.
      }
    }
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function isProcessGroupAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

// Test-spawned daemons are detached children running
// `node <repo>/dist/cli/main.js daemon serve`. Verify the recorded pid really
// is such a daemon before signaling it so a stale or forged pid in a state
// file can never cause us to kill an unrelated process (including this test
// runner itself).
function isTestDaemonProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    return false;
  }
  try {
    const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return command.includes('daemon serve')
      || command.includes(`${path.sep}dist${path.sep}cli${path.sep}main.js`);
  } catch {
    return false;
  }
}

function signalDaemon(pid, signal) {
  // The daemon is spawned with detached: true, so it leads its own process
  // group. Signal the whole group first so children (supervisors, browser
  // hosts) cannot outlive the parent; fall back to the single pid.
  try {
    process.kill(-pid, signal);
    return;
  } catch {
    // ESRCH: group already gone; fall through to the single-pid signal.
  }
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      throw error;
    }
  }
}

async function readDaemonPidsFromStateFile(statePath) {
  try {
    const record = JSON.parse(await readFile(statePath, 'utf8'));
    const pid = Number(record?.pid);
    return Number.isInteger(pid) && pid > 0 ? [pid] : [];
  } catch {
    return [];
  }
}

async function collectDaemonStatePaths(systemHomeDir) {
  const statePaths = [];
  const globalStatePath = path.join(systemHomeDir, '.metabot', 'runtime', 'daemon.json');
  if (existsSync(globalStatePath)) {
    statePaths.push(globalStatePath);
  }
  const profilesRoot = path.join(systemHomeDir, '.metabot', 'profiles');
  try {
    for (const entry of await readdir(profilesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const legacyStatePath = path.join(profilesRoot, entry.name, '.runtime', 'daemon.json');
      if (existsSync(legacyStatePath)) {
        statePaths.push(legacyStatePath);
      }
    }
  } catch {
    // No profiles root inside this temp root.
  }
  return statePaths;
}

// Stop every test daemon recorded under a system-home temp root and wait for
// the processes to actually exit before returning.
export async function stopTestDaemonsUnderRoot(systemHomeDir) {
  const statePaths = await collectDaemonStatePaths(systemHomeDir);
  const pids = new Set();
  for (const statePath of statePaths) {
    for (const pid of await readDaemonPidsFromStateFile(statePath)) {
      if (isTestDaemonProcess(pid)) {
        pids.add(pid);
      }
    }
  }
  if (pids.size === 0) {
    return;
  }

  for (const pid of pids) {
    signalDaemon(pid, 'SIGTERM');
  }
  const deadline = Date.now() + DAEMON_STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const anyAlive = [...pids].some((pid) => isProcessAlive(pid) || isProcessGroupAlive(pid));
    if (!anyAlive) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, DAEMON_STOP_POLL_INTERVAL_MS));
  }
  for (const pid of pids) {
    if (isProcessAlive(pid) || isProcessGroupAlive(pid)) {
      signalDaemon(pid, 'SIGKILL');
    }
  }
  for (const statePath of statePaths) {
    await rm(statePath, { force: true }).catch(() => undefined);
  }
}

function ensureCwdOutside(rootDir) {
  const resolved = resolveReal(rootDir);
  let cwd;
  try {
    cwd = resolveReal(process.cwd());
  } catch {
    process.chdir(initialCwd);
    return;
  }
  if (cwd === resolved || cwd.startsWith(`${resolved}${path.sep}`)) {
    process.chdir(initialCwd);
  }
}

export async function rmTempRootWithRetry(target) {
  let lastError = null;
  for (let attempt = 0; attempt < RM_RETRY_COUNT; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? error.code
        : '';
      if (code === 'ENOENT') {
        return;
      }
      if (code !== 'ENOTEMPTY' && code !== 'EBUSY') {
        throw error;
      }
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, RM_RETRY_BASE_DELAY_MS * (attempt + 1)));
    }
  }
  if (lastError) {
    throw lastError;
  }
}

// Full teardown for one temp root: stop daemons (and wait for them), move the
// process cwd out of the root, then remove the tree. Safe to call for roots
// that were never registered or were already removed.
export async function cleanupTempRoot(rootDir) {
  const resolved = resolveReal(rootDir);
  await stopTestDaemonsUnderRoot(resolved);
  ensureCwdOutside(resolved);
  await rmTempRootWithRetry(resolved);
  trackedRoots.delete(resolved);
  cleanedRoots.add(resolved);
}

export async function cleanupTempRoots() {
  const failures = [];
  for (const rootDir of [...trackedRoots]) {
    try {
      await cleanupTempRoot(rootDir);
    } catch (error) {
      failures.push(`${rootDir}: ${error?.message ?? error}`);
    }
  }
  // Roots cleaned earlier in this process may have been re-created by late
  // async writes; sweep them again.
  for (const rootDir of [...cleanedRoots]) {
    if (!existsSync(rootDir)) {
      continue;
    }
    try {
      await cleanupTempRoot(rootDir);
    } catch (error) {
      failures.push(`${rootDir}: ${error?.message ?? error}`);
    }
  }
  await sweepWatchedPrefixes();
  if (failures.length > 0) {
    console.warn(`[tempRoots] failed to remove ${failures.length} temp root(s):\n${failures.join('\n')}`);
  }
}

function cleanupTempRootsSync() {
  sweepWatchedPrefixesSync();
  for (const rootDir of new Set([...trackedRoots, ...cleanedRoots])) {
    try {
      const globalStatePath = path.join(rootDir, '.metabot', 'runtime', 'daemon.json');
      if (existsSync(globalStatePath)) {
        const record = JSON.parse(readFileSync(globalStatePath, 'utf8'));
        const pid = Number(record?.pid);
        if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && isTestDaemonProcess(pid)) {
          signalDaemon(pid, 'SIGKILL');
        }
      }
    } catch {
      // Best effort only during process exit.
    }
    try {
      rmSync(rootDir, { recursive: true, force: true });
    } catch {
      // Best effort only during process exit.
    }
  }
}
