import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runMetabot, type MetabotCommandResult, type RunMetabotOptions } from './cli-bridge.js'

const CHAIN_TIMEOUT_MS = 60_000

export type RunFn = (
  args: string[],
  options?: RunMetabotOptions,
) => Promise<MetabotCommandResult>

export async function runMetabotWithPayloadFile(
  argsBeforeFile: string[],
  payload: unknown,
  flag: '--payload-file' | '--request-file' = '--payload-file',
  argsAfterFile: string[] = [],
  run: RunFn = runMetabot,
  options?: { timeoutMs?: number },
): Promise<MetabotCommandResult> {
  const dir = await mkdtemp(join(tmpdir(), 'oac-dsh-payload-'))
  const path = join(dir, 'payload.json')
  await writeFile(path, JSON.stringify(payload), 'utf8')
  try {
    return await run(
      [...argsBeforeFile, flag, path, ...argsAfterFile],
      { timeoutMs: options?.timeoutMs ?? CHAIN_TIMEOUT_MS },
    )
  } finally {
    await unlink(path).catch(() => undefined)
    await rmdir(dir).catch(() => undefined)
  }
}

export function missing(code: string, message: string): MetabotCommandResult {
  return { ok: false, state: 'failed', code, message }
}

export function readTrimmed(payload: unknown, key: string): string {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return ''
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function readFrom(payload: unknown): string {
  return readTrimmed(payload, 'from')
}

export function isConfirmed(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false
  return (payload as { confirm?: unknown }).confirm === true
}

export function requireFrom(payload: unknown): string | MetabotCommandResult {
  const from = readFrom(payload)
  if (!from) return missing('missing_from', 'from is required')
  return from
}

export function requireConfirm(payload: unknown, message: string): MetabotCommandResult | undefined {
  if (isConfirmed(payload)) return undefined
  return missing('confirmation_required', message)
}
