import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getProjectSkillRoot, isPlatformId } from '../../platform/platformRegistry';

export interface SkillInjectorInput {
  skills: string[];
  skillsRoot: string;
  provider: string;
  cwd: string;
}

export interface SkillInjectionResult {
  injected: string[];
  errors: Array<{ skill: string; error: string }>;
}

const FALLBACK_SKILL_ROOT = path.join('.agent_context', 'skills');

export function resolveProviderSkillRoot(provider: string, cwd: string): string {
  if (isPlatformId(provider)) {
    const projectRoot = getProjectSkillRoot(provider);
    if (projectRoot) return path.resolve(cwd, projectRoot.path);
  }
  return path.resolve(cwd, FALLBACK_SKILL_ROOT);
}

function assertSafeSkillName(skillName: string): void {
  if (!skillName || skillName.includes('/') || skillName.includes('\\') || skillName.includes('..')) {
    throw new Error(`Unsafe skill name: ${skillName}`);
  }
}

export async function injectSkills(input: SkillInjectorInput): Promise<SkillInjectionResult> {
  const skillRoot = resolveProviderSkillRoot(input.provider, input.cwd);
  await fs.mkdir(skillRoot, { recursive: true });

  const injected: string[] = [];
  const errors: Array<{ skill: string; error: string }> = [];

  for (const skillName of input.skills) {
    try {
      assertSafeSkillName(skillName);
      const srcDir = path.join(input.skillsRoot, skillName);
      const dstDir = path.join(skillRoot, skillName);
      await fs.access(srcDir);

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
