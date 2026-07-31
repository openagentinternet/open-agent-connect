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

// Cheap change detection for one skill directory: a sorted listing of
// "relativePath:mtime:size" entries for every file in the tree. Copies are
// made with preserveTimestamps, so an unchanged source fingerprints
// identically to its injected copy and each turn only pays a stat pass.
// mtimes are compared at whole-millisecond precision because fs.cp restores
// timestamps through Date values, which round sub-millisecond fractions to
// the nearest millisecond; rounding both sides keeps an unchanged copy
// fingerprint-identical to its source.
// Content hashing would also catch mtime-preserving external edits, but it
// costs a full read of every file on every chat turn, which is not worth it
// for docs-plus-scripts skill trees.
async function fingerprintSkillTree(rootDir: string): Promise<string | null> {
  const parts: string[] = [];
  const walk = async (relativeDir: string): Promise<void> => {
    const entries = await fs.readdir(path.join(rootDir, relativeDir), { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        await walk(relativePath);
        continue;
      }
      const stat = await fs.stat(path.join(rootDir, relativePath)).catch(() => null);
      if (stat?.isFile()) {
        parts.push(`${relativePath}:${Math.round(stat.mtimeMs)}:${stat.size}`);
      }
    }
  };
  try {
    await walk('');
  } catch {
    return null;
  }
  return parts.sort().join('\n');
}

// Swap a skill directory without ever exposing a half-copied tree under its
// real name: copy into a dot-prefixed sibling, move any previous copy aside,
// put the new one in place, then drop the old copy. A crash can leave
// dot-prefixed temp dirs behind (skill discovery ignores them), but never a
// partially written skill.
async function replaceSkillDir(srcDir: string, dstDir: string): Promise<void> {
  const parentDir = path.dirname(dstDir);
  const stamp = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const incomingDir = path.join(parentDir, `.${path.basename(dstDir)}.incoming-${stamp}`);
  const replacedDir = path.join(parentDir, `.${path.basename(dstDir)}.replaced-${stamp}`);
  await fs.cp(srcDir, incomingDir, { recursive: true, preserveTimestamps: true });
  let movedAside = false;
  try {
    await fs.rename(dstDir, replacedDir);
    movedAside = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      await fs.rm(incomingDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }
  try {
    await fs.rename(incomingDir, dstDir);
  } catch (error) {
    if (movedAside) {
      await fs.rename(replacedDir, dstDir).catch(() => undefined);
    }
    await fs.rm(incomingDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  if (movedAside) {
    await fs.rm(replacedDir, { recursive: true, force: true }).catch(() => undefined);
  }
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

      // Refresh-on-change: an existing destination is reused only while its
      // fingerprint still matches the source, so skill updates reach the
      // persistent chat workspace and cached strict-isolation scopes instead
      // of serving a stale copy forever.
      const [srcFingerprint, dstFingerprint] = await Promise.all([
        fingerprintSkillTree(srcDir),
        fingerprintSkillTree(dstDir),
      ]);
      if (srcFingerprint !== null && srcFingerprint === dstFingerprint) {
        injected.push(skillName);
        continue;
      }

      await replaceSkillDir(srcDir, dstDir);
      injected.push(skillName);
    } catch (error) {
      errors.push({ skill: skillName, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { injected, errors };
}
