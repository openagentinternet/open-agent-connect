import { promises as fs } from 'node:fs';
import path from 'node:path';

// Provider order attempts execute in per-run workspaces under
// <profile>/.runtime/a2a-provider-runs/<runId>/attempt-<n>-<runtime>. Delivery
// uploads every referenced artifact to the chain (metafile:// URIs) and
// scrubs local paths from the delivered text, so once an order is terminal
// nothing local references the workspace anymore and it is deleted. Attempts
// abandoned before a terminal state (daemon crash, executor killed) are
// reclaimed by the TTL sweep below.
export const PROVIDER_RUN_WORKSPACE_TTL_MS = 24 * 60 * 60_000;
export const PROVIDER_RUN_WORKSPACE_SWEEP_INTERVAL_MS = 60 * 60_000;

function providerRunsRoot(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), '.runtime', 'a2a-provider-runs');
}

// Resolves the run directory (<runsRoot>/<runId>) that owns one attempt
// workspace. Returns null for anything that is not exactly
// <runsRoot>/<runId>/<attemptId> so a malformed metadata path can never
// delete an arbitrary directory. Both sides are realpath'd best-effort
// because the runner stores attemptWorkspaceCwd as a real path.
export async function resolveProviderRunWorkspaceDir(
  projectRoot: string,
  attemptWorkspaceCwd: unknown,
): Promise<string | null> {
  const normalized = typeof attemptWorkspaceCwd === 'string' ? attemptWorkspaceCwd.trim() : '';
  if (!normalized) {
    return null;
  }
  const runsRoot = providerRunsRoot(projectRoot);
  const [realRunsRoot, realAttempt] = await Promise.all([
    fs.realpath(runsRoot).catch(() => runsRoot),
    fs.realpath(normalized).catch(() => path.resolve(normalized)),
  ]);
  const relative = path.relative(realRunsRoot, realAttempt);
  const segments = relative.split(path.sep);
  if (
    segments.length !== 2
    || !segments[0]
    || !segments[1]
    || relative.startsWith('..')
    || path.isAbsolute(relative)
  ) {
    return null;
  }
  return path.join(runsRoot, segments[0]);
}

// Best-effort removal of the whole run workspace (all attempts of one run)
// once the owning order reached a terminal state. Never throws.
export async function removeProviderRunWorkspace(
  projectRoot: string,
  attemptWorkspaceCwd: unknown,
): Promise<boolean> {
  const runDir = await resolveProviderRunWorkspaceDir(projectRoot, attemptWorkspaceCwd);
  if (!runDir) {
    return false;
  }
  try {
    await fs.rm(runDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

// Directory mtimes track entry creation/removal, which is enough here: an
// attempt still producing output keeps creating files (provider sessions are
// capped at 30 minutes), while an abandoned attempt ages out after the TTL.
async function readNewestChildMtimeMs(runDir: string): Promise<number | null> {
  try {
    const runStat = await fs.stat(runDir);
    let newest = runStat.mtimeMs;
    const children = await fs.readdir(runDir);
    for (const child of children) {
      const childStat = await fs.stat(path.join(runDir, child)).catch(() => null);
      if (childStat) {
        newest = Math.max(newest, childStat.mtimeMs);
      }
    }
    return newest;
  } catch {
    return null;
  }
}

// Janitor for abandoned run workspaces: removes every run directory whose
// newest attempt mtime is older than the TTL. Never throws; a busy or
// unreadable directory is kept and retried on the next sweep.
export async function sweepProviderRunWorkspaces(input: {
  projectRoot: string;
  ttlMs?: number;
  nowMs?: number;
}): Promise<{ removedRunIds: string[] }> {
  const ttlMs = Math.max(0, Math.floor(input.ttlMs ?? PROVIDER_RUN_WORKSPACE_TTL_MS));
  const nowMs = input.nowMs ?? Date.now();
  const runsRoot = providerRunsRoot(input.projectRoot);
  let entries;
  try {
    entries = await fs.readdir(runsRoot, { withFileTypes: true });
  } catch {
    return { removedRunIds: [] };
  }
  const removedRunIds: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const runDir = path.join(runsRoot, entry.name);
    const newestMtimeMs = await readNewestChildMtimeMs(runDir);
    if (newestMtimeMs === null || nowMs - newestMtimeMs < ttlMs) {
      continue;
    }
    try {
      await fs.rm(runDir, { recursive: true, force: true });
      removedRunIds.push(entry.name);
    } catch {
      // Best effort: retry on the next sweep.
    }
  }
  return { removedRunIds };
}
