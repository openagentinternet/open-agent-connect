import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getRuntimePlatformDefinition, isRuntimePlatformId } from '../../platform/platformRegistry';
import { stringifyError } from './backends/backend';

export interface ProviderExecutionHomePreparation {
  /** Env overrides to apply to the provider process (`<envName>: <home>`). */
  env: Record<string, string>;
  /** Absolute path of the isolated execution home. */
  home: string;
  /** Non-fatal seeding problems, surfaced as log events by the caller. */
  warnings: string[];
}

async function pathExists(target: string): Promise<boolean> {
  try {
    // lstat (not stat) so a dangling symlink still counts as seeded.
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function seedEntry(source: string, target: string, warnings: string[]): Promise<void> {
  let sourceStat;
  try {
    sourceStat = await fs.stat(source);
  } catch {
    // Missing source entries are skipped: seeding is best-effort.
    return;
  }
  if (await pathExists(target)) return;
  await fs.mkdir(path.dirname(target), { recursive: true });
  // Link (not copy) so credential refreshes and config edits in the real home
  // stay visible to managed executions and vice versa. Windows file symlinks
  // need privileges junctions do not have, so fall back to a plain copy.
  try {
    await fs.symlink(source, target, sourceStat.isDirectory() ? 'junction' : 'file');
    return;
  } catch {
    // Fall through to copy.
  }
  try {
    await fs.cp(source, target, { recursive: true, force: false });
  } catch (error) {
    warnings.push(`Failed to seed ${path.basename(target)} into the execution home: ${stringifyError(error)}`);
  }
}

/**
 * Managed executions (bot private-chat replies, surf, dream, scheduled tasks,
 * service orders, ...) run unattended, but CLIs like Kimi Code record every
 * thread in a user-visible session history. For platforms that declare an
 * `executionHome` policy, redirect the CLI's state home to a persistent
 * per-machine directory under the executor root so those sessions never show
 * up in the user's platform UI. The home is seeded with links to the real
 * home's auth/config entries, so the CLI keeps working with the user's
 * credentials and settings.
 *
 * Returns null (no redirection) when:
 * - the provider declares no `executionHome` policy;
 * - the request already sets the policy's env var (explicit caller override).
 *
 * `resumeStateHome` pins the redirection to the home a previous managed
 * session used (recorded on its session record as providerStateHome), so a
 * resumed thread is found where it was written instead of leaking into the
 * user's real platform session history — the exact pollution the redirection
 * exists to prevent.
 */
export async function prepareProviderExecutionHome(input: {
  provider: string;
  homesRoot: string;
  baseEnv?: NodeJS.ProcessEnv;
  requestEnv?: Record<string, string>;
  resumeStateHome?: string;
}): Promise<ProviderExecutionHomePreparation | null> {
  if (!isRuntimePlatformId(input.provider)) return null;
  const policy = getRuntimePlatformDefinition(input.provider).runtime.executionHome;
  if (!policy) return null;
  const callerValue = input.requestEnv?.[policy.envName];
  if (typeof callerValue === 'string' && callerValue.trim()) return null;

  const home = input.resumeStateHome ?? path.join(input.homesRoot, input.provider);
  const baseEnv = input.baseEnv ?? process.env;
  const configuredHome = baseEnv[policy.envName]?.trim();
  const sourceHome = configuredHome
    || (policy.defaultSourceHome ? path.join(os.homedir(), policy.defaultSourceHome) : '');
  await fs.mkdir(home, { recursive: true });

  const warnings: string[] = [];
  if (sourceHome && path.resolve(sourceHome) !== path.resolve(home)) {
    for (const seedPath of policy.seedPaths ?? []) {
      await seedEntry(path.join(sourceHome, seedPath), path.join(home, seedPath), warnings);
    }
  }
  return { env: { [policy.envName]: home }, home, warnings };
}
