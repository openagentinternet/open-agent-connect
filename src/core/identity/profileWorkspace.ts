import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createDefaultConfig } from '../config/configTypes';
import type { IdentityProfileRecord } from './identityProfiles';
import { generateProfileSlug, resolveProfileNameMatch } from './profileNameResolution';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveProfilesRoot(systemHomeDir: string): string {
  return path.join(path.resolve(normalizeText(systemHomeDir)), '.metabot', 'profiles');
}

function resolveCanonicalProfileHome(systemHomeDir: string, slug: string): string {
  return path.join(resolveProfilesRoot(systemHomeDir), slug);
}

async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeFileIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
    await fs.writeFile(filePath, content, 'utf8');
  }
}

function buildStarterFiles(name: string): Record<string, string> {
  return {
    'AGENTS.md': [
      '# Agent Instructions',
      '',
      '- Keep profile-specific operating rules here.',
      '- Update this file intentionally when the profile behavior changes.',
      '',
    ].join('\n'),
    'SOUL.md': [
      `# ${name}`,
      '',
      'Describe the persona, tone, boundaries, and communication style for this MetaBot here.',
      '',
    ].join('\n'),
    'IDENTITY.md': [
      `# ${name}`,
      '',
      `Display name: ${name}`,
      '',
      'Capture the public-facing identity summary for this MetaBot here.',
      '',
    ].join('\n'),
    'USER.md': [
      '# User',
      '',
      'Store stable facts and preferences about the primary user here.',
      '',
    ].join('\n'),
    'MEMORY.md': [
      '# Memory',
      '',
      'Store curated long-term memory for this MetaBot here.',
      '',
    ].join('\n'),
  };
}

function buildDuplicateNameMessage(requestedName: string, matchedProfile: IdentityProfileRecord): string {
  return `Local MetaBot name "${requestedName}" already exists. Use metabot identity assign --name "${matchedProfile.name}".`;
}

function reserveAvailableSlug(baseSlug: string, profiles: IdentityProfileRecord[]): string {
  const usedSlugs = new Set(
    profiles
      .map((profile) => normalizeText(profile.slug) || path.basename(normalizeText(profile.homeDir)))
      .filter(Boolean),
  );
  if (!usedSlugs.has(baseSlug)) {
    return baseSlug;
  }

  let suffix = 2;
  while (usedSlugs.has(`${baseSlug}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseSlug}-${suffix}`;
}

export async function ensureProfileWorkspace(input: {
  homeDir: string;
  name: string;
}): Promise<void> {
  const homeDir = path.resolve(normalizeText(input.homeDir));
  const name = normalizeText(input.name) || 'MetaBot';
  if (!homeDir) {
    throw new Error('Profile workspace requires a non-empty homeDir.');
  }

  await Promise.all([
    ensureDirectory(homeDir),
    ensureDirectory(path.join(homeDir, 'memory')),
    ensureDirectory(path.join(homeDir, '.runtime')),
    ensureDirectory(path.join(homeDir, '.runtime', 'sessions')),
    ensureDirectory(path.join(homeDir, '.runtime', 'evolution')),
    ensureDirectory(path.join(homeDir, '.runtime', 'exports')),
    ensureDirectory(path.join(homeDir, '.runtime', 'state')),
    ensureDirectory(path.join(homeDir, '.runtime', 'locks')),
  ]);

  const starterFiles = buildStarterFiles(name);
  await Promise.all(Object.entries(starterFiles).map(([relativePath, content]) => (
    writeFileIfMissing(path.join(homeDir, relativePath), content)
  )));

  await writeFileIfMissing(
    path.join(homeDir, '.runtime', 'config.json'),
    `${JSON.stringify(createDefaultConfig(), null, 2)}\n`,
  );

  await writeFileIfMissing(
    path.join(homeDir, 'llmbindings.json'),
    `${JSON.stringify({ version: 1, bindings: [] }, null, 2)}\n`,
  );

  await writeFileIfMissing(
    path.join(homeDir, 'preferred-llm-runtime.json'),
    `${JSON.stringify({ runtimeId: null }, null, 2)}\n`,
  );
}

export function resolveIdentityCreateProfileHome(input: {
  systemHomeDir: string;
  requestedName: string;
  profiles: IdentityProfileRecord[];
}): (
  | {
    status: 'resolved';
    slug: string;
    homeDir: string;
  }
  | {
    status: 'duplicate';
    message: string;
  }
) {
  const requestedName = normalizeText(input.requestedName);
  if (!requestedName) {
    return {
      status: 'duplicate',
      message: 'MetaBot identity name is required.',
    };
  }

  const duplicateMatch = resolveProfileNameMatch(requestedName, input.profiles);
  if (duplicateMatch.status === 'matched' && duplicateMatch.matchType !== 'ranked') {
    return {
      status: 'duplicate',
      message: buildDuplicateNameMessage(requestedName, duplicateMatch.match),
    };
  }
  if (duplicateMatch.status === 'ambiguous') {
    return {
      status: 'duplicate',
      message: duplicateMatch.message,
    };
  }

  const slug = reserveAvailableSlug(generateProfileSlug(requestedName), input.profiles);
  return {
    status: 'resolved',
    slug,
    homeDir: resolveCanonicalProfileHome(input.systemHomeDir, slug),
  };
}
