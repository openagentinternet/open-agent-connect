import { promises as fs } from 'node:fs';
import path from 'node:path';
import { commandFailed, commandSuccess, type MetabotCommandResult } from '../contracts/commandResult';
import { bindPlatformSkills, type BoundPlatformSkillRootResult } from '../host/hostSkillBinding';
import { CLI_VERSION } from '../../cli/version';
import { SUPPORTED_PLATFORM_IDS, isPlatformId, resolvePlatformSkillRootPath } from '../platform/platformRegistry';
import { getInstallSkillRoots, getPlatformSkillRoots } from '../platform/platformRegistry';
import type { PlatformId } from '../platform/platformRegistry';

const SUPPORTED_HOSTS: PlatformId[] = [...SUPPORTED_PLATFORM_IDS];

export interface NpmInstallContext {
  env: NodeJS.ProcessEnv;
  cwd: string;
  packageRoot?: string;
}

export interface NpmInstallInput {
  host?: string;
}

export interface NpmInstallResult {
  host?: PlatformId;
  packageRoot: string;
  sharedSkillRoot: string;
  metabotShimPath: string;
  installedSkills: string[];
  boundRoots: BoundPlatformSkillRootResult[];
  skippedRoots: BoundPlatformSkillRootResult[];
  failedRoots: BoundPlatformSkillRootResult[];
  version: string;
  hostSkillRoot?: string;
  boundSkills?: string[];
}

class NpmInstallError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'NpmInstallError';
    this.code = code;
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveSystemHomeDir(env: NodeJS.ProcessEnv): string {
  return path.resolve(normalizeText(env.HOME) || process.env.HOME || process.cwd());
}

function resolvePackageRoot(context: NpmInstallContext): string {
  return path.resolve(context.packageRoot ?? path.join(__dirname, '..', '..', '..'));
}

function resolveRequestedHost(host: string | undefined): PlatformId | undefined {
  const normalized = normalizeText(host);
  if (!normalized) {
    return undefined;
  }
  if (!isPlatformId(normalized)) {
    throw new NpmInstallError(
      'invalid_argument',
      `Unsupported --host value: ${normalized}. Supported values: ${SUPPORTED_HOSTS.join(', ')}.`,
    );
  }
  return normalized;
}

async function listSourceSkills(packageRoot: string): Promise<string[]> {
  const skillsRoot = path.join(packageRoot, 'SKILLs');
  const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('metabot-'))
    .map((entry) => entry.name)
    .sort();
}

function replaceAll(source: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (text, [token, value]) => text.split(token).join(value),
    source,
  );
}

async function renderSharedSkill(packageRoot: string, skillName: string): Promise<string> {
  const source = await fs.readFile(path.join(packageRoot, 'SKILLs', skillName, 'SKILL.md'), 'utf8');
  const systemRouting = await fs.readFile(
    path.join(packageRoot, 'skillpacks', 'common', 'templates', 'system-routing.md'),
    'utf8',
  );
  const confirmationContract = await fs.readFile(
    path.join(packageRoot, 'skillpacks', 'common', 'templates', 'confirmation-contract.md'),
    'utf8',
  );

  return replaceAll(source, {
    '{{METABOT_CLI}}': 'metabot',
    '{{COMPATIBILITY_MANIFEST}}': 'release/compatibility.json',
    '{{HOST_ADAPTER_SECTION}}': '',
    '{{SYSTEM_ROUTING}}': replaceAll(systemRouting, {
      '{{METABOT_CLI}}': 'metabot',
    }),
    '{{CONFIRMATION_CONTRACT}}': replaceAll(confirmationContract, {
      '{{METABOT_CLI}}': 'metabot',
    }),
  });
}

async function copySharedSkills(input: {
  packageRoot: string;
  systemHomeDir: string;
}): Promise<{ sharedSkillRoot: string; installedSkills: string[] }> {
  const sourceRoot = path.join(input.packageRoot, 'SKILLs');
  const sharedSkillRoot = path.join(input.systemHomeDir, '.metabot', 'skills');
  const installedSkills = await listSourceSkills(input.packageRoot);
  await fs.mkdir(sharedSkillRoot, { recursive: true });

  for (const skillName of installedSkills) {
    const targetSkillRoot = path.join(sharedSkillRoot, skillName);
    const sourceSkillRoot = path.join(sourceRoot, skillName);
    await fs.rm(targetSkillRoot, { recursive: true, force: true });
    await fs.mkdir(targetSkillRoot, { recursive: true });
    await fs.cp(sourceSkillRoot, targetSkillRoot, {
      recursive: true,
      filter: (sourcePath) => {
        const segments = path.relative(sourceSkillRoot, sourcePath).split(path.sep);
        return !segments.includes('evals') && path.basename(sourcePath) !== '.DS_Store';
      },
    });
    await fs.writeFile(
      path.join(targetSkillRoot, 'SKILL.md'),
      await renderSharedSkill(input.packageRoot, skillName),
      'utf8',
    );
  }

  return { sharedSkillRoot, installedSkills };
}

