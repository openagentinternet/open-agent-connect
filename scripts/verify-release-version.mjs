import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

function usage() {
  return [
    'Usage: node scripts/verify-release-version.mjs <tag>',
    '',
    'Options:',
    '  --package-json <path>        Override package.json path for tests',
    '  --compatibility-json <path>  Override release/compatibility.json path for tests',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    tag: undefined,
    packageJsonPath: path.join(REPO_ROOT, 'package.json'),
    compatibilityJsonPath: path.join(REPO_ROOT, 'release', 'compatibility.json'),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--package-json') {
      index += 1;
      if (!argv[index]) {
        throw new Error('--package-json requires a path');
      }
      options.packageJsonPath = path.resolve(argv[index]);
      continue;
    }

    if (arg === '--compatibility-json') {
      index += 1;
      if (!argv[index]) {
        throw new Error('--compatibility-json requires a path');
      }
      options.compatibilityJsonPath = path.resolve(argv[index]);
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options.tag) {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
    options.tag = arg;
  }

  if (!options.tag) {
    throw new Error('Missing release tag');
  }

  return options;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function versionFromTag(tag) {
  const match = /^v(.+)$/.exec(tag);
  if (!match) {
    throw new Error(`Release tag must start with "v": ${tag}`);
  }
  return match[1];
}

function assertVersion(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label} version ${actual} does not match package.json version ${expected}`);
  }
}

function assertStringVersion(label, value, expected) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string version`);
  }
  assertVersion(label, value, expected);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tagVersion = versionFromTag(options.tag);
  const packageJson = await readJson(options.packageJsonPath);
  const compatibility = await readJson(options.compatibilityJsonPath);
  const packageVersion = packageJson.version;

  if (typeof packageVersion !== 'string' || packageVersion.length === 0) {
    throw new Error('package.json version must be a non-empty string');
  }

  if (tagVersion !== packageVersion) {
    throw new Error(`Tag version ${tagVersion} does not match package.json version ${packageVersion}`);
  }

  assertStringVersion('release/compatibility.json core', compatibility.core, packageVersion);
  assertStringVersion('release/compatibility.json cli', compatibility.cli, packageVersion);

  if (!compatibility.skillpacks || typeof compatibility.skillpacks !== 'object') {
    throw new Error('release/compatibility.json skillpacks must be an object');
  }

  for (const [host, version] of Object.entries(compatibility.skillpacks)) {
    assertStringVersion(`release/compatibility.json skillpacks.${host}`, version, packageVersion);
  }

  console.log(`Release version verified: ${packageVersion}`);
}

main().catch((error) => {
  console.error(error.message);
  console.error('');
  console.error(usage());
  process.exitCode = 1;
});
