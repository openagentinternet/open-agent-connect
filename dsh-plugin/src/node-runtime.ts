/**
 * Resolve a Node binary that can run the OAC CLI (`>=20 <25`) and the
 * `metabot` / `oac` JS entries. DSH's own process may be on another Node;
 * spawn the CLI with a supported binary or fail loud in health, never crash DSH.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const OAC_NODE_MAJOR_MIN = 20
export const OAC_NODE_MAJOR_MAX_EXCLUSIVE = 25

export type NodeResolution =
  | { ok: true; path: string; version: string; spawnEnv?: Record<string, string> }
  | { ok: false; error: string }

/** One probeable node binary. `env`/`versionHint` cover the Electron case. */
export type NodeCandidate = {
  path: string
  /** Extra child env required to run this binary as plain Node (Electron's ELECTRON_RUN_AS_NODE). */
  env?: Record<string, string>
  /** Version the host already knows in-process, so the probe never spawns. */
  versionHint?: string
}

export function isSupportedNodeVersion(version: string): boolean {
  const major = Number.parseInt(version.replace(/^v/i, '').split('.')[0] ?? '', 10)
  return Number.isInteger(major)
    && major >= OAC_NODE_MAJOR_MIN
    && major < OAC_NODE_MAJOR_MAX_EXCLUSIVE
}

function readNodeVersion(candidate: NodeCandidate): string | undefined {
  if (candidate.versionHint) return candidate.versionHint
  if (candidate.path === process.execPath && !candidate.env) return process.version
  const result = spawnSync(candidate.path, ['-v'], {
    encoding: 'utf8',
    env: { ...process.env, ...candidate.env },
  })
  if (result.status !== 0) return undefined
  const version = (result.stdout || result.stderr).trim()
  return version.startsWith('v') ? version : undefined
}

function nvmNodeBinaries(nvmDir: string): NodeCandidate[] {
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
    .map((name) => ({ path: join(versionsRoot, name, 'bin', 'node') }))
}

/**
 * Node candidate binaries in probe order: `OAC_NODE_PATH`, `process.execPath`
 * (plain-Node hosts), nvm-installed nodes, then — on Electron hosts only —
 * `process.execPath` again with `ELECTRON_RUN_AS_NODE=1`: that mode turns the
 * app binary into a plain Node runtime (the DSH desktop app embeds a Node
 * inside the supported range), so a machine with NO system node still runs
 * the CLI. Last because a real node binary spawns lighter than Electron.
 */
export function nodeCandidates(
  env: NodeJS.ProcessEnv,
  nvmDir: string,
  execPath: string,
  electronHost: boolean,
  embeddedNodeVersion?: string,
): NodeCandidate[] {
  const candidates: NodeCandidate[] = []
  if (env.OAC_NODE_PATH) candidates.push({ path: env.OAC_NODE_PATH })
  // Inside Electron (desktop host) process.execPath is the Electron binary:
  // without ELECTRON_RUN_AS_NODE spawning it boots a second app instance
  // instead of running a plain Node script, so the direct candidate stays
  // plain-Node-hosts-only.
  if (!electronHost) candidates.push({ path: execPath })
  candidates.push(...nvmNodeBinaries(nvmDir))
  if (electronHost && embeddedNodeVersion !== undefined && isSupportedNodeVersion(embeddedNodeVersion)) {
    candidates.push({ path: execPath, env: { ELECTRON_RUN_AS_NODE: '1' }, versionHint: embeddedNodeVersion })
  }
  return candidates
}

/**
 * Pick a Node binary in OAC's supported range.
 * Override: `OAC_NODE_PATH`.
 */
export function resolveNodeBinary(
  env: NodeJS.ProcessEnv = process.env,
  readVersion: (candidate: NodeCandidate) => string | undefined = readNodeVersion,
): NodeResolution {
  const nvmDir = env.NVM_DIR ?? join(homedir(), '.nvm')
  const electronHost = (process.versions as NodeJS.ProcessVersions).electron !== undefined
  const embeddedNodeVersion = electronHost ? process.versions.node : undefined
  const candidates = nodeCandidates(env, nvmDir, process.execPath, electronHost, embeddedNodeVersion)

  const seen = new Set<string>()
  for (const candidate of candidates) {
    const key = `${candidate.path}:${candidate.env ? JSON.stringify(candidate.env) : ''}`
    if (seen.has(key) || !existsSync(candidate.path)) continue
    seen.add(key)
    const version = readVersion(candidate)
    if (version !== undefined && isSupportedNodeVersion(version)) {
      return {
        ok: true,
        path: candidate.path,
        version,
        ...(candidate.env ? { spawnEnv: candidate.env } : {}),
      }
    }
  }

  return {
    ok: false,
    error: `No Node.js >=${OAC_NODE_MAJOR_MIN} <${OAC_NODE_MAJOR_MAX_EXCLUSIVE} found. Set OAC_NODE_PATH to a supported binary.`,
  }
}

/** npm-global `node_modules` root for one node binary's prefix (npm root -g, without spawning npm). */
export function npmGlobalModulesRoot(nodePath: string): string {
  const prefix = join(dirname(nodePath), '..')
  // Windows installs global packages straight into <prefix>\node_modules;
  // POSIX layouts (nvm, Homebrew, system) use <prefix>/lib/node_modules.
  return process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules')
}

/**
 * Node binary paths for npm-global-root PATH DISCOVERY ONLY (any version):
 * an out-of-range node's install still tells us where the OAC package lives,
 * even though we would never spawn it. Includes every nvm version.
 */
export function discoveryNodePaths(
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
): string[] {
  const nvmDir = env.NVM_DIR ?? join(homedir(), '.nvm')
  const resolved = resolveNodeBinary(env)
  const versionsRoot = join(nvmDir, 'versions', 'node')
  let nvmNames: string[] = []
  try {
    nvmNames = readdirSync(versionsRoot).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  } catch {
    nvmNames = []
  }
  return [
    ...(resolved.ok ? [resolved.path] : []),
    execPath,
    ...nvmNames.map((name) => join(versionsRoot, name, 'bin', 'node')),
  ]
}

/**
 * Well-known npm-global roots that no discovered node binary derives:
 * `process.execPath` is a realpath, so a Homebrew node yields its Cellar
 * prefix while `npm i -g` installs into the brew prefix proper; Windows
 * npm installs into %APPDATA%\npm. existsSync filters the misses — the
 * caller only needs candidate paths.
 */
export function wellKnownNpmGlobalRoots(): string[] {
  if (process.platform === 'win32') {
    return process.env.APPDATA ? [join(process.env.APPDATA, 'npm', 'node_modules')] : []
  }
  return [
    '/usr/local/lib/node_modules',
    '/opt/homebrew/lib/node_modules',
    '/usr/lib/node_modules',
  ]
}

/**
 * Locate the `npm` binary that pairs with a resolved Node (same bin dir).
 * Override: `OAC_NPM_PATH`. Windows `npm.cmd` shims need a shell spawn.
 */
export function resolveNpmBinary(
  env: NodeJS.ProcessEnv,
  node: NodeResolution,
): string | undefined {
  if (env.OAC_NPM_PATH && existsSync(env.OAC_NPM_PATH)) return env.OAC_NPM_PATH
  if (!node.ok) return undefined
  const binDir = dirname(node.path)
  const names = process.platform === 'win32' ? ['npm.cmd', 'npm.exe', 'npm'] : ['npm']
  for (const name of names) {
    const candidate = join(binDir, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}
