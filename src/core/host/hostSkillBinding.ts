import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ConcreteSkillHost } from '../skills/skillContractTypes';

export interface BindHostSkillsInput {
  systemHomeDir: string;
  host: ConcreteSkillHost;
  env?: NodeJS.ProcessEnv;
}

export interface BoundHostSkillsResult {
  host: ConcreteSkillHost;
  hostSkillRoot: string;
  sharedSkillRoot: string;
  boundSkills: string[];
  replacedEntries: string[];
  unchangedEntries: string[];
}

export class HostSkillBindingError extends Error {
  code: 'shared_skills_missing' | 'host_skill_root_unresolved' | 'host_skill_bind_failed';
  data: Record<string, unknown>;

  constructor(
    code: 'shared_skills_missing' | 'host_skill_root_unresolved' | 'host_skill_bind_failed',
    message: string,
    data: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HostSkillBindingError';
    this.code = code;
    this.data = data;
  }
}

function normalizeOptionalEnvPath(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveHostHomeDir(systemHomeDir: string, host: ConcreteSkillHost, env: NodeJS.ProcessEnv = {}): string {
  switch (host) {
    case 'codex':
      return path.resolve(normalizeOptionalEnvPath(env.CODEX_HOME) || path.join(systemHomeDir, '.codex'));
    case 'claude-code':
      return path.resolve(normalizeOptionalEnvPath(env.CLAUDE_HOME) || path.join(systemHomeDir, '.claude'));
    case 'openclaw':
      return path.resolve(normalizeOptionalEnvPath(env.OPENCLAW_HOME) || path.join(systemHomeDir, '.openclaw'));
  }
}

function toRelativeSymlinkTarget(destinationPath: string, sourcePath: string): string {
  return path.relative(path.dirname(destinationPath), sourcePath) || '.';
}

async function ensureHostSkillRoot(host: ConcreteSkillHost, hostSkillRoot: string): Promise<void> {
  try {
    await fs.mkdir(hostSkillRoot, { recursive: true });
    const stat = await fs.stat(hostSkillRoot);
    if (!stat.isDirectory()) {
      throw new Error('Resolved host skill root is not a directory.');
    }
  } catch (error) {
    throw new HostSkillBindingError(
      'host_skill_root_unresolved',
      `Unable to resolve the ${host} host skill root: ${hostSkillRoot}`,
      {
        host,
        hostSkillRoot,
        reason: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

async function listSharedMetabotSkills(sharedSkillRoot: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(sharedSkillRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('metabot-'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return [];
    }
    throw new HostSkillBindingError(
      'host_skill_bind_failed',
      `Unable to list shared MetaBot skills under ${sharedSkillRoot}.`,
      {
        sharedSkillRoot,
        failedPath: sharedSkillRoot,
        reason: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

type ExistingDestination =
  | { kind: 'missing' }
  | { kind: 'symlink'; resolvedTarget: string }
  | { kind: 'directory' }
  | { kind: 'other' };

async function inspectDestinationHostPath(input: {
  skillName: string;
  sourceSharedSkillPath: string;
  destinationHostPath: string;
}): Promise<ExistingDestination> {
  const { skillName, sourceSharedSkillPath, destinationHostPath } = input;
  try {
    const existing = await fs.lstat(destinationHostPath);
    if (existing.isSymbolicLink()) {
      try {
        const target = await fs.readlink(destinationHostPath);
        return {
          kind: 'symlink',
          resolvedTarget: path.resolve(path.dirname(destinationHostPath), target),
        };
      } catch (error) {
        throw new HostSkillBindingError(
          'host_skill_bind_failed',
          `Unable to inspect destination host skill path for ${skillName}.`,
          {
            sourceSharedSkillPath,
            destinationHostPath,
            reason: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
    if (existing.isDirectory()) {
      return { kind: 'directory' };
    }
    return { kind: 'other' };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { kind: 'missing' };
    }
    if (error instanceof HostSkillBindingError) {
      throw error;
    }
    throw new HostSkillBindingError(
      'host_skill_bind_failed',
      `Unable to inspect destination host skill path for ${skillName}.`,
      {
        sourceSharedSkillPath,
        destinationHostPath,
        reason: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

async function preflightDestinationHostPath(input: {
  skillName: string;
  sourceSharedSkillPath: string;
  destinationHostPath: string;
  existingDestination: ExistingDestination;
}): Promise<void> {
  const {
    skillName,
    sourceSharedSkillPath,
    destinationHostPath,
    existingDestination,
  } = input;

  if (existingDestination.kind === 'other') {
    throw new HostSkillBindingError(
      'host_skill_bind_failed',
      `Unable to bind ${skillName} because the destination host path is not replaceable.`,
      {
        sourceSharedSkillPath,
        destinationHostPath,
      },
    );
  }
}

async function bindOneSkill(input: {
  skillName: string;
  sourceSharedSkillPath: string;
  destinationHostPath: string;
  replacedEntries: string[];
  unchangedEntries: string[];
  existingDestination: ExistingDestination;
}): Promise<void> {
  const {
    skillName,
    sourceSharedSkillPath,
    destinationHostPath,
    replacedEntries,
    unchangedEntries,
    existingDestination,
  } = input;

  if (existingDestination.kind === 'symlink') {
    try {
      if (existingDestination.resolvedTarget === sourceSharedSkillPath) {
        unchangedEntries.push(skillName);
        return;
      }
      await fs.unlink(destinationHostPath);
      replacedEntries.push(skillName);
    } catch (error) {
      throw new HostSkillBindingError(
        'host_skill_bind_failed',
        `Unable to refresh host symlink for ${skillName}.`,
        {
          sourceSharedSkillPath,
          destinationHostPath,
          reason: error instanceof Error ? error.message : String(error),
        },
      );
    }
  } else if (existingDestination.kind === 'directory') {
    try {
      await fs.rm(destinationHostPath, { recursive: true, force: true });
      replacedEntries.push(skillName);
    } catch (error) {
      throw new HostSkillBindingError(
        'host_skill_bind_failed',
        `Unable to replace copied host skill directory for ${skillName}.`,
        {
          sourceSharedSkillPath,
          destinationHostPath,
          reason: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  try {
    await fs.symlink(
      toRelativeSymlinkTarget(destinationHostPath, sourceSharedSkillPath),
      destinationHostPath,
      'dir',
    );
  } catch (error) {
    throw new HostSkillBindingError(
      'host_skill_bind_failed',
      `Unable to bind ${skillName} into the host skill root.`,
      {
        sourceSharedSkillPath,
        destinationHostPath,
        reason: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

export async function bindHostSkills(input: BindHostSkillsInput): Promise<BoundHostSkillsResult> {
  const systemHomeDir = path.resolve(input.systemHomeDir);
  const sharedSkillRoot = path.join(systemHomeDir, '.metabot', 'skills');
  const boundSkills = await listSharedMetabotSkills(sharedSkillRoot);
  if (boundSkills.length === 0) {
    throw new HostSkillBindingError(
      'shared_skills_missing',
      `No shared metabot-* skills were found under ${sharedSkillRoot}.`,
      {
        sharedSkillRoot,
      },
    );
  }

  const hostSkillRoot = path.join(resolveHostHomeDir(systemHomeDir, input.host, input.env), 'skills');
  await ensureHostSkillRoot(input.host, hostSkillRoot);

  const bindingPlan = await Promise.all(boundSkills.map(async (skillName) => {
    const sourceSharedSkillPath = path.join(sharedSkillRoot, skillName);
    const destinationHostPath = path.join(hostSkillRoot, skillName);
    const existingDestination = await inspectDestinationHostPath({
      skillName,
      sourceSharedSkillPath,
      destinationHostPath,
    });
    await preflightDestinationHostPath({
      skillName,
      sourceSharedSkillPath,
      destinationHostPath,
      existingDestination,
    });
    return {
      skillName,
      sourceSharedSkillPath,
      destinationHostPath,
      existingDestination,
    };
  }));

  const replacedEntries: string[] = [];
  const unchangedEntries: string[] = [];
  for (const plan of bindingPlan) {
    await bindOneSkill({
      skillName: plan.skillName,
      sourceSharedSkillPath: plan.sourceSharedSkillPath,
      destinationHostPath: plan.destinationHostPath,
      replacedEntries,
      unchangedEntries,
      existingDestination: plan.existingDestination,
    });
  }

  return {
    host: input.host,
    hostSkillRoot,
    sharedSkillRoot,
    boundSkills,
    replacedEntries,
    unchangedEntries,
  };
}
