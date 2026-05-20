import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  getPlatformSkillRoots,
  getProjectSkillRoot,
  isPlatformId,
  resolvePlatformSkillRootPath,
} from '../../platform/platformRegistry';

export interface SkillInjectorInput {
  skills: string[];
  skillsRoot: string;
  skillSourcePaths?: Record<string, string>;
  provider: string;
  cwd: string;
  systemHomeDir?: string;
  env?: NodeJS.ProcessEnv;
}

export interface SkillInjectionResult {
  injected: string[];
  errors: Array<{ skill: string; error: string }>;
}

const FALLBACK_SKILL_ROOT = path.join('.agent_context', 'skills');

export function resolveProviderSkillRoot(
  provider: string,
  cwd: string,
  options: { systemHomeDir?: string; env?: NodeJS.ProcessEnv } = {},
): string {
  if (isPlatformId(provider)) {
    const projectRoot = getProjectSkillRoot(provider);
    if (projectRoot) return path.resolve(cwd, projectRoot.path);
    const systemHomeDir = normalizeOptionalPath(options.systemHomeDir);
    if (systemHomeDir) {
      const globalRoot = getPlatformSkillRoots(provider).find((root) => root.kind === 'global');
      if (globalRoot) {
        return resolvePlatformSkillRootPath(globalRoot, systemHomeDir, options.env);
      }
    }
  }
  return path.resolve(cwd, FALLBACK_SKILL_ROOT);
}

function assertSafeSkillName(skillName: string): void {
  if (!skillName || skillName.includes('/') || skillName.includes('\\') || skillName.includes('..')) {
    throw new Error(`Unsafe skill name: ${skillName}`);
  }
}

function normalizeOptionalPath(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function findReadableSkillSource(input: SkillInjectorInput, skillName: string): Promise<string> {
  const explicitSource = normalizeOptionalPath(input.skillSourcePaths?.[skillName]);
  const candidates = [
    explicitSource,
    path.join(input.skillsRoot, skillName),
  ].filter(Boolean);

  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(errors[0] ?? `Skill source not found: ${skillName}`);
}

export async function injectSkills(input: SkillInjectorInput): Promise<SkillInjectionResult> {
  const skillRoot = resolveProviderSkillRoot(input.provider, input.cwd, {
    systemHomeDir: input.systemHomeDir,
    env: input.env,
  });
  await fs.mkdir(skillRoot, { recursive: true });

  const injected: string[] = [];
  const errors: Array<{ skill: string; error: string }> = [];

  for (const skillName of input.skills) {
    try {
      assertSafeSkillName(skillName);
      const srcDir = await findReadableSkillSource(input, skillName);
      const dstDir = path.join(skillRoot, skillName);
      if (path.resolve(srcDir) === path.resolve(dstDir)) {
        injected.push(skillName);
        continue;
      }

      try {
        await fs.access(dstDir);
        injected.push(skillName);
        continue;
      } catch {
        // Destination does not exist yet.
      }

      await fs.cp(srcDir, dstDir, { recursive: true });
      injected.push(skillName);
    } catch (error) {
      errors.push({ skill: skillName, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { injected, errors };
}
