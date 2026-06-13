#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  latestMapFromSingleVersion,
  readAgentBrowserPackageState,
  readLatestAgentBrowserVersionsFromNpm,
  summarizeLatestVersionMap,
  validateAgentBrowserPackageState,
} from './agent-browser-core-version-lib.mjs';

function usage() {
  return `Usage: node scripts/check-agent-browser-core-version.mjs [options]

Checks that OAC pins the same exact Agent Browser Core package version as npm latest.

Options:
  --root <path>       Repository root to inspect. Defaults to the current working directory.
  --latest <version>  Use this version instead of querying npm. Intended for tests and dry release rehearsal.
  --allow-stale       Exit 0 even when OAC pins are older than npm latest. Use only with a recorded release decision.
  --help              Print this help text.

Environment:
  OAC_ABC_LATEST_VERSION  Same effect as --latest when --latest is omitted.
`;
}

function parseArgs(argv) {
  const options = {
    rootDir: process.cwd(),
    latestOverride: process.env.OAC_ABC_LATEST_VERSION || null,
    allowStale: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      options.rootDir = argv[++index];
    } else if (arg === '--latest') {
      options.latestOverride = argv[++index];
    } else if (arg === '--allow-stale') {
      options.allowStale = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.rootDir) {
    throw new Error('--root requires a path.');
  }
  if (options.latestOverride === undefined) {
    throw new Error('--latest requires a version.');
  }

  options.rootDir = path.resolve(options.rootDir);
  return options;
}

function printPackagePins(state) {
  for (const pin of state.pins) {
    console.log(`- ${pin.name}: ${pin.packageVersion}`);
  }
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const state = readAgentBrowserPackageState(options.rootDir);
  const validation = validateAgentBrowserPackageState(state);
  if (validation.errors.length > 0) {
    console.error('Agent Browser Core package pins are invalid:');
    for (const error of validation.errors) {
      console.error(`- ${error}`);
    }
    return 1;
  }

  const latestVersions = options.latestOverride
    ? latestMapFromSingleVersion(options.latestOverride)
    : readLatestAgentBrowserVersionsFromNpm();
  const latestVersion = summarizeLatestVersionMap(latestVersions);
  const currentVersion = validation.currentVersion;

  if (currentVersion === latestVersion) {
    console.log('Agent Browser Core package pins are up to date.');
    console.log(`current: ${currentVersion}`);
    console.log(`latest: ${latestVersion}`);
    printPackagePins(state);
    return 0;
  }

  const message = [
    `OAC Agent Browser Core package pins do not match the latest Agent Browser Core release.`,
    `current: ${currentVersion}`,
    `latest: ${latestVersion}`,
    '',
    `Run node scripts/bump-agent-browser-core-version.mjs ${latestVersion} before the OAC release,`,
    'or rerun this check with --allow-stale only if releasing with stale Browser packages is intentional and recorded.',
  ].join('\n');

  if (options.allowStale) {
    console.error(message);
    console.error('continuing because --allow-stale was provided.');
    return 0;
  }

  console.error(message);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
