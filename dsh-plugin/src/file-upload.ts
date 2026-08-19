/**
 * MetaApp asset upload: write the raw bytes to a temp file and hand them to
 * `metabot file upload-large`, which returns the metafile reference. The host
 * process is the only one that talks to the CLI, so raw browser bytes never
 * reach it directly.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  const id = Math.random().toString(36).slice(2, 10)
  const dir = await mkdtemp(join(tmpdir(), `oac-dsh-upload-${id}-`))
  const path = join(dir, 'upload.bin')
  await writeFile(path, bytes)
  try {
    const args = ['file', 'upload-large', '--from', from, '--file', path]
    if (contentType.trim() !== '') args.push('--content-type', contentType.trim())
    return await run(args, { timeoutMs: UPLOAD_TIMEOUT_MS })
  } finally {
    await rm(path, { force: true }).catch(() => undefined)
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
