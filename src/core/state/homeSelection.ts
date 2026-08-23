import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveIdentityManagerPaths } from '../identity/identityProfiles';
import { resolveMetabotPaths, type MetabotPaths } from './paths';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeWindowsProfileHome(env: NodeJS.ProcessEnv): string {
  const userProfile = normalizeText(env.USERPROFILE);
  if (userProfile) {
    return userProfile;
  }
  const homeDrive = normalizeText(env.HOMEDRIVE);
  const homePath = normalizeText(env.HOMEPATH);
  return homeDrive && homePath ? `${homeDrive}${homePath}` : '';
}

function readJsonFileSync<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeIndexedHomeDirs(value: unknown): Set<string> {
  const record = normalizeRecord(value);
  const profiles = Array.isArray(record?.profiles) ? record.profiles : [];
  const indexedHomeDirs = new Set<string>();
  for (const entry of profiles) {
    const normalized = normalizeRecord(entry);
    const homeDir = normalizeText(normalized?.homeDir);
    if (homeDir) {
      indexedHomeDirs.add(path.resolve(homeDir));
    }
  }
  return indexedHomeDirs;
}

export interface MetabotManagerLayout {
  systemHomeDir: string;
  metabotRoot: string;
  managerRoot: string;
  skillsRoot: string;
  profilesRoot: string;
  identityProfilesPath: string;
}

export interface MetabotHomeSelection {
  systemHomeDir: string;
  homeDir: string;
  paths: MetabotPaths;
  source: 'explicit' | 'twin';
}

interface ResolveMetabotHomeSelectionInput {
  env: NodeJS.ProcessEnv;
  cwd: string;
  allowUnindexedExplicitHome?: boolean;
}

export function normalizeSystemHomeDir(env: NodeJS.ProcessEnv, cwd: string): string {
  const home = normalizeText(env.HOME)
    || normalizeWindowsProfileHome(env)
    || normalizeText(process.env.HOME)
    || normalizeWindowsProfileHome(process.env)
    || normalizeText(os.homedir());
  const fallback = normalizeText(cwd);
  const systemHomeDir = path.resolve(home || fallback);
  if (!systemHomeDir) {
    throw new Error('A system home directory is required.');
  }
  return systemHomeDir;
}

export function resolveMetabotManagerLayout(systemHomeDir: string): MetabotManagerLayout {
  const normalizedSystemHome = normalizeText(systemHomeDir);
  if (!normalizedSystemHome) {
    throw new Error('A system home directory is required to resolve the metabot manager layout.');
  }

  const resolvedSystemHome = path.resolve(normalizedSystemHome);
  const metabotRoot = path.join(resolvedSystemHome, '.metabot');
  const managerPaths = resolveIdentityManagerPaths(resolvedSystemHome);
  return {
    systemHomeDir: resolvedSystemHome,
    metabotRoot,
    managerRoot: managerPaths.managerRoot,
    skillsRoot: path.join(metabotRoot, 'skills'),
    profilesRoot: path.join(metabotRoot, 'profiles'),
    identityProfilesPath: managerPaths.profilesPath,
  };
}

export function hasLegacyOnlyMetabotLayout(systemHomeDir: string): boolean {
  const layout = resolveMetabotManagerLayout(systemHomeDir);
  const legacyHotRoot = path.join(layout.metabotRoot, 'hot');
  return (
    fs.existsSync(legacyHotRoot)
    && !fs.existsSync(layout.managerRoot)
    && !fs.existsSync(layout.profilesRoot)
  );
}

function assertNoLegacyOnlyLayout(systemHomeDir: string): void {
  if (!hasLegacyOnlyMetabotLayout(systemHomeDir)) {
    return;
  }
  throw new Error(
    'Legacy pre-v2 MetaBot layout detected. This pre-release layout change is not migrated automatically; clean or reinitialize the local MetaBot root before using v2.'
  );
}

function isDirectProfileHome(profilesRoot: string, candidateHomeDir: string): boolean {
  return path.dirname(candidateHomeDir) === profilesRoot;
}

