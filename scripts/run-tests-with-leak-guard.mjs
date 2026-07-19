#!/usr/bin/env node
// Test-run leak guard.
//
// Snapshots metabot-*/oac-*/loom-* temp roots under os.tmpdir(), runs the test
// command (default: npm run --silent test:raw), then verifies the run left no
// new temp roots behind — including when tests fail. Leftovers are reported
// and removed best-effort (any recorded test daemon is stopped first), and
// the guard exits non-zero so a lifecycle regression fails the run.
//
// Usage: node scripts/run-tests-with-leak-guard.mjs [-- <command>]

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEMP_ROOT_PREFIXES = ['metabot-', 'oac-', 'loom-'];

function listTempRoots() {
  const found = new Set();
  let entries = [];
  try {
    entries = readdirSync(os.tmpdir());
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (TEMP_ROOT_PREFIXES.some((prefix) => entry.startsWith(prefix))) {
      found.add(entry);
    }
  }
  return found;
}

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

function signalDaemonGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return;
  } catch {
    // Fall through to the single pid.
  }
  try {
    process.kill(pid, signal);
  } catch {
    // Already gone.
  }
}

function stopRecordedDaemon(rootDir) {
  const statePath = path.join(rootDir, '.metabot', 'runtime', 'daemon.json');
  if (!existsSync(statePath)) {
    return;
  }
  try {
    const pid = Number(JSON.parse(readFileSync(statePath, 'utf8'))?.pid);
    if (isTestDaemonProcess(pid)) {
      signalDaemonGroup(pid, 'SIGTERM');
      const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      const deadline = Date.now() + 5_000;
      let alive = true;
      while (alive && Date.now() < deadline) {
        try {
          process.kill(pid, 0);
          sleepSync(50);
        } catch {
          alive = false;
        }
      }
      if (alive) {
        signalDaemonGroup(pid, 'SIGKILL');
      }
    }
  } catch {
    // Best effort only.
  }
}

function removeLeftover(rootDir) {
  stopRecordedDaemon(rootDir);
  try {
    rmSync(rootDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const separatorIndex = process.argv.indexOf('--');
  const command = separatorIndex >= 0
    ? process.argv.slice(separatorIndex + 1).join(' ').trim()
    : 'npm run --silent test:raw';
  if (!command) {
    console.error('[leak-guard] empty test command after --');
    process.exit(2);
  }

  const before = listTempRoots();
  const exitCode = await new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: 'inherit' });
    child.on('exit', (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
    child.on('error', () => resolve(1));
  });

  const after = listTempRoots();
  const leftovers = [...after].filter((name) => !before.has(name)).sort();
  if (leftovers.length > 0) {
    const tmpdir = os.tmpdir();
    console.error(`\n[leak-guard] ${leftovers.length} temp root(s) leaked by this test run:`);
    const failedRemovals = [];
    for (const name of leftovers) {
      const rootDir = path.join(tmpdir, name);
      console.error(`[leak-guard]   ${rootDir}`);
      if (!removeLeftover(rootDir)) {
        failedRemovals.push(name);
      }
    }
    if (failedRemovals.length > 0) {
      console.error(`[leak-guard] failed to remove: ${failedRemovals.join(', ')}`);
    }
    process.exit(1);
  }

  if (exitCode !== 0) {
    console.error(`\n[leak-guard] test command exited with code ${exitCode} (no temp roots leaked)`);
  }
  process.exit(exitCode);
}

await main();
