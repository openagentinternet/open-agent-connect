import { promises as fs } from 'node:fs';
import path from 'node:path';

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

const PROVIDER_SKILL_ROOTS: Record<string, (cwd: string) => string> = {
  'claude-code': (cwd) => path.join(cwd, '.claude', 'skills'),
  codex: (cwd) => path.join(cwd, '.codex', 'skills'),
  openclaw: (cwd) => path.join(cwd, '.openclaw', 'skills'),
};

export function resolveProviderSkillRoot(provider: string, cwd: string): string {
  const resolver = PROVIDER_SKILL_ROOTS[provider];
  if (resolver) return resolver(cwd);
  return path.join(cwd, '.agent_context', 'skills');
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
