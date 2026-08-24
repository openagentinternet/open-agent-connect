/**
 * Owner-approval gate for on-chain file publishing from chain-write tools
 * (upload_file / post_buzz / post_simplenote). OAC port of the IDBots
 * chainUploadGate (2026-08-24 release). Publishing a file makes it public
 * and irreversible, so local paths OUTSIDE the session workspace require an
 * explicit owner confirmation before they ever leave the machine. Files
 * inside the workspace (the bot's own working directory) publish freely —
 * that is the tools' normal job. metafile:// URIs are already on-chain and
 * are never gated (the gate sits at the local-file upload chokepoint only).
 *
 * The gate is ACTIVE only when the host provides both the workspace
 * resolver and the confirmation callback. Hosts that provide neither keep
 * the legacy ungated behavior — embedders should provide both.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve a path through fs.realpathSync. When the final component does not
 * exist, resolve the nearest existing ancestor and keep the remainder — a
 * missing file inside a symlinked directory (e.g. /tmp → /private/tmp on
 * macOS) then still compares against the resolved workspace correctly.
 */
function resolveReal(value: string): string {
  try {
    return fs.realpathSync(value);
  } catch {
    const parent = resolveReal(path.dirname(value));
    return path.join(parent, path.basename(value));
  }
}

/**
 * True when filePath resolves inside dir (or equals it). Symlink-aware:
 * both sides are resolved through symlinks first, so a symlink planted
 * inside the workspace that points at e.g. ~/.ssh/id_rsa counts as
 * OUTSIDE. Paths that do not exist keep their lexical tail (the caller's
 * own existsSync validation reports them later).
 */
export function isPathInsideDir(filePath: string, dir: string): boolean {
  if (!filePath || !dir) return false;
  const rel = path.relative(resolveReal(path.resolve(dir)), resolveReal(path.resolve(filePath)));
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

export type UploadGateDeps = {
  /** Resolves the session workspace dir; undefined when the session has none. */
  getWorkspaceDir?: () => string | undefined;
  /** Asks the owner to approve publishing the listed files. True = approved. */
  confirmExternalUpload?: (files: string[]) => Promise<boolean>;
};

/**
 * Gate one local file. Returns null when the upload may proceed, or a
 * human/agent-readable error message when it must not (owner declined).
 * A file outside the workspace — or any file when the workspace is
 * unknown — asks the owner once.
 */
export async function checkUploadAllowed(filePath: string, deps: UploadGateDeps): Promise<string | null> {
  if (!deps.getWorkspaceDir || !deps.confirmExternalUpload) return null;
  if (!filePath || !path.isAbsolute(filePath)) return null;
  const workspaceDir = deps.getWorkspaceDir();
  const external = !workspaceDir || !isPathInsideDir(filePath, workspaceDir);
  if (!external) return null;
  const approved = await deps.confirmExternalUpload([filePath]);
  if (approved) return null;
  return `Owner declined to upload a file outside the session workspace: ${filePath}. Do not retry unless the owner explicitly asks again; suggest copying the file into the workspace instead.`;
}

/**
 * Wrap one upload function with the gate. Consumers upload through the
 * wrapper instead of the raw service; a declined file throws before any
 * bytes leave the machine, and the caller's normal error handling
 * surfaces the message to the agent.
 */
export function wrapUploadWithGate<T extends (params: { filePath: string }) => Promise<unknown>>(
  upload: T,
  deps: UploadGateDeps,
): T {
  return (async (params: { filePath: string }) => {
    const denied = await checkUploadAllowed(params.filePath, deps);
    if (denied) throw new Error(denied);
    return upload(params);
  }) as T;
}
