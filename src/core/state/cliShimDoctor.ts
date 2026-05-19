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

async function readTextIfFile(targetPath: string): Promise<string | null> {
  try {
    return await fs.readFile(targetPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function normalizePathValue(value: string | undefined, cwd: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(cwd, trimmed) : null;
}

function decodeShellDoubleQuotedValue(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`) as string;
  } catch {
    return value;
  }
}

function extractCanonicalTargetPath(shimBody: string | null, cwd: string): string | null {
  if (!shimBody) {
    return null;
  }

  const preferredMatch = shimBody.match(/^PREFERRED_CLI_ENTRY="([^"]+)"/m);
  if (preferredMatch?.[1]) {
    return normalizePathValue(decodeShellDoubleQuotedValue(preferredMatch[1]), cwd);
  }

  const execMatch = shimBody.match(/exec "\$NODE_BIN" "([^"]+)" "\$@"/m);
  if (execMatch?.[1]) {
    return normalizePathValue(decodeShellDoubleQuotedValue(execMatch[1]), cwd);
  }

  return null;
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

export async function buildCliRuntimeDoctorCheck(
  systemHomeDir: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
  currentEntryPath?: string | null,
) {
  const canonicalBinDir = resolveConfiguredDir(
    env[OVERRIDE_ENV_KEYS.canonicalBinDir],
    cwd,
    path.join(systemHomeDir, ...CANONICAL_BIN_SEGMENTS),
  );
  const canonicalShimPath = path.join(canonicalBinDir, PRIMARY_CLI_PATH);
  if (!(await pathExists(canonicalShimPath))) {
    return null;
  }

  const canonicalTargetPath = extractCanonicalTargetPath(
    await readTextIfFile(canonicalShimPath),
    cwd,
  );
  const normalizedCurrentEntryPath = normalizePathValue(currentEntryPath ?? undefined, cwd);
  if (!canonicalTargetPath || !normalizedCurrentEntryPath) {
    return null;
  }

  return {
    code: 'cli_runtime_matches_canonical_shim',
    ok: path.resolve(normalizedCurrentEntryPath) === path.resolve(canonicalTargetPath),
    canonicalShimPath,
    canonicalTargetPath,
    currentEntryPath: normalizedCurrentEntryPath,
  };
}
