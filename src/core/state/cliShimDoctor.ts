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

  const ok = path.resolve(normalizedCurrentEntryPath) === path.resolve(canonicalTargetPath);
  return {
    code: 'cli_runtime_matches_canonical_shim',
    ok,
    canonicalShimPath,
    canonicalTargetPath,
    currentEntryPath: normalizedCurrentEntryPath,
    // A mismatch means multiple OAC installs (e.g. a global npm/homebrew
    // package plus a checkout) — the classic root cause of "my change did
    // nothing". Hand back copy-pasteable repair steps instead of a bare
    // ok:false.
    ...(ok ? {} : {
      remediation: [
        `Run \`oac install\` from the OAC install you want canonical — it rewrites ${canonicalShimPath} to that install's dist.`,
        `Make ${path.join(canonicalBinDir, '')} the first PATH entry (or invoke ${canonicalShimPath} directly) so the shim is what actually runs.`,
        'Remove redundant installs you do not want (e.g. `npm uninstall -g open-agent-connect` or the equivalent homebrew formula).',
        'Run `metabot daemon restart` so the tracked daemon runs from the canonical entry too.',
      ],
    }),
  };
}
