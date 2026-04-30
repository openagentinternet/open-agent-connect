import { mkdtempSync, mkdirSync } from 'node:fs';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function createProfileHomeSync(prefix, slug = 'test-profile') {
  const systemHome = mkdtempSync(path.join(os.tmpdir(), prefix));
  const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
  mkdirSync(homeDir, { recursive: true });
  return homeDir;
}

export async function createProfileHome(prefix, slug = 'test-profile') {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), prefix));
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
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? error.code
        : '';
      if (code !== 'ENOTEMPTY' && code !== 'EBUSY') {
        throw error;
      }
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
  if (lastError) {
    throw lastError;
  }
}
