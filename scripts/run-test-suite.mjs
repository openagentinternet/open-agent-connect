#!/usr/bin/env node
// Tiered test-suite runner.
//
// Splits tests/**/*.test.mjs into two tiers:
//   - integration: a small allowlist of slow, process/daemon/build-heavy files
//     (roughly 80% of the full-suite wall time in ~6 files).
//   - fast: everything else (~95% of all subtests, finishes in minutes).
//
// `tests/cli/runtime.test.mjs` always runs last, matching the historical
// test:raw ordering requirement.
//
// Usage: node scripts/run-test-suite.mjs [fast|integration|all]

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const INTEGRATION_FILES = new Set([
  'tests/cli/runtime.test.mjs',
  'tests/skillpacks/buildSkillpacks.test.mjs',
  'tests/daemon/defaultLlmHandlers.test.mjs',
  'tests/e2e/localCrossHostDemo.test.mjs',
  'tests/npm/packageFiles.test.mjs',
]);

// Historical requirement: this file must run in its own final batch.
const RUNTIME_LAST_FILE = 'tests/cli/runtime.test.mjs';

function collectTestFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
      found.push(path.relative(REPO_ROOT, fullPath));
    }
  }
  return found;
}

function runBatch(files) {
  if (files.length === 0) {
    return 0;
  }
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', ...files],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
  return result.status ?? 1;
}

function main() {
  const tier = process.argv[2] ?? 'all';
  if (!['fast', 'integration', 'all'].includes(tier)) {
    console.error(`[test-suite] unknown tier "${tier}" (expected fast|integration|all)`);
    process.exit(2);
  }

  const allFiles = collectTestFiles(path.join(REPO_ROOT, 'tests')).sort();
  for (const file of INTEGRATION_FILES) {
    if (!allFiles.includes(file)) {
      console.error(`[test-suite] integration file missing from disk: ${file}`);
      process.exit(2);
    }
  }

  const selected = allFiles.filter((file) => {
    if (tier === 'all') return true;
    return tier === 'integration' ? INTEGRATION_FILES.has(file) : !INTEGRATION_FILES.has(file);
  });

  const main = selected.filter((file) => file !== RUNTIME_LAST_FILE);
  const last = selected.filter((file) => file === RUNTIME_LAST_FILE);

  console.log(`[test-suite] tier=${tier} files=${selected.length}`);
  const mainExit = runBatch(main);
  if (mainExit !== 0) {
    process.exit(mainExit);
  }
  process.exit(runBatch(last));
}

main();
