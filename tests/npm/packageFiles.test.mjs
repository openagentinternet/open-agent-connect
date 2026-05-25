import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const MAX_PACKED_SIZE_BYTES = 20 * 1024 * 1024;
const EXPECTED_NPM_SKILLS = [
  'metabot-ask-master',
  'metabot-call-remote-service',
  'metabot-chat-privatechat',
  'metabot-help',
  'metabot-identity-manage',
  'metabot-loom-wish2task',
  'metabot-network-manage',
  'metabot-omni-reader',
  'metabot-post-buzz',
  'metabot-post-skillservice',
  'metabot-upload-file',
  'metabot-wallet-manage',
];
const NON_DISTRIBUTED_SKILLS = [
  'new-api-vendor-skill',
];

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
  const packageJson = JSON.parse(await readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.files.includes('SKILLs/*/SKILL.md'),
    false,
    'npm package should use an explicit skill allowlist',
  );

  for (const skillName of EXPECTED_NPM_SKILLS) {
    assert.equal(
      packageJson.files.includes(`SKILLs/${skillName}/SKILL.md`),
      true,
      `expected package.json files to include ${skillName}`,
    );
  }

  const pack = await readPackDryRun();
  const paths = pathsFromPack(pack);

  assertIncludes(paths, 'dist/cli/main.js');
  assertIncludes(paths, 'dist/oac/main.js');
  for (const skillName of EXPECTED_NPM_SKILLS) {
    assertIncludes(paths, `SKILLs/${skillName}/SKILL.md`);
  }
  assertIncludes(paths, 'skillpacks/common/templates/system-routing.md');
  assertIncludes(paths, 'scripts/oac-dev-mode.sh');
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
  for (const skillName of NON_DISTRIBUTED_SKILLS) {
    assertExcludesPrefix(paths, `SKILLs/${skillName}/`);
  }

  assert.ok(
    pack.size < MAX_PACKED_SIZE_BYTES,
    `expected packed size below ${MAX_PACKED_SIZE_BYTES} bytes, got ${pack.size}`,
  );
});
