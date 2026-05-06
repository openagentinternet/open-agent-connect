import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  buildProfileAliases,
  generateProfileSlug,
} from './profileNameResolution';

const MANAGER_DIR = 'manager';
const PROFILES_FILE = 'identity-profiles.json';
const ACTIVE_HOME_FILE = 'active-home.json';
const TRANSIENT_JSON_READ_RETRIES = 5;
const TRANSIENT_JSON_READ_DELAY_MS = 10;

let atomicWriteSequence = 0;

export interface IdentityManagerPaths {
  managerRoot: string;
  profilesPath: string;
  activeHomePath: string;
}

export interface IdentityProfileRecord {
  name: string;
  slug: string;
  aliases: string[];
  homeDir: string;
  globalMetaId: string;
  mvcAddress: string;
  createdAt: number;
  updatedAt: number;
}

export interface IdentityProfilesState {
  profiles: IdentityProfileRecord[];
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function resolveProfilesRoot(systemHomeDir: string): string {
  return path.join(path.resolve(systemHomeDir), '.metabot', 'profiles');
}

function resolveCanonicalProfileHome(systemHomeDir: string, slug: string): string {
  return path.join(resolveProfilesRoot(systemHomeDir), slug);
}

function isCanonicalProfileHome(systemHomeDir: string, homeDir: string): boolean {
  return path.dirname(homeDir) === resolveProfilesRoot(systemHomeDir);
}

function normalizeAliases(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
    : [];
}

function resolveStableProfileSlug(
  systemHomeDir: string,
  profile: { name: string; slug?: string; homeDir: string },
): string {
  if (isCanonicalProfileHome(systemHomeDir, profile.homeDir)) {
    return path.basename(profile.homeDir);
  }
  return normalizeText(profile.slug) || generateProfileSlug(profile.name);
}

function normalizeProfileRecord(systemHomeDir: string, value: unknown): IdentityProfileRecord | null {
  const record = normalizeRecord(value);
  if (!record) {
    return null;
  }

  const name = normalizeText(record.name);
  const homeDirRaw = normalizeText(record.homeDir);
  const resolvedHomeDir = homeDirRaw ? path.resolve(homeDirRaw) : '';
  const recordSlug = normalizeText(record.slug);
  const globalMetaId = normalizeText(record.globalMetaId);
  const mvcAddress = normalizeText(record.mvcAddress);
  const existingAliases = normalizeAliases(record.aliases);
  const createdAt = toFiniteNumber(record.createdAt) ?? Date.now();
  const updatedAt = toFiniteNumber(record.updatedAt) ?? createdAt;

  if (!name || !resolvedHomeDir) {
    return null;
  }

  const slug = resolveStableProfileSlug(systemHomeDir, {
    name,
    slug: recordSlug,
    homeDir: resolvedHomeDir,
  });
  const aliases = buildProfileAliases(name, slug, existingAliases);
  const homeDir = resolveCanonicalProfileHome(systemHomeDir, slug);

  return {
    name,
    slug,
    aliases,
    homeDir,
    globalMetaId,
    mvcAddress,
    createdAt,
    updatedAt,
  };
}

function sortProfiles(profiles: IdentityProfileRecord[]): IdentityProfileRecord[] {
  return [...profiles].sort((left, right) => {
    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    return left.name.localeCompare(right.name);
  });
}

function reserveUniqueProfileSlug(slug: string, usedSlugs: Set<string>): string {
  if (!usedSlugs.has(slug)) {
    usedSlugs.add(slug);
    return slug;
  }

  const match = slug.match(/^(.*?)-(\d+)$/);
  const baseSlug = match?.[1] || slug;
  let suffix = 2;
  while (usedSlugs.has(`${baseSlug}-${suffix}`)) {
    suffix += 1;
  }

  const uniqueSlug = `${baseSlug}-${suffix}`;
  usedSlugs.add(uniqueSlug);
  return uniqueSlug;
}

function normalizeProfilesState(systemHomeDir: string, value: unknown): IdentityProfilesState {
  const record = normalizeRecord(value);
  if (!record) {
    return { profiles: [] };
  }

  const profiles = Array.isArray(record.profiles)
    ? record.profiles
      .map((entry) => normalizeProfileRecord(systemHomeDir, entry))
      .filter((entry): entry is IdentityProfileRecord => Boolean(entry))
    : [];

  const usedSlugs = new Set<string>();
  const normalizedProfiles = sortProfiles(profiles).map((profile) => {
    const uniqueSlug = reserveUniqueProfileSlug(profile.slug, usedSlugs);
    return {
      ...profile,
      slug: uniqueSlug,
      aliases: buildProfileAliases(profile.name, uniqueSlug, profile.aliases),
      homeDir: resolveCanonicalProfileHome(systemHomeDir, uniqueSlug),
    };
  });

  return {
    profiles: sortProfiles(normalizedProfiles),
  };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  for (let attempt = 0; attempt <= TRANSIENT_JSON_READ_RETRIES; attempt += 1) {
    try {
      const raw = await fsp.readFile(filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return null;
      }
      if (error instanceof SyntaxError && attempt < TRANSIENT_JSON_READ_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, TRANSIENT_JSON_READ_DELAY_MS));
        continue;
      }
      throw error;
    }
  }
  return null;
}

