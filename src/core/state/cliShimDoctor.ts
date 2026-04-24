import { promises as fs } from 'node:fs';
import path from 'node:path';

const CANONICAL_BIN_SEGMENTS = ['.metabot', 'bin'];
const LEGACY_BIN_SEGMENTS = ['.agent-connect', 'bin'];
const PRIMARY_CLI_PATH = 'metabot';
const OVERRIDE_ENV_KEYS = {
  canonicalBinDir: 'METABOT_BIN_DIR',
  legacyBinDir: 'METABOT_LEGACY_BIN_DIR',
} as const;

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function isLegacyCompatibilityForwarder(legacyShimPath: string, canonicalShimPath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(legacyShimPath, 'utf8');
    const canonicalAssignmentMatches = content.includes(`CANONICAL_METABOT_BIN="${canonicalShimPath}"`)
      || content.includes(`CANONICAL_METABOT_BIN=${canonicalShimPath}`);
    return canonicalAssignmentMatches
      && content.includes('exec "$CANONICAL_METABOT_BIN" "$@"');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function resolveConfiguredDir(
  configuredDir: string | undefined,
  cwd: string,
  fallbackDir: string,
): string {
  const trimmed = configuredDir?.trim();
  return trimmed ? path.resolve(cwd, trimmed) : fallbackDir;
}

function readPathEntries(envPath: string | undefined, cwd: string): string[] {
  return String(envPath || '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(cwd, entry));
}

export async function buildCliShimDoctorCheck(systemHomeDir: string, env: NodeJS.ProcessEnv, cwd: string) {
  const canonicalBinDir = resolveConfiguredDir(
    env[OVERRIDE_ENV_KEYS.canonicalBinDir],
    cwd,
    path.join(systemHomeDir, ...CANONICAL_BIN_SEGMENTS),
  );
  const legacyBinDir = resolveConfiguredDir(
    env[OVERRIDE_ENV_KEYS.legacyBinDir],
    cwd,
    path.join(systemHomeDir, ...LEGACY_BIN_SEGMENTS),
  );
  const canonicalShimPath = path.join(canonicalBinDir, PRIMARY_CLI_PATH);
  const legacyShimPath = path.join(legacyBinDir, PRIMARY_CLI_PATH);

  const [canonicalShimExists, legacyShimExists] = await Promise.all([
    pathExists(canonicalShimPath),
    pathExists(legacyShimPath),
  ]);
  const legacyForwardsToCanonical = canonicalShimExists && legacyShimExists
    ? await isLegacyCompatibilityForwarder(legacyShimPath, canonicalShimPath)
    : false;
  const pathEntries = readPathEntries(env.PATH, cwd);
  const canonicalBinIndex = pathEntries.indexOf(path.resolve(canonicalBinDir));
  const legacyBinIndex = pathEntries.indexOf(path.resolve(legacyBinDir));
  const legacyShadowsCanonical = canonicalShimExists
    && legacyShimExists
    && legacyBinIndex !== -1
    && (canonicalBinIndex === -1 || legacyBinIndex < canonicalBinIndex);

  if (legacyShadowsCanonical && !legacyForwardsToCanonical) {
    return {
      code: 'canonical_cli_shim_preferred',
      ok: false,
      message: 'Legacy MetaBot CLI shim precedes the canonical MetaBot CLI shim on PATH.',
      canonicalShimPath,
      legacyShimPath,
    };
  }

  return {
    code: 'canonical_cli_shim_preferred',
    ok: true,
    canonicalShimPath: canonicalShimExists ? canonicalShimPath : null,
    legacyShimPath: legacyShimExists ? legacyShimPath : null,
    legacyCompatibilityForwarder: legacyForwardsToCanonical,
  };
}
