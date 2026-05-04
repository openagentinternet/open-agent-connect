import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const MAX_PACKED_SIZE_BYTES = 20 * 1024 * 1024;

async function readPackDryRun() {
  const { stdout } = await execFile('npm', ['pack', '--dry-run', '--json'], {
    cwd: REPO_ROOT,
    maxBuffer: 100 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);
  assert.equal(Array.isArray(parsed), true);
  assert.equal(parsed.length, 1);
  return parsed[0];
}

function pathsFromPack(pack) {
  return new Set(pack.files.map((entry) => entry.path));
}

function assertIncludes(paths, filePath) {
  assert.equal(paths.has(filePath), true, `expected npm pack to include ${filePath}`);
}

function assertExcludesPrefix(paths, prefix) {
  for (const filePath of paths) {
    assert.equal(filePath.startsWith(prefix), false, `expected npm pack to exclude ${prefix}, found ${filePath}`);
  }
}

function assertExcludesSegment(paths, segment) {
  for (const filePath of paths) {
    assert.equal(filePath.includes(segment), false, `expected npm pack to exclude ${segment}, found ${filePath}`);
  }
}

test('npm package includes runtime install inputs and excludes generated/development-only artifacts', async () => {
  const pack = await readPackDryRun();
  const paths = pathsFromPack(pack);

  assertIncludes(paths, 'dist/cli/main.js');
  assertIncludes(paths, 'dist/oac/main.js');
  assertIncludes(paths, 'SKILLs/metabot-ask-master/SKILL.md');
  assertIncludes(paths, 'skillpacks/common/templates/system-routing.md');
  assertIncludes(paths, 'docs/install/open-agent-connect.md');
  assertIncludes(paths, 'README.md');
  assertIncludes(paths, 'LICENSE');
  assertIncludes(paths, 'release/compatibility.json');
  assertIncludes(paths, 'src/ui/pages/hub/index.html');

  assertExcludesPrefix(paths, 'tests/');
  assertExcludesPrefix(paths, 'release/packs/');
  assertExcludesPrefix(paths, 'skillpacks/codex/runtime/node_modules/');
  assertExcludesPrefix(paths, 'skillpacks/claude-code/runtime/node_modules/');
  assertExcludesPrefix(paths, 'skillpacks/openclaw/runtime/node_modules/');
  assertExcludesPrefix(paths, '.github/');
  assertExcludesSegment(paths, '/evals/');

  assert.ok(
    pack.size < MAX_PACKED_SIZE_BYTES,
    `expected packed size below ${MAX_PACKED_SIZE_BYTES} bytes, got ${pack.size}`,
  );
});