async function ensureManagerRoot(paths: IdentityManagerPaths): Promise<void> {
  await fsp.mkdir(paths.managerRoot, { recursive: true });
}

function serializeProfilesState(state: IdentityProfilesState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

function createAtomicWriteTempPath(filePath: string): string {
  atomicWriteSequence += 1;
  return `${filePath}.${process.pid}.${Date.now()}.${atomicWriteSequence}.tmp`;
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = createAtomicWriteTempPath(filePath);
  try {
    await fsp.writeFile(tempPath, content, 'utf8');
    await fsp.rename(tempPath, filePath);
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function resolveIdentityManagerPaths(systemHomeDir: string): IdentityManagerPaths {
  const normalizedSystemHome = normalizeText(systemHomeDir);
  if (!normalizedSystemHome) {
    throw new Error('A system home directory is required to resolve identity manager paths.');
  }

  const managerRoot = path.join(path.resolve(normalizedSystemHome), '.metabot', MANAGER_DIR);
  return {
    managerRoot,
    profilesPath: path.join(managerRoot, PROFILES_FILE),
    activeHomePath: path.join(managerRoot, ACTIVE_HOME_FILE),
  };
}

export async function readIdentityProfilesState(systemHomeDir: string): Promise<IdentityProfilesState> {
  const paths = resolveIdentityManagerPaths(systemHomeDir);
  await ensureManagerRoot(paths);
  const parsed = await readJsonFile<unknown>(paths.profilesPath);
  const normalized = normalizeProfilesState(systemHomeDir, parsed);
  if (parsed !== null && JSON.stringify(parsed) !== JSON.stringify(normalized)) {
    await writeFileAtomic(paths.profilesPath, serializeProfilesState(normalized));
  }
  return normalized;
}

async function writeIdentityProfilesState(
  systemHomeDir: string,
  state: IdentityProfilesState,
): Promise<IdentityProfilesState> {
  const paths = resolveIdentityManagerPaths(systemHomeDir);
  await ensureManagerRoot(paths);
  const normalized = normalizeProfilesState(systemHomeDir, state);
  await writeFileAtomic(paths.profilesPath, serializeProfilesState(normalized));
  return normalized;
}

export async function listIdentityProfiles(systemHomeDir: string): Promise<IdentityProfileRecord[]> {
  const state = await readIdentityProfilesState(systemHomeDir);
  return state.profiles;
}

export async function upsertIdentityProfile(input: {
  systemHomeDir: string;
  name: string;
  homeDir: string;
  globalMetaId?: string;
  mvcAddress?: string;
  now?: () => number;
}): Promise<IdentityProfileRecord> {
  const now = input.now ?? Date.now;
  const name = normalizeText(input.name);
  const nextSlug = generateProfileSlug(name);
  const inputHomeDir = path.resolve(normalizeText(input.homeDir));
  const globalMetaId = normalizeText(input.globalMetaId);
  const mvcAddress = normalizeText(input.mvcAddress);
  if (!name || !inputHomeDir) {
    throw new Error('Identity profile upsert requires both name and homeDir.');
  }

  const current = await readIdentityProfilesState(input.systemHomeDir);
  const timestamp = now();
  let updated: IdentityProfileRecord | null = null;

  const nextProfiles = current.profiles.map((profile) => {
    if (
      profile.homeDir === inputHomeDir
      || (globalMetaId && profile.globalMetaId && profile.globalMetaId === globalMetaId)
    ) {
      const stableSlug = resolveStableProfileSlug(input.systemHomeDir, profile);
      const stableHomeDir = resolveCanonicalProfileHome(input.systemHomeDir, stableSlug);
      updated = {
        ...profile,
        name,
        slug: stableSlug,
        aliases: buildProfileAliases(name, stableSlug, profile.aliases),
        homeDir: stableHomeDir,
        globalMetaId: globalMetaId || profile.globalMetaId,
        mvcAddress: mvcAddress || profile.mvcAddress,
        updatedAt: timestamp,
      };
      return updated;
    }
    return profile;
  });

  if (!updated) {
    const stableHomeDir = isCanonicalProfileHome(input.systemHomeDir, inputHomeDir)
      ? inputHomeDir
      : resolveCanonicalProfileHome(input.systemHomeDir, nextSlug);
    const stableSlug = path.basename(stableHomeDir);
    updated = {
      name,
      slug: stableSlug,
      aliases: buildProfileAliases(name, stableSlug),
      homeDir: stableHomeDir,
      globalMetaId,
      mvcAddress,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    nextProfiles.push(updated);
  }

  await writeIdentityProfilesState(input.systemHomeDir, {
    profiles: nextProfiles,
  });

  return updated;
}

export async function deleteIdentityProfile(input: {
  systemHomeDir: string;
  slug: string;
}): Promise<IdentityProfileRecord | null> {
  const slug = normalizeText(input.slug);
  if (!slug) {
    throw new Error('Identity profile delete requires a non-empty slug.');
  }

  const current = await readIdentityProfilesState(input.systemHomeDir);
  const deleted = current.profiles.find((profile) => profile.slug === slug) ?? null;
  if (!deleted) {
    return null;
  }

  await writeIdentityProfilesState(input.systemHomeDir, {
    profiles: current.profiles.filter((profile) => profile.slug !== slug),
  });

  const paths = resolveIdentityManagerPaths(input.systemHomeDir);
  const activeHome = parseActiveHomePayload(await readJsonFile<unknown>(paths.activeHomePath));
  if (activeHome && path.resolve(activeHome) === path.resolve(deleted.homeDir)) {
    await fsp.rm(paths.activeHomePath, { force: true });
  }

  return deleted;
}

function parseActiveHomePayload(value: unknown): string | null {
  const record = normalizeRecord(value);
  if (!record) {
    return null;
  }
  const homeDirRaw = normalizeText(record.homeDir);
  if (!homeDirRaw) {
    return null;
  }
  return path.resolve(homeDirRaw);
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

function validateActiveHome(systemHomeDir: string, homeDir: string | null, profilesState: IdentityProfilesState): string | null {
  if (!homeDir || !isCanonicalProfileHome(systemHomeDir, homeDir)) {
    return null;
  }
  return profilesState.profiles.some((profile) => profile.homeDir === homeDir) ? homeDir : null;
}

export function readActiveMetabotHomeSync(systemHomeDir: string): string | null {
  const paths = resolveIdentityManagerPaths(systemHomeDir);
  try {
    const parsed = readJsonFileSync<unknown>(paths.activeHomePath);
    const profilesState = normalizeProfilesState(systemHomeDir, readJsonFileSync<unknown>(paths.profilesPath));
    return validateActiveHome(systemHomeDir, parseActiveHomePayload(parsed), profilesState);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || error instanceof SyntaxError) {
      return null;
    }
    return null;
  }
}

export async function readActiveMetabotHome(systemHomeDir: string): Promise<string | null> {
  const paths = resolveIdentityManagerPaths(systemHomeDir);
  await ensureManagerRoot(paths);
  const [parsed, profilesState] = await Promise.all([
    readJsonFile<unknown>(paths.activeHomePath),
    readIdentityProfilesState(systemHomeDir),
  ]);
  return validateActiveHome(systemHomeDir, parseActiveHomePayload(parsed), profilesState);
}

export async function setActiveMetabotHome(input: {
  systemHomeDir: string;
  homeDir: string;
  now?: () => number;
}): Promise<string> {
  const now = input.now ?? Date.now;
  const homeDir = path.resolve(normalizeText(input.homeDir));
  if (!homeDir) {
    throw new Error('Active metabot home requires a non-empty homeDir.');
  }

  const paths = resolveIdentityManagerPaths(input.systemHomeDir);
  await ensureManagerRoot(paths);
  await writeFileAtomic(
    paths.activeHomePath,
    `${JSON.stringify({ homeDir, updatedAt: now() }, null, 2)}\n`,
  );
  return homeDir;
}