function renderNodeResolverShellLines(): string[] {
  return [
    'resolve_node_bin() {',
    '  if [ -n "${METABOT_NODE:-}" ]; then',
    '    if [ -x "$METABOT_NODE" ]; then',
    '      printf \'%s\\n\' "$METABOT_NODE"',
    '      return 0',
    '    fi',
    '    echo "METABOT_NODE is set but is not executable: $METABOT_NODE" >&2',
    '    return 1',
    '  fi',
    '',
    '  for candidate in /opt/homebrew/opt/node@22/bin/node /usr/local/opt/node@22/bin/node /opt/homebrew/bin/node22 /usr/local/bin/node22; do',
    '    if [ -x "$candidate" ]; then',
    '      printf \'%s\\n\' "$candidate"',
    '      return 0',
    '    fi',
    '  done',
    '',
    '  if command -v node >/dev/null 2>&1; then',
    '    candidate="$(command -v node)"',
    '    major="$("$candidate" -p \'Number(process.versions.node.split(".")[0])\' 2>/dev/null || true)"',
    '    if [ -n "$major" ] && [ "$major" -ge 20 ] 2>/dev/null && [ "$major" -lt 25 ] 2>/dev/null; then',
    '      printf \'%s\\n\' "$candidate"',
    '      return 0',
    '    fi',
    '    version="$("$candidate" -v 2>/dev/null || printf unknown)"',
    '    echo "Unsupported Node.js version at $candidate ($version). Open Agent Connect requires Node.js >=20 <25. Install node@22 or set METABOT_NODE." >&2',
    '    return 1',
    '  fi',
    '',
    '  echo "Node.js >=20 <25 is required. Install node@22 or set METABOT_NODE." >&2',
    '  return 1',
    '}',
  ];
}

async function writeMetabotShim(input: {
  packageRoot: string;
  systemHomeDir: string;
}): Promise<string> {
  const binRoot = path.join(input.systemHomeDir, '.metabot', 'bin');
  const metabotShimPath = path.join(binRoot, 'metabot');
  const cliEntry = path.join(input.packageRoot, 'dist', 'cli', 'main.js');
  await fs.mkdir(binRoot, { recursive: true });
  await fs.access(cliEntry);
  await fs.writeFile(
    metabotShimPath,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      ...renderNodeResolverShellLines(),
      'NODE_BIN="$(resolve_node_bin)"',
      `exec "$NODE_BIN" ${JSON.stringify(cliEntry)} "$@"`,
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(metabotShimPath, 0o755);
  return metabotShimPath;
}

async function assertFileExists(filePath: string, code: string, message: string): Promise<void> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      throw new Error('not a file');
    }
  } catch {
    throw new NpmInstallError(code, message);
  }
}

async function verifyRootBindings(input: {
  root: BoundPlatformSkillRootResult;
  sharedSkillRoot: string;
  installedSkills: string[];
  forced: boolean;
}): Promise<BoundPlatformSkillRootResult> {
  const missing: string[] = [];
  const boundSkills: string[] = [];

  for (const skillName of input.installedSkills) {
    const hostSkillPath = path.join(input.root.hostSkillRoot, skillName);
    const sharedSkillPath = path.join(input.sharedSkillRoot, skillName);
    try {
      const stat = await fs.lstat(hostSkillPath);
      if (!stat.isSymbolicLink()) {
        missing.push(skillName);
        continue;
      }
      const target = await fs.readlink(hostSkillPath);
      if (path.resolve(path.dirname(hostSkillPath), target) !== sharedSkillPath) {
        missing.push(skillName);
        continue;
      }
      boundSkills.push(skillName);
    } catch {
      missing.push(skillName);
    }
  }

  if (missing.length > 0 && input.forced) {
    throw new NpmInstallError(
      'doctor_host_bindings_missing',
      `Missing host bindings for ${missing.join(', ')} under ${input.root.hostSkillRoot}. Run oac install --host <${SUPPORTED_HOSTS.join('|')}>.`,
    );
  }

  if (missing.length > 0) {
    return { ...input.root, status: 'skipped', reason: 'bindings_missing', boundSkills: [] };
  }

  return { ...input.root, status: 'bound', boundSkills };
}

async function parentExists(hostSkillRoot: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.dirname(hostSkillRoot));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function expectedDoctorRoots(input: {
  host?: PlatformId;
  systemHomeDir: string;
  env: NodeJS.ProcessEnv;
}): Promise<BoundPlatformSkillRootResult[]> {
  const roots = input.host
    ? getPlatformSkillRoots(input.host)
      .filter((root) => root.kind === 'global')
      .map((root) => ({ ...root, platformId: input.host as PlatformId }))
    : getInstallSkillRoots();

  const results: BoundPlatformSkillRootResult[] = [];
  for (const root of roots) {
    const hostSkillRoot = resolvePlatformSkillRootPath(root, input.systemHomeDir, input.env);
    if (!input.host && root.autoBind === 'when-parent-exists' && !(await parentExists(hostSkillRoot))) {
      results.push({
        platformId: root.platformId,
        rootId: root.id,
        hostSkillRoot,
        status: 'skipped',
        reason: 'parent_missing',
        boundSkills: [],
        replacedEntries: [],
        unchangedEntries: [],
      });
      continue;
    }
    results.push({
      platformId: root.platformId,
      rootId: root.id,
      hostSkillRoot,
      status: 'bound',
      boundSkills: [],
      replacedEntries: [],
      unchangedEntries: [],
    });
  }
  return results;
}

