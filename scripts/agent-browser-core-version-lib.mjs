import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const AGENT_BROWSER_RUNTIME_PACKAGES = [
  '@openagentinternet/agent-browser-host-contract',
  '@openagentinternet/agent-browser-core',
  '@openagentinternet/agent-browser-name-resolvers',
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

function stripYamlQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
    || (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

// Minimal reader for the root importer of pnpm-lock.yaml (lockfileVersion 9).
// Returns section -> Map(package name -> { specifier, version }). Resolved
// versions may carry a peer-dependency suffix like `1.2.3(foo@4.5.6)`; the
// suffix is stripped because OAC pins exact versions for these packages.
export function readPnpmLockImporters(rootDir) {
  const lockPath = path.join(rootDir, 'pnpm-lock.yaml');
  const lines = readFileSync(lockPath, 'utf8').split('\n');
  const importersStart = lines.findIndex((line) => line === 'importers:');
  if (importersStart === -1) {
    throw new Error(`Missing importers section in ${lockPath}.`);
  }
  const sections = {
    dependencies: new Map(),
    devDependencies: new Map(),
    optionalDependencies: new Map(),
  };
  let currentSection = null;
  let currentPackage = null;
  for (let index = importersStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && !line.startsWith(' ')) {
      break; // The next top-level key ends the importers block.
    }
    const sectionMatch = line.match(/^ {4}(dependencies|devDependencies|optionalDependencies):$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      currentPackage = null;
      continue;
    }
    const packageMatch = line.match(/^ {6}'?([^':]+)'?:$/);
    if (packageMatch && currentSection) {
      currentPackage = stripYamlQuotes(packageMatch[1]);
      continue;
    }
    const fieldMatch = line.match(/^ {8}(specifier|version): (.+)$/);
    if (fieldMatch && currentPackage && currentSection) {
      const entry = sections[currentSection].get(currentPackage) ?? {};
      entry[fieldMatch[1]] = stripYamlQuotes(fieldMatch[2]).split('(')[0];
      sections[currentSection].set(currentPackage, entry);
    }
  }
  return sections;
}

export function readAgentBrowserPackageState(rootDir) {
  const packageJsonPath = path.join(rootDir, 'package.json');
  const packageJson = readJsonFile(packageJsonPath);
  const lockImporters = readPnpmLockImporters(rootDir);

  const pins = AGENT_BROWSER_PACKAGES.map(({ name, section }) => {
    const packageVersion = packageJson[section]?.[name] ?? null;
    const lockEntry = lockImporters[section]?.get(name) ?? null;
    return {
      name,
      section,
      packageVersion,
      lockSpecifier: lockEntry?.specifier ?? null,
      lockVersion: lockEntry?.version ?? null,
    };
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

  return { packageJson, pins, disallowed };
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

    if (pin.lockSpecifier !== pin.packageVersion) {
      errors.push(
        `${pin.name} pnpm-lock importer specifier is ${pin.lockSpecifier ?? 'missing'}, expected ${pin.packageVersion}.`,
      );
    }
    if (pin.lockVersion !== pin.packageVersion) {
      errors.push(
        `${pin.name} pnpm-lock resolved version is ${pin.lockVersion ?? 'missing'}, expected ${pin.packageVersion}.`,
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
