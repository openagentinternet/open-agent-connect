#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENT_BROWSER_DEV_PACKAGES,
  AGENT_BROWSER_RUNTIME_PACKAGES,
  formatShellCommand,
  isExactSemverVersion,
  readAgentBrowserPackageState,
  validateAgentBrowserPackageState,
} from './agent-browser-core-version-lib.mjs';

function usage() {
  return `Usage: node scripts/bump-agent-browser-core-version.mjs <version> [options]

Explicitly bumps OAC's pinned Agent Browser Core package set.

Options:
  --root <path>  Repository root to mutate. Defaults to the current working directory.
  --dry-run      Print the npm commands without mutating package.json or package-lock.json.
  --help         Print this help text.
`;
}

function parseArgs(argv) {
  const options = {
    version: null,
    rootDir: process.cwd(),
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      options.rootDir = argv[++index];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (!arg.startsWith('-') && !options.version) {
      options.version = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.help) {
    return options;
  }
  if (!options.version) {
    throw new Error('A target Agent Browser Core version is required.');
  }
  if (!isExactSemverVersion(options.version)) {
    throw new Error(`Target version must be an exact semver version, got ${options.version}.`);
  }
  if (!options.rootDir) {
    throw new Error('--root requires a path.');
  }

  options.rootDir = path.resolve(options.rootDir);
  return options;
}

function packageSpecs(packageNames, version) {
  return packageNames.map((packageName) => `${packageName}@${version}`);
}

function runNpmInstall(rootDir, args) {
  const result = spawnSync('npm', args, {
    cwd: rootDir,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed with exit code ${result.status}.`);
  }
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const runtimeArgs = [
    'install',
    '--save-exact',
    ...packageSpecs(AGENT_BROWSER_RUNTIME_PACKAGES, options.version),
  ];
  const devArgs = [
    'install',
    '--save-dev',
    '--save-exact',
    ...packageSpecs(AGENT_BROWSER_DEV_PACKAGES, options.version),
  ];

  if (options.dryRun) {
    console.log(formatShellCommand('npm', runtimeArgs));
    console.log(formatShellCommand('npm', devArgs));
    return 0;
  }

  runNpmInstall(options.rootDir, runtimeArgs);
  runNpmInstall(options.rootDir, devArgs);

  const state = readAgentBrowserPackageState(options.rootDir);
  const validation = validateAgentBrowserPackageState(state);
  if (validation.errors.length > 0 || validation.currentVersion !== options.version) {
    console.error('Agent Browser Core package bump did not produce a valid OAC pin set:');
    for (const error of validation.errors) {
      console.error(`- ${error}`);
    }
    console.error(`expected: ${options.version}`);
    console.error(`actual: ${validation.currentVersion ?? 'invalid'}`);
    return 1;
  }

  console.log(`Agent Browser Core packages pinned to ${options.version}.`);
  console.log('Next release checks:');
  console.log(`- node scripts/check-agent-browser-core-version.mjs --latest ${options.version}`);
  console.log('- npm run build');
  console.log('- npm test');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
