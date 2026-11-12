/**
 * Best-effort repo identity for a session cwd (local session adapters P1).
 *
 * Directory listings show `repo@branch` like reason-network does: the repo
 * slug comes from the origin remote basename (falling back to the directory
 * basename), the branch from `git rev-parse --abbrev-ref HEAD`. Everything
 * is bounded and never throws — a cwd that is not a work tree just yields
 * the directory basename and an empty branch.
 */

import { execFile } from 'node:child_process';
import path from 'node:path';

const PROBE_TIMEOUT_MS = 1_500;
const PROBE_MAX_BUFFER_BYTES = 64 * 1024;

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER_BYTES, windowsHide: true },
      (error, stdout) => {
        resolve(error ? '' : String(stdout).trim());
      },
    );
  });
}

function repoSlugFromRemoteUrl(remoteUrl: string): string {
  const withoutSuffix = remoteUrl.replace(/\.git$/i, '');
  const lastSegment = withoutSuffix.split(/[/:]/).filter(Boolean).pop() ?? '';
  return lastSegment;
}

export async function probeRepoIdentity(
  cwd: string,
): Promise<{ repo: string; branch: string }> {
  const directoryBasename = path.basename(cwd).trim();
  try {
    const [branch, remoteUrl] = await Promise.all([
      runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
      runGit(cwd, ['remote', 'get-url', 'origin']),
    ]);
    const repo = repoSlugFromRemoteUrl(remoteUrl) || directoryBasename;
    // Detached HEAD reads as HEAD; report it but it is still a branch-ish marker.
    return { repo, branch };
  } catch {
    return { repo: directoryBasename, branch: '' };
  }
}
