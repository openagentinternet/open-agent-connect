import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  SystemCommandError,
  type SystemUninstallInput,
  type SystemUninstallResult,
} from './types';

const FULL_ERASE_TOKEN = 'DELETE_OPEN_AGENT_CONNECT_IDENTITY_AND_SECRETS';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT');
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

function resolveBuiltInHostRoots(systemHomeDir: string, env: NodeJS.ProcessEnv): string[] {
  const codexHome = normalizeText(env.CODEX_HOME) || path.join(systemHomeDir, '.codex');
  const claudeHome = normalizeText(env.CLAUDE_HOME) || path.join(systemHomeDir, '.claude');
  const openclawHome = normalizeText(env.OPENCLAW_HOME) || path.join(systemHomeDir, '.openclaw');
  return [
    path.join(codexHome, 'skills'),
    path.join(claudeHome, 'skills'),
    path.join(openclawHome, 'skills'),
  ];
}

async function removeGuardedHostSymlinks(hostSkillRoot: string): Promise<string[]> {
  try {
    const dirents = await fs.readdir(hostSkillRoot, { withFileTypes: true });
    const removed: string[] = [];
    for (const entry of dirents) {
      if (!entry.isSymbolicLink() || !entry.name.startsWith('metabot-')) {
        continue;
      }
      const linkPath = path.join(hostSkillRoot, entry.name);
      let target = '';
      try {
        target = await fs.readlink(linkPath);
      } catch {
        continue;
      }
      if (!target.includes('.metabot/skills/metabot-')) {
        continue;
      }
      await fs.rm(linkPath, { force: true });
      removed.push(linkPath);
    }
    return removed;
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

async function stopDaemonBestEffort(systemHomeDir: string): Promise<{ attempted: boolean; stopped: boolean }> {
  const activeHomePath = path.join(systemHomeDir, '.metabot', 'manager', 'active-home.json');
  const activeState = await readJsonFile(activeHomePath);
  const activeHomeDir = normalizeText(activeState?.homeDir);
  if (!activeHomeDir) {
    return { attempted: false, stopped: false };
  }

  const daemonStatePath = path.join(activeHomeDir, '.runtime', 'daemon.json');
  const daemonState = await readJsonFile(daemonStatePath);
  const pid = Number(daemonState?.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    return { attempted: false, stopped: false };
  }

  try {
    process.kill(pid, 'SIGTERM');
    return { attempted: true, stopped: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') {
      return { attempted: true, stopped: false };
    }
    return { attempted: true, stopped: false };
  }
}

async function removeLegacyShimIfRecognized(systemHomeDir: string): Promise<boolean> {
  const legacyShimPath = path.join(systemHomeDir, '.agent-connect', 'bin', 'metabot');
  try {
    const body = await fs.readFile(legacyShimPath, 'utf8');
    if (!body.includes('Canonical MetaBot CLI shim')) {
      return false;
    }
    await fs.rm(legacyShimPath, { force: true });
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

async function runTier1Uninstall(systemHomeDir: string, env: NodeJS.ProcessEnv): Promise<SystemUninstallResult> {
  const daemonStatus = await stopDaemonBestEffort(systemHomeDir);
  const roots = resolveBuiltInHostRoots(systemHomeDir, env);
  const removedHostBindings: string[] = [];
  for (const root of roots) {
    const removed = await removeGuardedHostSymlinks(root);
    removedHostBindings.push(...removed);
  }

  const cliShimPath = path.join(systemHomeDir, '.metabot', 'bin', 'metabot');
  let removedCliShim = false;
  try {
    await fs.rm(cliShimPath, { force: true });
    removedCliShim = true;
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }

  const removedLegacyShim = await removeLegacyShimIfRecognized(systemHomeDir);
  return {
    tier: 'safe',
    removedHostBindings,
    removedCliShim,
    removedLegacyShim,
    daemonStopAttempted: daemonStatus.attempted,
    daemonStopped: daemonStatus.stopped,
    preservedSensitiveData: true,
  };
}

export async function runSystemUninstall(input: SystemUninstallInput): Promise<SystemUninstallResult> {
  const tier1Result = await runTier1Uninstall(input.systemHomeDir, input.env);
  if (!input.all) {
    return tier1Result;
  }

  if (!input.confirmToken) {
    throw new SystemCommandError(
      'confirmation_required',
      'Full erase requires --confirm-token DELETE_OPEN_AGENT_CONNECT_IDENTITY_AND_SECRETS.',
      true,
    );
  }

  if (input.confirmToken !== FULL_ERASE_TOKEN) {
    throw new SystemCommandError(
      'invalid_confirmation_token',
      'Invalid --confirm-token for full erase uninstall.',
    );
  }

  await fs.rm(path.join(input.systemHomeDir, '.metabot'), { recursive: true, force: true });
  return {
    ...tier1Result,
    tier: 'full_erase',
    preservedSensitiveData: false,
  };
}

