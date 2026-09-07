/**
 * Advanced-tab Bot routes: wallet/backup CLI reads, the setup-retry chain
 * write, plus the homepage upload. The upload arrives as base64 JSON from the
 * browser, is size-checked here, and is forwarded as raw bytes to the daemon's
 * on-chain inscribe route (the CLI has no homepage-upload verb). Unknown
 * methods return undefined so the caller keeps dispatching.
 */
import { runMetabot, type MetabotCommandResult } from './cli-bridge.js'
import { missing, readTrimmed, type RunFn } from './cli-payload.js'
import { daemonBotHomepageUpload } from './conversation-bridge.js'

export const HOMEPAGE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024
/** base64 inflates the file bytes ~4/3, plus JSON envelope overhead. */
export const HOMEPAGE_UPLOAD_REQUEST_MAX_BYTES = 72 * 1024 * 1024
/** Setup retry re-runs the subsidy plus chain sync; give it the write budget. */
const SETUP_RETRY_TIMEOUT_MS = 180_000

export type HomepageUploadFn = (
  slug: string,
  fileName: string,
  contentType: string,
  bytes: Buffer,
) => Promise<MetabotCommandResult | null>

function readSlug(payload: unknown): string | MetabotCommandResult {
  const slug = readTrimmed(payload, 'slug')
  if (!slug) return missing('missing_slug', 'slug is required')
  return slug
}

async function handleHomepageUpload(
  payload: unknown,
  upload: HomepageUploadFn,
): Promise<MetabotCommandResult> {
  const slug = readSlug(payload)
  if (typeof slug !== 'string') return slug
  const base64 = readTrimmed(payload, 'base64')
  if (!base64) return missing('missing_file', 'base64 file data is required')
  const fileName = readTrimmed(payload, 'fileName') || 'homepage-upload.bin'
  const contentType = readTrimmed(payload, 'contentType') || 'application/octet-stream'
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length === 0) {
    return missing('homepage_upload_empty', 'Homepage upload requires non-empty file data.')
  }
  if (bytes.length > HOMEPAGE_UPLOAD_MAX_BYTES) {
    return missing('homepage_upload_too_large', `Homepage file must be ${HOMEPAGE_UPLOAD_MAX_BYTES} bytes or smaller.`)
  }
  const result = await upload(slug, fileName, contentType, bytes)
  if (result === null) {
    return {
      ok: false,
      state: 'failed',
      code: 'daemon_unreachable',
      message: 'OAC daemon is not reachable; start it with "metabot daemon start".',
    }
  }
  return result
}

export async function dispatchBotAdvancedRoutes(
  method: string,
  payload: unknown,
  run: RunFn = runMetabot,
  upload: HomepageUploadFn = daemonBotHomepageUpload,
): Promise<MetabotCommandResult | undefined> {
  if (method === 'bots/wallet') {
    const slug = readSlug(payload)
    if (typeof slug !== 'string') return slug
    return run(['bot', 'wallet', '--from', slug])
  }
  if (method === 'bots/backup') {
    const slug = readSlug(payload)
    if (typeof slug !== 'string') return slug
    return run(['bot', 'backup', '--from', slug])
  }
  if (method === 'bots/setup-retry') {
    const slug = readSlug(payload)
    if (typeof slug !== 'string') return slug
    return run(['bot', 'setup-retry', '--from', slug], { timeoutMs: SETUP_RETRY_TIMEOUT_MS })
  }
  if (method === 'bots/homepage-upload') {
    return handleHomepageUpload(payload, upload)
  }
  return undefined
}
