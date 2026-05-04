import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const VERIFY_SCRIPT = path.join(REPO_ROOT, 'scripts', 'verify-release-version.mjs');

async function runVerifier(args, options = {}) {
  return execFile(process.execPath, [VERIFY_SCRIPT, ...args], {
    cwd: REPO_ROOT,
    ...options,
  });
}

async function makeVersionFixture({
  packageVersion = '1.2.3',
  compatibility = {
    core: '1.2.3',
    cli: '1.2.3',
    skillpacks: {
      codex: '1.2.3',
      'claude-code': '1.2.3',
      openclaw: '1.2.3',
    },
  },
} = {}) {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'oac-release-version-'));
  await writeFile(
    path.join(fixtureRoot, 'package.json'),
    JSON.stringify({ name: 'open-agent-connect', version: packageVersion }, null, 2),
  );
  await writeFile(
    path.join(fixtureRoot, 'compatibility.json'),
    JSON.stringify(compatibility, null, 2),
  );
  return fixtureRoot;
}

test('release workflow publishes GitHub release assets and npm package from the same tag', async () => {
  const workflow = await readFile(path.join(REPO_ROOT, '.github', 'workflows', 'release.yml'), 'utf8');

  assert.match(workflow, /push:\s*\n\s+tags:\s*\n\s+- 'v\*\.\*\.\*'/);
  assert.match(workflow, /contents:\s+write/);
  assert.match(workflow, /id-token:\s+write/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN/);
  assert.doesNotMatch(workflow, /NPM_TOKEN/);
  assert.match(workflow, /node-version:\s+'24'/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /npm run build:skillpacks/);
  assert.match(workflow, /node scripts\/verify-release-version\.mjs "\$\{\{\s*github\.ref_name\s*\}\}"/);
  assert.match(workflow, /node scripts\/build-release-packs\.mjs/);
  assert.match(workflow, /gh release upload "\$RELEASE_TAG"/);
  assert.match(workflow, /--clobber/);
  assert.match(workflow, /npm view "open-agent-connect@\$PACKAGE_VERSION" version/);
  assert.match(workflow, /npm publish --access public/);
  assert.doesNotMatch(workflow, /--provenance/);
  assert.match(workflow, /gh release create "\$RELEASE_TAG"/);
});

test('package metadata supports npm provenance from the GitHub release workflow', async () => {
  const packageJson = JSON.parse(await readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'));

  assert.equal(packageJson.repository?.type, 'git');
  assert.equal(
    packageJson.repository?.url,
    'git+https://github.com/openagentinternet/open-agent-connect.git',
  );
});

test('release documentation explains the tag-driven GitHub and npm publish path', async () => {
  const readme = await readFile(path.join(REPO_ROOT, 'README.md'), 'utf8');
  const agentInstructions = await readFile(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8');

  for (const content of [readme, agentInstructions]) {
    assert.match(content, /node scripts\/verify-release-version\.mjs v\{version\}/);
    assert.match(content, /git tag v\{version\}/);
    assert.doesNotMatch(content, /NPM_TOKEN/);
    assert.match(content, /Trusted Publisher/i);
    assert.match(content, /openagentinternet\/open-agent-connect/);
    assert.match(content, /release\.yml/);
    assert.match(content, /publishes the same version to npm/i);
    assert.match(content, /Do not run .*npm publish/i);
  }
});

test('verify-release-version accepts matching tag, package version, and compatibility manifest', async (t) => {
  const fixtureRoot = await makeVersionFixture();
  t.after(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  const { stdout } = await runVerifier([
    'v1.2.3',
    '--package-json',
    path.join(fixtureRoot, 'package.json'),
    '--compatibility-json',
    path.join(fixtureRoot, 'compatibility.json'),
  ]);

  assert.match(stdout, /Release version verified: 1\.2\.3/);
});

test('verify-release-version rejects a tag that does not match package.json', async (t) => {
  const fixtureRoot = await makeVersionFixture();
  t.after(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  await assert.rejects(
    runVerifier([
      'v1.2.4',
      '--package-json',
      path.join(fixtureRoot, 'package.json'),
      '--compatibility-json',
      path.join(fixtureRoot, 'compatibility.json'),
    ]),
    /Tag version 1\.2\.4 does not match package\.json version 1\.2\.3/,
  );
});

test('verify-release-version rejects compatibility manifest version drift', async (t) => {
  const fixtureRoot = await makeVersionFixture({
    compatibility: {
      core: '1.2.3',
      cli: '1.2.3',
      skillpacks: {
        codex: '1.2.3',
        'claude-code': '1.2.4',
        openclaw: '1.2.3',
      },
    },
  });
  t.after(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  await assert.rejects(
    runVerifier([
      'v1.2.3',
      '--package-json',
      path.join(fixtureRoot, 'package.json'),
      '--compatibility-json',
      path.join(fixtureRoot, 'compatibility.json'),
    ]),
    /release\/compatibility\.json skillpacks\.claude-code version 1\.2\.4 does not match package\.json version 1\.2\.3/,
  );
});
