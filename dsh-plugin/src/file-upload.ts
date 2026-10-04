/**
 * MetaApp asset upload: write the raw bytes to a temp file and hand them to
 * `metabot file upload-large`, which returns the metafile reference. The host
 * process is the only one that talks to the CLI, so raw browser bytes never
 * reach it directly.
 *
 * Staging lives INSIDE the acting Bot's workspace: the daemon's upload gate
 * refuses out-of-workspace paths and no request flag can override that (H3),
 * so caller-supplied bytes are staged where the gate accepts them.
 */
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { actorHomeDir } from './browser-tools.js'
import { runMetabot, type MetabotCommandResult, type RunMetabotOptions } from './cli-bridge.js'

const UPLOAD_TIMEOUT_MS = 120_000

export type RunFn = (
  args: string[],
  options?: RunMetabotOptions,
) => Promise<MetabotCommandResult>

/**
 * Upload raw file bytes via `metabot file upload-large` and return the CLI
 * envelope (its `data` carries `metafileUri` / `pinId`).
 */
export async function uploadFileBytes(
  from: string,
  bytes: Buffer,
  contentType = 'application/octet-stream',
  run: RunFn = runMetabot,
): Promise<MetabotCommandResult> {
  const homeDir = await actorHomeDir(from)
  const stagingRoot = join(homeDir, 'workspace', '.upload-staging')
  await mkdir(stagingRoot, { recursive: true })
  const dir = await mkdtemp(join(stagingRoot, 'upload-'))
  const path = join(dir, 'upload.bin')
  await writeFile(path, bytes)
  try {
    // The staged file holds bytes the caller just submitted through the DSH
    // surface, and it sits inside the Bot workspace so the daemon's
    // fail-closed gate accepts it without any caller-supplied consent flag.
    const args = ['file', 'upload-large', '--from', from, '--file', path]
    if (contentType.trim() !== '') args.push('--content-type', contentType.trim())
    return await run(args, { timeoutMs: UPLOAD_TIMEOUT_MS })
  } finally {
    await rm(path, { force: true }).catch(() => undefined)
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export interface StagedExternalFiles {
  /** Map from the original absolute path to the staged in-workspace path. */
  pathByOriginal: Map<string, string>
  cleanup(): Promise<void>
}

/**
 * Copy owner-approved external files into the acting Bot's workspace so the
 * daemon's fail-closed upload gate accepts them during a publish command.
 * The host (never the model) performs the copy after a native approval
 * dialog — that is what makes the consent unforgeable by tool arguments.
 */
export async function stageExternalFilesIntoWorkspace(
  from: string,
  paths: string[],
): Promise<StagedExternalFiles> {
  const homeDir = await actorHomeDir(from)
  const stagingRoot = join(homeDir, 'workspace', '.upload-staging')
  await mkdir(stagingRoot, { recursive: true })
  const dir = await mkdtemp(join(stagingRoot, 'publish-'))
  const pathByOriginal = new Map<string, string>()
  const usedNames = new Set<string>()
  try {
    for (const original of paths) {
      let name = basename(original) || 'file'
      while (usedNames.has(name)) name = `_${name}`
      usedNames.add(name)
      const target = join(dir, name)
      await copyFile(original, target)
      pathByOriginal.set(original, target)
    }
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  return {
    pathByOriginal,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    },
  }
}
