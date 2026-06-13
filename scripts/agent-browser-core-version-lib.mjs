import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const AGENT_BROWSER_RUNTIME_PACKAGES = [
  '@openagentinternet/agent-browser-host-contract',
  '@openagentinternet/agent-browser-core',
  '@openagentinternet/agent-browser-ui',
];

export const AGENT_BROWSER_DEV_PACKAGES = [
  '@openagentinternet/agent-browser-test-harness',
];

export const AGENT_BROWSER_PACKAGES = [
  ...AGENT_BROWSER_RUNTIME_PACKAGES.map((name) => ({ name, section: 'dependencies' })),
  ...AGENT_BROWSER_DEV_PACKAGES.map((name) => ({ name, section: 'devDependencies' })),
];

export const DISALLOWED_OAC_BROWSER_PACKAGES = [
  '@openagentinternet/agent-browser-host-standalone',
];

const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function isExactSemverVersion(value) {
  return typeof value === 'string' && EXACT_SEMVER_RE.test(value);
}

export function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function readAgentBrowserPackageState(rootDir) {
  const packageJsonPath = path.join(rootDir, 'package.json');
  const packageLockPath = path.join(rootDir, 'package-lock.json');
  const packageJson = readJsonFile(packageJsonPath);
  const packageLock = readJsonFile(packageLockPath);
  const lockRoot = packageLock.packages?.[''] ?? {};

  const pins = AGENT_BROWSER_PACKAGES.map(({ name, section }) => {
    const packageVersion = packageJson[section]?.[name] ?? null;
    const lockRootVersion = lockRoot[section]?.[name] ?? null;
    const lockPackageVersion = packageLock.packages?.[`node_modules/${name}`]?.version ?? null;
    return { name, section, packageVersion, lockRootVersion, lockPackageVersion };
  });

  const disallowed = DISALLOWED_OAC_BROWSER_PACKAGES.flatMap((name) => {
    const hits = [];
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const version = packageJson[section]?.[name];
      if (version !== undefined) {
        hits.push({ name, section, version });
      }
    }
    return hits;
  });

  return { packageJson, packageLock, pins, disallowed };
}

export function validateAgentBrowserPackageState(state) {
  const errors = [];
  const exactVersions = [];

  for (const pin of state.pins) {
    if (!pin.packageVersion) {
      errors.push(`${pin.name} is missing from package.json ${pin.section}.`);
      continue;
    }
    if (!isExactSemverVersion(pin.packageVersion)) {
      errors.push(`${pin.name} must be an exact semver version, got ${pin.packageVersion}.`);
      continue;
    }
    exactVersions.push(pin.packageVersion);

    if (pin.lockRootVersion !== pin.packageVersion) {
      errors.push(
        `${pin.name} package-lock root ${pin.section} is ${pin.lockRootVersion ?? 'missing'}, expected ${pin.packageVersion}.`,
      );
    }
    if (pin.lockPackageVersion !== pin.packageVersion) {
      errors.push(
        `${pin.name} package-lock node_modules entry is ${pin.lockPackageVersion ?? 'missing'}, expected ${pin.packageVersion}.`,
      );
    }
  }

  const uniqueVersions = [...new Set(exactVersions)];
  if (uniqueVersions.length > 1) {
    errors.push(`Agent Browser packages must share one version, got ${uniqueVersions.join(', ')}.`);
  }

  for (const hit of state.disallowed) {
    errors.push(`${hit.name} must not be installed in OAC ${hit.section}; OAC should consume the UI package, not the standalone host.`);
  }

  return {
    currentVersion: uniqueVersions.length === 1 && errors.length === 0 ? uniqueVersions[0] : null,
    errors,
  };
}

export function shellQuote(value) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function formatShellCommand(command, args) {
  return [command, ...args].map(shellQuote).join(' ');
}

export function readLatestAgentBrowserVersionsFromNpm() {
  const latestVersions = new Map();
  for (const { name } of AGENT_BROWSER_PACKAGES) {
    const stdout = execFileSync('npm', ['view', name, 'version', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const parsed = stdout ? JSON.parse(stdout) : '';
    if (!isExactSemverVersion(parsed)) {
      throw new Error(`npm view ${name} returned an invalid version: ${stdout}`);
    }
    latestVersions.set(name, parsed);
  }
  return latestVersions;
}

export function latestMapFromSingleVersion(version) {
  if (!isExactSemverVersion(version)) {
    throw new Error(`Latest version must be an exact semver version, got ${version}.`);
  }
  return new Map(AGENT_BROWSER_PACKAGES.map(({ name }) => [name, version]));
}

export function summarizeLatestVersionMap(latestVersions) {
  const uniqueVersions = [...new Set([...latestVersions.values()])];
  if (uniqueVersions.length !== 1) {
    throw new Error(
      `Published Agent Browser packages do not share one latest version: ${[...latestVersions.entries()]
        .map(([name, version]) => `${name}=${version}`)
        .join(', ')}.`,
    );
  }
  return uniqueVersions[0];
}
