import { promises as fs } from 'node:fs';
import path from 'node:path';

const CANONICAL_BIN_SEGMENTS = ['.metabot', 'bin'];
const PRIMARY_CLI_PATH = 'metabot';
const OVERRIDE_ENV_KEYS = {
  canonicalBinDir: 'METABOT_BIN_DIR',
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

function resolveConfiguredDir(
  configuredDir: string | undefined,
  cwd: string,
  fallbackDir: string,
): string {
  const trimmed = configuredDir?.trim();
  return trimmed ? path.resolve(cwd, trimmed) : fallbackDir;
}

export async function buildCliShimDoctorCheck(systemHomeDir: string, env: NodeJS.ProcessEnv, cwd: string) {
  const canonicalBinDir = resolveConfiguredDir(
    env[OVERRIDE_ENV_KEYS.canonicalBinDir],
    cwd,
    path.join(systemHomeDir, ...CANONICAL_BIN_SEGMENTS),
  );
  const canonicalShimPath = path.join(canonicalBinDir, PRIMARY_CLI_PATH);
  const canonicalShimExists = await pathExists(canonicalShimPath);

  return {
    code: 'canonical_cli_shim_preferred',
    ok: true,
    canonicalShimPath: canonicalShimExists ? canonicalShimPath : null,
  };
}
