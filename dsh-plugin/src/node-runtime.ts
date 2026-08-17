/**
 * Resolve a Node binary that can run the OAC CLI (`>=20 <25`) and the
 * `metabot` / `oac` JS entries. DSH's own process may be on another Node;
 * spawn the CLI with a supported binary or fail loud in health, never crash DSH.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const OAC_NODE_MAJOR_MIN = 20
export const OAC_NODE_MAJOR_MAX_EXCLUSIVE = 25

export type NodeResolution =
  | { ok: true; path: string; version: string }
  | { ok: false; error: string }

export function isSupportedNodeVersion(version: string): boolean {
  const major = Number.parseInt(version.replace(/^v/i, '').split('.')[0] ?? '', 10)
  return Number.isInteger(major)
    && major >= OAC_NODE_MAJOR_MIN
    && major < OAC_NODE_MAJOR_MAX_EXCLUSIVE
}

function readNodeVersion(nodePath: string): string | undefined {
  if (nodePath === process.execPath) return process.version
  const result = spawnSync(nodePath, ['-v'], { encoding: 'utf8' })
  if (result.status !== 0) return undefined
  const version = (result.stdout || result.stderr).trim()
  return version.startsWith('v') ? version : undefined
}

function nvmNodeBinaries(nvmDir: string): string[] {
  const versionsRoot = join(nvmDir, 'versions', 'node')
  let names: string[]
  try {
    names = readdirSync(versionsRoot)
  } catch {
    return []
  }
  return names
    .filter((name) => isSupportedNodeVersion(name))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((name) => join(versionsRoot, name, 'bin', 'node'))
}

/**
 * Pick a Node binary in OAC's supported range.
 * Override: `OAC_NODE_PATH`.
 */
export function resolveNodeBinary(
  env: NodeJS.ProcessEnv = process.env,
  readVersion: (nodePath: string) => string | undefined = readNodeVersion,
): NodeResolution {
  const nvmDir = env.NVM_DIR ?? join(homedir(), '.nvm')
  const candidates: string[] = []
  if (env.OAC_NODE_PATH) candidates.push(env.OAC_NODE_PATH)
  candidates.push(process.execPath)
  candidates.push(...nvmNodeBinaries(nvmDir))

  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (seen.has(candidate) || !existsSync(candidate)) continue
    seen.add(candidate)
    const version = readVersion(candidate)
    if (version !== undefined && isSupportedNodeVersion(version)) {
      return { ok: true, path: candidate, version }
    }
  }

  return {
    ok: false,
    error: `No Node.js >=${OAC_NODE_MAJOR_MIN} <${OAC_NODE_MAJOR_MAX_EXCLUSIVE} found. Set OAC_NODE_PATH to a supported binary.`,
  }
}