async function verifyInstalledState(input: {
  host?: PlatformId;
  packageRoot: string;
  systemHomeDir: string;
  env: NodeJS.ProcessEnv;
}): Promise<NpmInstallResult> {
  const installedSkills = await listSourceSkills(input.packageRoot);
  const sharedSkillRoot = path.join(input.systemHomeDir, '.metabot', 'skills');
  const metabotShimPath = path.join(input.systemHomeDir, '.metabot', 'bin', 'metabot');

  for (const skillName of installedSkills) {
    await assertFileExists(
      path.join(sharedSkillRoot, skillName, 'SKILL.md'),
      'doctor_shared_skills_missing',
      `Missing shared skill ${skillName} under ${sharedSkillRoot}. Run oac install.`,
    );
  }

  await assertFileExists(
    metabotShimPath,
    'doctor_metabot_shim_missing',
    `Missing metabot shim at ${metabotShimPath}. Run oac install.`,
  );

  const roots = await expectedDoctorRoots({
    host: input.host,
    systemHomeDir: input.systemHomeDir,
    env: input.env,
  });
  const verifiedRoots: BoundPlatformSkillRootResult[] = [];
  for (const root of roots) {
    if (root.status === 'skipped') {
      verifiedRoots.push(root);
      continue;
    }
    verifiedRoots.push(await verifyRootBindings({
      root,
      sharedSkillRoot,
      installedSkills,
      forced: Boolean(input.host) || root.platformId === 'shared-agents',
    }));
  }

  const boundRoots = verifiedRoots.filter((root) => root.status === 'bound');
  const skippedRoots = verifiedRoots.filter((root) => root.status === 'skipped');
  const hostPrimaryRoot = input.host ? boundRoots.find((root) => root.platformId === input.host) : undefined;

  return {
    host: input.host,
    packageRoot: input.packageRoot,
    sharedSkillRoot,
    metabotShimPath,
    installedSkills,
    boundRoots,
    skippedRoots,
    failedRoots: [],
    hostSkillRoot: hostPrimaryRoot?.hostSkillRoot,
    boundSkills: hostPrimaryRoot?.boundSkills,
    version: CLI_VERSION,
  };
}

function splitRootResults(results: BoundPlatformSkillRootResult[]): {
  boundRoots: BoundPlatformSkillRootResult[];
  skippedRoots: BoundPlatformSkillRootResult[];
  failedRoots: BoundPlatformSkillRootResult[];
} {
  return {
    boundRoots: results.filter((root) => root.status === 'bound'),
    skippedRoots: results.filter((root) => root.status === 'skipped'),
    failedRoots: results.filter((root) => root.status === 'failed'),
  };
}

export async function runNpmInstall(
  input: NpmInstallInput,
  context: NpmInstallContext,
): Promise<MetabotCommandResult<NpmInstallResult>> {
  try {
    const host = resolveRequestedHost(input.host);
    const systemHomeDir = resolveSystemHomeDir(context.env);
    const packageRoot = resolvePackageRoot(context);
    const { sharedSkillRoot, installedSkills } = await copySharedSkills({
      packageRoot,
      systemHomeDir,
    });
    const metabotShimPath = await writeMetabotShim({
      packageRoot,
      systemHomeDir,
    });
    const results = await bindPlatformSkills({
      systemHomeDir,
      host,
      env: context.env,
      mode: host ? 'force-platform' : 'auto',
    });
    const split = splitRootResults(results);
    const hostPrimaryRoot = host ? split.boundRoots.find((root) => root.platformId === host) : undefined;

    return commandSuccess({
      host,
      packageRoot,
      sharedSkillRoot,
      metabotShimPath,
      installedSkills,
      ...split,
      hostSkillRoot: hostPrimaryRoot?.hostSkillRoot,
      boundSkills: hostPrimaryRoot?.boundSkills,
      version: CLI_VERSION,
    });
  } catch (error) {
    return commandFailed(
      error instanceof NpmInstallError ? error.code : 'install_failed',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function runNpmDoctor(
  input: NpmInstallInput,
  context: NpmInstallContext,
): Promise<MetabotCommandResult<NpmInstallResult>> {
  try {
    const host = resolveRequestedHost(input.host);
    const systemHomeDir = resolveSystemHomeDir(context.env);
    const packageRoot = resolvePackageRoot(context);
    return commandSuccess(await verifyInstalledState({
      host,
      packageRoot,
      systemHomeDir,
      env: context.env,
    }));
  } catch (error) {
    return commandFailed(
      error instanceof NpmInstallError ? error.code : 'doctor_failed',
      error instanceof Error ? error.message : String(error),
    );
  }
}