function validateExplicitMetabotHome(input: {
  systemHomeDir: string;
  homeDir: string;
  allowUnindexedExplicitHome?: boolean;
}): string {
  const layout = resolveMetabotManagerLayout(input.systemHomeDir);
  const normalizedHomeDir = path.resolve(normalizeText(input.homeDir));
  if (!normalizedHomeDir) {
    throw new Error('METABOT_HOME must not be empty.');
  }
  if (!isDirectProfileHome(layout.profilesRoot, normalizedHomeDir)) {
    throw new Error(
      `METABOT_HOME must point to ~/.metabot/profiles/<slug>, received: ${normalizedHomeDir}`
    );
  }
  if (input.allowUnindexedExplicitHome === true) {
    return normalizedHomeDir;
  }
  const indexedHomeDirs = normalizeIndexedHomeDirs(readJsonFileSync<unknown>(layout.identityProfilesPath));
  if (!indexedHomeDirs.has(normalizedHomeDir)) {
    throw new Error(
      `METABOT_HOME must point to a manager-indexed profile for existing-profile operations, received unindexed profile: ${normalizedHomeDir}`
    );
  }
  return normalizedHomeDir;
}

/**
 * The machine default Bot is the Twin Bot (see core/bot/twinRole.ts); there is
 * no separate active-home pointer anymore. Resolved sync from the manager
 * index plus each profile's bot-role.json: the twin's home, else the
 * earliest-created profile's (the same pick the twin invariant's repair
 * makes), else null when no indexed profiles exist. A stale manager-level
 * active-home.json from older versions is deliberately not consulted.
 */
function resolveIndexedTwinHome(systemHomeDir: string): string | null {
  const layout = resolveMetabotManagerLayout(systemHomeDir);
  const record = normalizeRecord(readJsonFileSync<unknown>(layout.identityProfilesPath));
  const rawProfiles = Array.isArray(record?.profiles) ? record.profiles : [];
  let twinHome: string | null = null;
  let earliest: { homeDir: string; createdAt: number } | null = null;
  for (const rawEntry of rawProfiles) {
    const entry = normalizeRecord(rawEntry);
    const homeDirRaw = normalizeText(entry?.homeDir);
    if (!homeDirRaw) continue;
    const homeDir = path.resolve(homeDirRaw);
    if (!isDirectProfileHome(layout.profilesRoot, homeDir)) continue;
    if (!twinHome) {
      const role = normalizeRecord(
        readJsonFileSync<unknown>(resolveMetabotPaths(homeDir).botRoleStatePath)
      );
      if (role?.botType === 'twin') {
        twinHome = homeDir;
      }
    }
    const createdAt = typeof entry?.createdAt === 'number' && Number.isFinite(entry.createdAt)
      ? entry.createdAt
      : Number.POSITIVE_INFINITY;
    if (!earliest || createdAt < earliest.createdAt) {
      earliest = { homeDir, createdAt };
    }
  }
  return twinHome ?? earliest?.homeDir ?? null;
}

export function resolveMetabotHomeSelection(input: ResolveMetabotHomeSelectionInput): MetabotHomeSelection {
  const systemHomeDir = normalizeSystemHomeDir(input.env, input.cwd);
  assertNoLegacyOnlyLayout(systemHomeDir);

  const explicitHome = normalizeText(input.env.METABOT_HOME);
  if (explicitHome) {
    const homeDir = validateExplicitMetabotHome({
      systemHomeDir,
      homeDir: explicitHome,
      allowUnindexedExplicitHome: input.allowUnindexedExplicitHome,
    });
    return {
      systemHomeDir,
      homeDir,
      paths: resolveMetabotPaths(homeDir),
      source: 'explicit',
    };
  }

  const twinHomeDir = resolveIndexedTwinHome(systemHomeDir);
  if (!twinHomeDir) {
    throw new Error('No Twin Bot initialized.');
  }

  return {
    systemHomeDir,
    homeDir: twinHomeDir,
    paths: resolveMetabotPaths(twinHomeDir),
    source: 'twin',
  };
}

export function resolveMetabotHomeSelectionSync(input: ResolveMetabotHomeSelectionInput): MetabotHomeSelection {
  return resolveMetabotHomeSelection(input);
}
