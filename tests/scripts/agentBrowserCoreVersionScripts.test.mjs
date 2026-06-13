import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CHECK_SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-agent-browser-core-version.mjs');
const BUMP_SCRIPT = path.join(REPO_ROOT, 'scripts', 'bump-agent-browser-core-version.mjs');
const AGENT_BROWSER_RUNTIME_PACKAGES = [
  '@openagentinternet/agent-browser-host-contract',
  '@openagentinternet/agent-browser-core',
  '@openagentinternet/agent-browser-ui',
];
const AGENT_BROWSER_DEV_PACKAGES = ['@openagentinternet/agent-browser-test-harness'];
const ALL_AGENT_BROWSER_PACKAGES = [
  ...AGENT_BROWSER_RUNTIME_PACKAGES,
  ...AGENT_BROWSER_DEV_PACKAGES,
];

function createRootPackage(version = '0.3.0') {
  return {
    name: 'open-agent-connect-fixture',
    version: '0.0.0',
    dependencies: Object.fromEntries(
      AGENT_BROWSER_RUNTIME_PACKAGES.map((packageName) => [packageName, version]),
    ),
    devDependencies: Object.fromEntries(
      AGENT_BROWSER_DEV_PACKAGES.map((packageName) => [packageName, version]),
    ),
  };
}

function createLockfile(packageJson, version = '0.3.0') {
  return {
    name: packageJson.name,
    version: packageJson.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: packageJson.name,
        version: packageJson.version,
        dependencies: packageJson.dependencies,
        devDependencies: packageJson.devDependencies,
      },
      ...Object.fromEntries(
        ALL_AGENT_BROWSER_PACKAGES.map((packageName) => [
          `node_modules/${packageName}`,
          { version },
        ]),
      ),
    },
  };
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function createFixtureRepo(t, options = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'oac-abc-version-'));
  t.after(async () => fs.rm(tempRoot, { recursive: true, force: true }));

  const rootPackage = createRootPackage(options.packageVersion ?? '0.3.0');
  if (options.mutatePackage) {
    options.mutatePackage(rootPackage);
  }
  const lockfile = createLockfile(rootPackage, options.lockVersion ?? '0.3.0');
  if (options.mutateLockfile) {
    options.mutateLockfile(lockfile);
  }

  await writeJson(path.join(tempRoot, 'package.json'), rootPackage);
  await writeJson(path.join(tempRoot, 'package-lock.json'), lockfile);
  return tempRoot;
}

async function runNodeScript(scriptPath, args, options = {}) {
  try {
    const result = await execFile(process.execPath, [scriptPath, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...options.env },
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: typeof error.code === 'number' ? error.code : 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    };
  }
}

test('ABC version check passes when OAC pins match the supplied latest version', async (t) => {
  const root = await createFixtureRepo(t);
  const result = await runNodeScript(CHECK_SCRIPT, ['--root', root, '--latest', '0.3.0']);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Agent Browser Core package pins are up to date/);
  assert.match(result.stdout, /current: 0\.3\.0/);
  assert.match(result.stdout, /latest: 0\.3\.0/);
});

test('ABC version check fails when npm latest is newer than OAC package pins', async (t) => {
  const root = await createFixtureRepo(t);
  const result = await runNodeScript(CHECK_SCRIPT, ['--root', root, '--latest', '0.3.1']);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /do not match the latest Agent Browser Core release/);
  assert.match(result.stderr, /bump-agent-browser-core-version\.mjs 0\.3\.1/);
});

test('ABC version check can explicitly allow a stale pin for an intentional release', async (t) => {
  const root = await createFixtureRepo(t);
  const result = await runNodeScript(CHECK_SCRIPT, [
    '--root',
    root,
    '--latest',
    '0.3.1',
    '--allow-stale',
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /continuing because --allow-stale was provided/);
});

test('ABC version check rejects non-exact or inconsistent package pins', async (t) => {
  const root = await createFixtureRepo(t, {
    mutatePackage(rootPackage) {
      rootPackage.dependencies['@openagentinternet/agent-browser-core'] = '^0.3.0';
    },
  });
  const result = await runNodeScript(CHECK_SCRIPT, ['--root', root, '--latest', '0.3.0']);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /must be an exact semver version/);
});

test('ABC bump script dry-run prints the exact npm install commands without mutating files', async (t) => {
  const root = await createFixtureRepo(t);
  const before = await fs.readFile(path.join(root, 'package.json'), 'utf8');
  const result = await runNodeScript(BUMP_SCRIPT, ['0.4.0', '--root', root, '--dry-run']);
  const after = await fs.readFile(path.join(root, 'package.json'), 'utf8');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(after, before);
  assert.match(result.stdout, /npm install --save-exact/);
  assert.match(result.stdout, /@openagentinternet\/agent-browser-host-contract@0\.4\.0/);
  assert.match(result.stdout, /@openagentinternet\/agent-browser-core@0\.4\.0/);
  assert.match(result.stdout, /@openagentinternet\/agent-browser-ui@0\.4\.0/);
  assert.match(result.stdout, /npm install --save-dev --save-exact/);
  assert.match(result.stdout, /@openagentinternet\/agent-browser-test-harness@0\.4\.0/);
});
