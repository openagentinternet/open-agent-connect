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
  'metabot-browser-open',
  'metabot-call-remote-service',
  'metabot-chat-privatechat',
  'metabot-help',
  'metabot-identity-manage',
  'metabot-loom-wish2task',
  'metabot-network-manage',
  'metabot-omni-reader',
  'metabot-post-buzz',
  'metabot-post-skillservice',
  'metabot-create-wiki',
  'metabot-metaapp',
  'metabot-upload-file',
  'metabot-upload-largefile',
  'metabot-wallet-manage',
];
const OFFICIAL_SKILL_PREFIX = 'metabot-';
const PACKAGE_SKILL_FILE_PATTERN = /^SKILLs\/([^/]+)\/SKILL\.md$/;
const AGENT_BROWSER_RUNTIME_PACKAGES = [
  '@openagentinternet/agent-browser-host-contract',
  '@openagentinternet/agent-browser-core',
  '@openagentinternet/agent-browser-ui',
];
const AGENT_BROWSER_DEV_PACKAGES = ['@openagentinternet/agent-browser-test-harness'];
const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

async function readPackDryRun() {
  await execFile('npm', ['run', 'build'], {
    cwd: REPO_ROOT,
    maxBuffer: 100 * 1024 * 1024,
  });
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

function extractPackagedSkillName(filePath) {
  return filePath.match(PACKAGE_SKILL_FILE_PATTERN)?.[1] ?? null;
}

function assertOfficialSkillName(skillName, source) {
  assert.equal(
    skillName.startsWith(OFFICIAL_SKILL_PREFIX),
    true,
    `expected ${source} skill ${skillName} to use the ${OFFICIAL_SKILL_PREFIX} prefix`,
  );
}

function assertExactSharedBrowserPins(packageJson) {
  const versions = [];
  for (const packageName of AGENT_BROWSER_RUNTIME_PACKAGES) {
    const version = packageJson.dependencies[packageName];
    assert.match(version, EXACT_SEMVER_RE, `${packageName} must be an exact package version`);
    versions.push(version);
  }
  for (const packageName of AGENT_BROWSER_DEV_PACKAGES) {
    const version = packageJson.devDependencies[packageName];
    assert.match(version, EXACT_SEMVER_RE, `${packageName} must be an exact package version`);
    versions.push(version);
  }

  assert.deepEqual([...new Set(versions)], [versions[0]], 'Agent Browser packages must share one version');
  assert.equal(packageJson.dependencies['@openagentinternet/agent-browser-host-standalone'], undefined);
}

test('npm package includes runtime install inputs and excludes generated/development-only artifacts', async () => {
  const packageJson = JSON.parse(await readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.files.includes('SKILLs/*/SKILL.md'),
    false,
    'npm package should use an explicit skill allowlist',
  );
  for (const filePath of packageJson.files) {
    const skillName = extractPackagedSkillName(filePath);
    if (skillName) {
      assertOfficialSkillName(skillName, 'package.json files');
    }
  }

  for (const skillName of EXPECTED_NPM_SKILLS) {
    assert.equal(
      packageJson.files.includes(`SKILLs/${skillName}/SKILL.md`),
      true,
      `expected package.json files to include ${skillName}`,
    );
  }

  const pack = await readPackDryRun();
  const paths = pathsFromPack(pack);
  for (const filePath of paths) {
    const skillName = extractPackagedSkillName(filePath);
    if (skillName) {
      assertOfficialSkillName(skillName, 'npm pack');
    }
  }

  assertIncludes(paths, 'dist/cli/main.js');
  assertIncludes(paths, 'dist/oac/main.js');
  for (const skillName of EXPECTED_NPM_SKILLS) {
    assertIncludes(paths, `SKILLs/${skillName}/SKILL.md`);
  }
  assertIncludes(paths, 'SKILLs/metabot-create-wiki/scripts/scaffold-wiki-skill.js');
  assertIncludes(paths, 'SKILLs/metabot-create-wiki/scripts/self-test.js');
  assertIncludes(paths, 'SKILLs/metabot-create-wiki/assets/wiki-skill/scripts/index.js.template');
  assertIncludes(paths, 'SKILLs/metabot-create-wiki/assets/metabot-llm-wiki-runtime/SKILL.md');
  assertIncludes(paths, 'SKILLs/metabot-create-wiki/assets/metabot-llm-wiki-runtime/scripts/index.js');
  assertIncludes(paths, 'SKILLs/metabot-create-wiki/assets/metabot-llm-wiki-runtime/references/payload-schema-v1.json');
  assertIncludes(paths, 'skillpacks/common/templates/system-routing.md');
  assertIncludes(paths, 'scripts/oac-dev-mode.sh');
  assertIncludes(paths, 'docs/install/open-agent-connect.md');
  assertIncludes(paths, 'README.md');
  assertIncludes(paths, 'LICENSE');
  assertIncludes(paths, 'release/compatibility.json');
  assertIncludes(paths, 'src/browser/index.html');
  assertIncludes(paths, 'src/ui/pages/hub/index.html');

  assertExcludesPrefix(paths, 'tests/');
  assertExcludesPrefix(paths, 'release/packs/');
  assertExcludesPrefix(paths, 'skillpacks/codex/runtime/node_modules/');
  assertExcludesPrefix(paths, 'skillpacks/claude-code/runtime/node_modules/');
  assertExcludesPrefix(paths, 'skillpacks/openclaw/runtime/node_modules/');
  assertExcludesPrefix(paths, 'skillpacks/zcode/runtime/node_modules/');
  assertExcludesPrefix(paths, 'skillpacks/workbuddy/runtime/node_modules/');
  assertExcludesPrefix(paths, 'dist/browser/standalone/');
  assertExcludesPrefix(paths, 'dist/core/browser/');
  assertExcludesPrefix(paths, 'src/core/browser/');
  assertExcludesPrefix(paths, 'dist/daemon/browser/oacBrowserCoreBridge');
  assertExcludesPrefix(paths, '.github/');
  assertExcludesSegment(paths, '/evals/');
  assert.ok(
    pack.size < MAX_PACKED_SIZE_BYTES,
    `expected packed size below ${MAX_PACKED_SIZE_BYTES} bytes, got ${pack.size}`,
  );
});

test('npm package pins shared Agent Browser package dependencies', async () => {
  const packageJson = JSON.parse(await readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assertExactSharedBrowserPins(packageJson);
});
