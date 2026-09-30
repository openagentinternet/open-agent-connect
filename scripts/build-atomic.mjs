#!/usr/bin/env node
/**
 * Atomic `dist/` build. The old script (`rimraf dist && tsc`) deleted the
 * served tree before recompiling, so any process that dynamically imported a
 * dist module inside the build window (daemon, scheduled surf, CLI) hit
 * ENOENT/EPERM on half-replaced files. This script compiles into a sibling
 * temp directory and then SWAPS directories, so readers either see the whole
 * old tree or the whole new tree — never a missing/half-written one.
 *
 * Protocol (kept in sync with src/core/surf/failure.ts):
 * - While compiling, `.build-in-progress` is written into the LIVE dist so
 *   readers can classify a load failure as "build in progress" instead of a
 *   permission problem. The marker rides away with the old tree on swap, and
 *   is removed on compile failure.
 * - The new tree carries `.build-stamp.json` (build timestamp) for
 *   post-mortem diagnostics.
 * - A `.dist-build.lock` directory serializes concurrent builds; a lock
 *   older than LOCK_STALE_MS is a crashed build's leftover and is taken over.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(repoRoot, 'dist');
const buildId = `${process.pid}.${Date.now()}`;
const tmpDir = path.join(repoRoot, `.dist-build-${buildId}`);
const oldDir = path.join(repoRoot, `.dist-old-${buildId}`);
const lockDir = path.join(repoRoot, '.dist-build.lock');
const markerPath = path.join(distDir, '.build-in-progress');
const LOCK_STALE_MS = 20 * 60_000;

const require = createRequire(import.meta.url);

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function fail(message) {
  console.error(`[build-atomic] ${message}`);
  process.exit(1);
}

function acquireLock() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, 'pid'), String(process.pid));
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let ageMs = 0;
      try {
        ageMs = Date.now() - fs.statSync(lockDir).mtimeMs;
      } catch {
        ageMs = Number.POSITIVE_INFINITY;
      }
      if (ageMs > LOCK_STALE_MS) {
        rmrf(lockDir);
        continue;
      }
      fail(`another build holds .dist-build.lock (started ${Math.round(ageMs / 1000)}s ago) — wait for it or remove the stale lock`);
    }
  }
  fail('could not acquire .dist-build.lock');
}

function releaseLock() {
  rmrf(lockDir);
}

function cleanupStaleBuildDirs() {
  for (const entry of fs.readdirSync(repoRoot)) {
    if (entry === '.dist-build.lock') continue;
    if (entry.startsWith('.dist-build-') || entry.startsWith('.dist-old-')) {
      rmrf(path.join(repoRoot, entry));
    }
  }
}

const startedAt = Date.now();
acquireLock();
try {
  cleanupStaleBuildDirs();

  // Mark the LIVE tree: readers that fail to load a module while we compile
  // can tell "build in progress" apart from a real permission problem.
  if (fs.existsSync(distDir)) {
    fs.writeFileSync(markerPath, `${JSON.stringify({ pid: process.pid, startedAt: new Date(startedAt).toISOString() })}\n`);
  }

  const tscBin = require.resolve('typescript/bin/tsc');
  const compile = spawnSync(process.execPath, [tscBin, '-p', 'tsconfig.json', '--outDir', tmpDir], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (compile.status !== 0) {
    rmrf(tmpDir);
    fs.rmSync(markerPath, { force: true });
    fail(`tsc exited with status ${compile.status ?? compile.signal} — the previous dist/ was left untouched`);
  }

  fs.writeFileSync(
    path.join(tmpDir, '.build-stamp.json'),
    `${JSON.stringify({ builtAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch })}\n`,
  );

  // Swap: two renames, same filesystem. The gap between them is a pair of
  // syscalls (sub-millisecond); readers always resolve a complete tree.
  const hadDist = fs.existsSync(distDir);
  if (hadDist) fs.renameSync(distDir, oldDir);
  try {
    fs.renameSync(tmpDir, distDir);
  } catch (error) {
    // Roll back so a live tree is never left missing.
    if (hadDist && !fs.existsSync(distDir)) fs.renameSync(oldDir, distDir);
    throw error;
  }
  if (hadDist) rmrf(oldDir);

  console.log(`[build-atomic] dist/ swapped in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
} finally {
  releaseLock();
}
