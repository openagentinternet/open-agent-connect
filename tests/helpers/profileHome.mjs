import { mkdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { cleanupTempRoot, mkdtempTempRoot, mkdtempTempRootSync, rmTempRootWithRetry } from './tempRoots.mjs';

export function createProfileHomeSync(prefix, slug = 'test-profile') {
  const systemHome = mkdtempTempRootSync(prefix);
  const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
  mkdirSync(homeDir, { recursive: true });
  return homeDir;
}

export async function createProfileHome(prefix, slug = 'test-profile') {
  const systemHome = await mkdtempTempRoot(prefix);
  const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
  await mkdir(homeDir, { recursive: true });
  return homeDir;
}

export function deriveSystemHome(homeDir) {
  const normalizedHomeDir = path.resolve(homeDir);
  const profilesRoot = path.dirname(normalizedHomeDir);
  const metabotRoot = path.dirname(profilesRoot);
  if (path.basename(profilesRoot) !== 'profiles' || path.basename(metabotRoot) !== '.metabot') {
    return normalizedHomeDir;
  }
  return path.dirname(metabotRoot);
}

export async function cleanupProfileHome(homeDir) {
  const target = deriveSystemHome(homeDir);
  await cleanupTempRoot(target);
}

// Kept for callers that only need the retrying recursive removal.
export { rmTempRootWithRetry };
