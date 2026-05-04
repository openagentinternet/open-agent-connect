import { promises as fs } from 'node:fs';
import path from 'node:path';
import { commandFailed, commandSuccess, type MetabotCommandResult } from '../contracts/commandResult';
import { bindHostSkills } from '../host/hostSkillBinding';
import type { ConcreteSkillHost } from '../skills/skillContractTypes';
import { CLI_VERSION } from '../../cli/version';

const SUPPORTED_HOSTS: ConcreteSkillHost[] = ['codex', 'claude-code', 'openclaw'];

export interface NpmInstallContext {
  env: NodeJS.ProcessEnv;
  cwd: string;
  packageRoot?: string;
}

export interface NpmInstallInput {
  host?: string;
}

export interface NpmInstallResult {
  host: ConcreteSkillHost;
  packageRoot: string;
  sharedSkillRoot: string;
  metabotShimPath: string;
  installedSkills: string[];
  hostSkillRoot: string;
  boundSkills: string[];
  version: string;
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

function isSupportedHost(value: string): value is ConcreteSkillHost {
  return SUPPORTED_HOSTS.includes(value as ConcreteSkillHost);
}

function resolveRequestedHost(host: string | undefined): ConcreteSkillHost | null {
  const normalized = normalizeText(host);
  if (!normalized) {
    return null;
  }
  if (!isSupportedHost(normalized)) {
    throw new NpmInstallError(
      'invalid_argument',
      `Unsupported --host value: ${normalized}. Supported values: ${SUPPORTED_HOSTS.join(', ')}.`,
    );
  }
  return normalized;
}

function hostSignalPresent(env: NodeJS.ProcessEnv, host: ConcreteSkillHost): boolean {
  switch (host) {
    case 'codex':
      return Boolean(normalizeText(env.CODEX_HOME));
    case 'claude-code':
      return Boolean(normalizeText(env.CLAUDE_HOME));
    case 'openclaw':
      return Boolean(normalizeText(env.OPENCLAW_HOME));
  }
}

function detectHost(env: NodeJS.ProcessEnv): ConcreteSkillHost {
  const detected = SUPPORTED_HOSTS.filter((host) => hostSignalPresent(env, host));
  if (detected.length === 1) {
    return detected[0];
  }
  if (detected.length > 1) {
    throw new NpmInstallError(
      'install_host_ambiguous',
      `Multiple host environments detected: ${detected.join(', ')}. Rerun with --host <codex|claude-code|openclaw>.`,
    );
  }
  return 'codex';
}

function resolveHost(input: NpmInstallInput, env: NodeJS.ProcessEnv): ConcreteSkillHost {
  return resolveRequestedHost(input.host) ?? detectHost(env);
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
      `exec node ${JSON.stringify(cliEntry)} "$@"`,
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(metabotShimPath, 0o755);
  return metabotShimPath;
}

function resolveHostHomeDir(systemHomeDir: string, host: ConcreteSkillHost, env: NodeJS.ProcessEnv): string {
  switch (host) {
    case 'codex':
      return path.resolve(normalizeText(env.CODEX_HOME) || path.join(systemHomeDir, '.codex'));
    case 'claude-code':
      return path.resolve(normalizeText(env.CLAUDE_HOME) || path.join(systemHomeDir, '.claude'));
    case 'openclaw':
      return path.resolve(normalizeText(env.OPENCLAW_HOME) || path.join(systemHomeDir, '.openclaw'));
  }
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

async function verifyHostBindings(input: {
  hostSkillRoot: string;
  sharedSkillRoot: string;
  installedSkills: string[];
}): Promise<string[]> {
  const missing: string[] = [];
  const boundSkills: string[] = [];

  for (const skillName of input.installedSkills) {
    const hostSkillPath = path.join(input.hostSkillRoot, skillName);
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

  if (missing.length > 0) {
    throw new NpmInstallError(
      'doctor_host_bindings_missing',
      `Missing host bindings for ${missing.join(', ')} under ${input.hostSkillRoot}. Run oac install --host <codex|claude-code|openclaw>.`,
    );
  }

  return boundSkills;
}

async function verifyInstalledState(input: {
  host: ConcreteSkillHost;
  packageRoot: string;
  systemHomeDir: string;
  env: NodeJS.ProcessEnv;
}): Promise<NpmInstallResult> {
  const installedSkills = await listSourceSkills(input.packageRoot);
  const sharedSkillRoot = path.join(input.systemHomeDir, '.metabot', 'skills');
  const metabotShimPath = path.join(input.systemHomeDir, '.metabot', 'bin', 'metabot');
  const hostSkillRoot = path.join(
    resolveHostHomeDir(input.systemHomeDir, input.host, input.env),
    'skills',
  );

  for (const skillName of installedSkills) {
    await assertFileExists(
      path.join(sharedSkillRoot, skillName, 'SKILL.md'),
      'doctor_shared_skills_missing',
      `Missing shared skill ${skillName} under ${sharedSkillRoot}. Run oac install --host <codex|claude-code|openclaw>.`,
    );
  }

  await assertFileExists(
    metabotShimPath,
    'doctor_metabot_shim_missing',
    `Missing metabot shim at ${metabotShimPath}. Run oac install --host <codex|claude-code|openclaw>.`,
  );

  const boundSkills = await verifyHostBindings({
    hostSkillRoot,
    sharedSkillRoot,
    installedSkills,
  });

  return {
    host: input.host,
    packageRoot: input.packageRoot,
    sharedSkillRoot,
    metabotShimPath,
    installedSkills,
    hostSkillRoot,
    boundSkills,
    version: CLI_VERSION,
  };
}

export async function runNpmInstall(
  input: NpmInstallInput,
  context: NpmInstallContext,
): Promise<MetabotCommandResult<NpmInstallResult>> {
  try {
    const host = resolveHost(input, context.env);
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
    const binding = await bindHostSkills({
      systemHomeDir,
      host,
      env: context.env,
    });

    return commandSuccess({
      host,
      packageRoot,
      sharedSkillRoot,
      metabotShimPath,
      installedSkills,
      hostSkillRoot: binding.hostSkillRoot,
      boundSkills: binding.boundSkills,
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
    const host = resolveHost(input, context.env);
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
