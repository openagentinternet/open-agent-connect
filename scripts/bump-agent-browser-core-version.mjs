#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
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
  --verify       Run the fast verification chain after the bump: version check, build,
                 Playwright preflight, high-risk Browser/daemon tests, build:skillpacks,
                 and test:fast with a captured log under .codex_tmp/.
  --help         Print this help text.
`;
}

const ABC_HIGH_RISK_TEST_FILES = [
  'tests/ui/browserPageState.test.mjs',
  'tests/ui/browserPageLayout.test.mjs',
  'tests/daemon/oacBrowserHostAdapter.test.mjs',
  'tests/browser/browserModuleBoundary.test.mjs',
];

function parseArgs(argv) {
  const options = {
    version: null,
    rootDir: process.cwd(),
    dryRun: false,
    verify: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      options.rootDir = argv[++index];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--verify') {
      options.verify = true;
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

function runCommand(rootDir, args, options = {}) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd: rootDir,
    stdio: options.stdio ?? 'inherit',
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${args.join(' ')}`);
  }
}

function runVerifyFlow(rootDir, version) {
  const steps = [
    ['version check', ['node', 'scripts/check-agent-browser-core-version.mjs', '--latest', version]],
    ['npm run build', ['npm', 'run', 'build']],
    ['playwright preflight', ['npm', 'run', 'test:setup']],
    [
      'high-risk Browser/daemon tests',
      ['node', '--test', '--test-concurrency=1', ...ABC_HIGH_RISK_TEST_FILES],
    ],
    ['npm run build:skillpacks', ['npm', 'run', 'build:skillpacks']],
  ];

  for (const [label, args] of steps) {
    console.log(`[abc-verify] ${label}`);
    runCommand(rootDir, args);
  }

  const logDir = path.join(rootDir, '.codex_tmp');
  mkdirSync(logDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(logDir, `abc-bump-verify-${version}-${timestamp}.log`);
  console.log(`[abc-verify] npm run test:fast (log: ${logPath})`);
  const result = spawnSync(
    'bash',
    ['-lc', `set -o pipefail; npm run test:fast 2>&1 | tee "${logPath}"`],
    {
      cwd: rootDir,
      stdio: 'inherit',
      env: process.env,
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`npm run test:fast failed with exit code ${result.status}; see ${logPath}`);
  }

  const logText = readFileSync(logPath, 'utf8');
  const passMatch = logText.match(/^# pass ([0-9]+)$/m) ?? logText.match(/^ℹ pass ([0-9]+)$/m);
  const failMatch = logText.match(/^# fail ([0-9]+)$/m) ?? logText.match(/^ℹ fail ([0-9]+)$/m);
  const failedLines = [
    ...(logText.match(/^not ok .*$/gm) ?? []),
    ...(logText.match(/^✖ .*$/gm) ?? []),
  ];
  if (!passMatch || !failMatch || failMatch[1] !== '0' || failedLines.length > 0) {
    for (const line of failedLines.slice(0, 20)) {
      console.error(line);
    }
    throw new Error(`test:fast log does not show a passing run: ${logPath}`);
  }

  console.log(
    `[abc-verify] verification passed: ${ABC_HIGH_RISK_TEST_FILES.length} high-risk test files, build:skillpacks, and test:fast (${passMatch[1]} passed, 0 failed).`,
  );
  console.log(`[abc-verify] log: ${logPath}`);
  return 0;
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
  if (options.verify) {
    console.log('Running fast verification chain (--verify).');
    return runVerifyFlow(options.rootDir, options.version);
  }
  console.log('Next release checks:');
  console.log(`- node scripts/check-agent-browser-core-version.mjs --latest ${options.version}`);
  console.log(`- node scripts/bump-agent-browser-core-version.mjs ${options.version} --verify`);
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
