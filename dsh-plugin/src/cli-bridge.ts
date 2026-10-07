/**
 * Spawn `metabot` / `oac` and parse `MetabotCommandResult`. This plugin does
 * not reimplement identity, chain, chat, or services — it only runs the CLI.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { npmGlobalModulesRoot, resolveNpmBinary, resolveNodeBinary, type NodeResolution } from './node-runtime.js'

const require = createRequire(import.meta.url)
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The manual fallback the Bots-page setup card shows when auto-install is impossible. */
export const RUNTIME_INSTALL_COMMAND = 'npm i -g open-agent-connect@latest'
const RUNTIME_VERSION_PROBE_TIMEOUT_MS = 10_000
const RUNTIME_INSTALL_TIMEOUT_MS = 300_000
const NPM_PERMISSION_ERROR = /EACCES|EPERM|permission denied|requires elevation/i

export type MetabotCommandState =
  | 'success'
  | 'awaiting_confirmation'
  | 'waiting'
  | 'manual_action_required'
  | 'failed'

export type MetabotCommandResult<T = unknown> = {
  ok: boolean
  state: MetabotCommandState
  code?: string
  message?: string
  data?: T
  pollAfterMs?: number
  localUiUrl?: string
}

export type CliResolution = {
  cliPath: string
  oacPath: string | null
  nodePath: string
  nodeVersion: string
}

export class CliBridgeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliBridgeError'
  }
}

function pluginPackageRoot(): string {
  return PACKAGE_ROOT
}

function siblingRepoCli(kind: 'metabot' | 'oac'): string {
  const distName = kind === 'metabot' ? 'cli' : 'oac'
  return join(pluginPackageRoot(), '..', 'dist', distName, 'main.js')
}

function fromNpmPackage(kind: 'metabot' | 'oac'): string | undefined {
  try {
    const pkgJson = require.resolve('open-agent-connect/package.json')
    const distName = kind === 'metabot' ? 'cli' : 'oac'
    const candidate = join(dirname(pkgJson), 'dist', distName, 'main.js')
    return existsSync(candidate) ? candidate : undefined
  } catch {
    return undefined
  }
}

/**
 * The `npm i -g open-agent-connect` install location for one node binary
 * (`<node bin dir>/../lib/node_modules`, npm's own layout). This is how a
 * runtime installed from the Bots-page setup card (or a plain global install
 * with no adjacent node_modules copy) becomes resolvable.
 */
export function npmGlobalPackageCli(kind: 'metabot' | 'oac', nodePath: string | undefined): string | undefined {
  if (nodePath === undefined) return undefined
  const distName = kind === 'metabot' ? 'cli' : 'oac'
  const candidate = join(npmGlobalModulesRoot(nodePath), 'open-agent-connect', 'dist', distName, 'main.js')
  return existsSync(candidate) ? candidate : undefined
}

function firstExisting(paths: Array<string | undefined>): string | undefined {
  for (const candidate of paths) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Resolve the `metabot` JS entry.
 * Order: `OAC_METABOT_CLI_PATH`, published `open-agent-connect` package,
 * the npm global root of the resolved node, sibling repo `dist/`.
 */
export function resolveMetabotCliPath(
  env: NodeJS.ProcessEnv = process.env,
  nodePath?: string,
): string | undefined {
  return firstExisting([
    env.OAC_METABOT_CLI_PATH,
    fromNpmPackage('metabot'),
    npmGlobalPackageCli('metabot', nodePath),
    siblingRepoCli('metabot'),
  ])
}

export function resolveOacCliPath(
  env: NodeJS.ProcessEnv = process.env,
  nodePath?: string,
  metabotCliPath?: string,
): string | undefined {
  if (env.OAC_CLI_PATH && existsSync(env.OAC_CLI_PATH)) return env.OAC_CLI_PATH
  const fromPackage = fromNpmPackage('oac')
  if (fromPackage) return fromPackage
  const globalRoot = npmGlobalPackageCli('oac', nodePath)
  if (globalRoot) return globalRoot
  const sibling = siblingRepoCli('oac')
  if (existsSync(sibling)) return sibling
  if (metabotCliPath) {
    const beside = join(dirname(metabotCliPath), '..', 'oac', 'main.js')
    if (existsSync(beside)) return beside
  }
  return undefined
}

export function resolveCli(
  env: NodeJS.ProcessEnv = process.env,
  node: NodeResolution = resolveNodeBinary(env),
): CliResolution {
  if (!node.ok) {
    throw new CliBridgeError(node.error)
  }
  const cliPath = resolveMetabotCliPath(env, node.path)
  if (cliPath === undefined) {
    throw new CliBridgeError(
      'metabot CLI not found. Install open-agent-connect or set OAC_METABOT_CLI_PATH.',
    )
  }
  return {
    cliPath,
    oacPath: resolveOacCliPath(env, node.path, cliPath) ?? null,
    nodePath: node.path,
    nodeVersion: node.version,
  }
}

// ── First-run runtime check + guided install ────────────────────────────────

/** Numeric dotted-version compare: negative when `a` < `b`, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] => value
    .split('-')[0]!.split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isInteger(part) ? part : 0))
  const left = parse(a)
  const right = parse(b)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

let cachedPluginVersion: string | undefined

/** The plugin's own package version — the runtime's minimum required version. */
export function pluginVersion(): string {
  if (cachedPluginVersion === undefined) {
    try {
      const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version?: unknown }
      cachedPluginVersion = typeof pkg.version === 'string' ? pkg.version : '0.0.0'
    } catch {
      cachedPluginVersion = '0.0.0'
    }
  }
  return cachedPluginVersion
}

const runtimeVersionCache = new Map<string, string | null>()

/** Drop the memoized runtime versions (after a guided install changed the runtime). */
export function resetRuntimeVersionCache(): void {
  runtimeVersionCache.clear()
}

function readPackageJsonVersion(pkgJsonPath: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { version?: unknown }
    return typeof pkg.version === 'string' && pkg.version.trim() !== '' ? pkg.version : null
  } catch {
    return null
  }
}

function probeCliVersion(cliPath: string, nodePath: string): string | null {
  const result = spawnSync(nodePath, [cliPath, '--version', '--json'], {
    encoding: 'utf8',
    timeout: RUNTIME_VERSION_PROBE_TIMEOUT_MS,
  })
  if (result.status !== 0 || !result.stdout) return null
  try {
    const parsed = JSON.parse(result.stdout) as { version?: unknown }
    return typeof parsed.version === 'string' && parsed.version.trim() !== '' ? parsed.version : null
  } catch {
    return null
  }
}

/**
 * Read the installed runtime's version for one CLI entry. Fast path: the
 * package.json two levels up from `dist/cli/main.js` (both the npm package
 * and the repo checkout ship it). Slow path (custom `OAC_METABOT_CLI_PATH`
 * layouts): one `--version --json` probe. Memoized per CLI path so the
 * version never probes on ordinary CLI calls.
 */
function defaultReadRuntimeVersion(cliPath: string, nodePath: string | null): string | null {
  if (runtimeVersionCache.has(cliPath)) return runtimeVersionCache.get(cliPath) ?? null
  let version = readPackageJsonVersion(join(dirname(cliPath), '..', '..', 'package.json'))
  if (version === null && nodePath !== null) version = probeCliVersion(cliPath, nodePath)
  runtimeVersionCache.set(cliPath, version)
  return version
}

export type RuntimeCheckStatus =
  | 'ok'
  /** No runnable metabot CLI anywhere; npm is available for a guided install. */
  | 'missing'
  /** CLI present but older than the plugin; npm is available for a guided upgrade. */
  | 'stale'
  /** No npm next to the resolved node (or no supported node at all) — manual install only. */
  | 'npm_unavailable'

/** Structured first-run probe result; never throws. */
export type RuntimeCheck = {
  status: RuntimeCheckStatus
  cliPath: string | null
  oacPath: string | null
  nodePath: string | null
  nodeVersion: string | null
  npmPath: string | null
  runtimeVersion: string | null
  requiredVersion: string
  installCommand: string
  error?: string
}

export type CheckRuntimeDeps = {
  env?: NodeJS.ProcessEnv
  node?: NodeResolution
  /** `undefined` (the key absent) means "resolve normally"; inject `undefined` value to force missing. */
  cliPath?: string | undefined
  npmPath?: string | undefined
  readVersion?: (cliPath: string, nodePath: string | null) => string | null
}

const CLI_NOT_FOUND_ERROR = 'metabot CLI not found. Install open-agent-connect or set OAC_METABOT_CLI_PATH.'
const NPM_NOT_FOUND_ERROR = 'npm was not found next to the resolved Node binary. Install npm, or run the install command in a terminal.'

/**
 * One structured probe of the OAC runtime environment: node, npm, CLI path,
 * and the runtime-vs-plugin version comparison. The setup card and the
 * bootstrap error path consume this instead of catching CliBridgeError.
 */
export function checkRuntime(deps: CheckRuntimeDeps = {}): RuntimeCheck {
  const env = deps.env ?? process.env
  const node = deps.node ?? resolveNodeBinary(env)
  const nodePath = node.ok ? node.path : null
  const nodeVersion = node.ok ? node.version : null
  const cliPath = 'cliPath' in deps ? deps.cliPath : resolveMetabotCliPath(env, nodePath ?? undefined)
  const oacPath = cliPath === undefined
    ? null
    : resolveOacCliPath(env, nodePath ?? undefined, cliPath) ?? null
  const npmPath = 'npmPath' in deps ? deps.npmPath : resolveNpmBinary(env, node)
  const requiredVersion = pluginVersion()
  const base = {
    cliPath: cliPath ?? null,
    oacPath,
    nodePath,
    nodeVersion,
    npmPath: npmPath ?? null,
    runtimeVersion: null as string | null,
    requiredVersion,
    installCommand: RUNTIME_INSTALL_COMMAND,
  }
  if (!node.ok) {
    // Without a supported node nothing runs and npm cannot be located either.
    return { ...base, status: 'npm_unavailable', error: node.error }
  }
  if (cliPath === undefined) {
    return npmPath
      ? { ...base, status: 'missing', error: CLI_NOT_FOUND_ERROR }
      : { ...base, status: 'npm_unavailable', error: NPM_NOT_FOUND_ERROR }
  }
  const readVersion = deps.readVersion ?? defaultReadRuntimeVersion
  const runtimeVersion = readVersion(cliPath, nodePath)
  if (runtimeVersion !== null && compareVersions(runtimeVersion, requiredVersion) < 0) {
    const versionError = `open-agent-connect ${runtimeVersion} is older than this plugin (${requiredVersion}); upgrade the runtime.`
    return npmPath
      ? { ...base, status: 'stale', runtimeVersion, error: versionError }
      : { ...base, status: 'npm_unavailable', runtimeVersion, error: `${versionError} ${NPM_NOT_FOUND_ERROR}` }
  }
  // Unknown version (custom layout that neither ships package.json nor
  // answers --version): never block the user behind a setup card for it.
  return { ...base, status: 'ok', runtimeVersion }
}

export type RuntimeInstallResult = {
  ok: boolean
  /** True when npm failed on an EPERM/EACCES-class error — the manual command is the path forward. */
  permission: boolean
  message: string
  command: string
  /** Fresh post-install check on success paths, the pre-check otherwise. */
  check: RuntimeCheck
}

export type InstallRuntimeDeps = {
  env?: NodeJS.ProcessEnv
  check?: () => RuntimeCheck
  spawnNpm?: (npmPath: string, env: NodeJS.ProcessEnv) => Promise<{ code: number; stdout: string; stderr: string }>
}

async function defaultSpawnNpm(
  npmPath: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // Windows npm shims (.cmd/.exe) are not directly spawnable — they need a shell.
    const needsShell = /\.(cmd|exe)$/i.test(npmPath)
    const child = needsShell
      ? spawn(npmPath, ['install', '-g', 'open-agent-connect@latest'], { env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn(npmPath, ['install', '-g', 'open-agent-connect@latest'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { stdout += chunk })
    child.stderr?.on('data', (chunk: string) => { stderr += chunk })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new CliBridgeError(`npm install timed out after ${RUNTIME_INSTALL_TIMEOUT_MS}ms`))
    }, RUNTIME_INSTALL_TIMEOUT_MS)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new CliBridgeError(error.message))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

/**
 * Run the guided runtime install (`npm i -g open-agent-connect@latest`) and
 * re-check. Only ever called from the setup card's explicit button click —
 * a global npm install is a sensitive change to the user's machine and is
 * never done silently.
 */
export async function installRuntime(deps: InstallRuntimeDeps = {}): Promise<RuntimeInstallResult> {
  const env = deps.env ?? process.env
  // `check` serves both the pre-check and the post-install re-check.
  const runCheck = (): RuntimeCheck => deps.check?.() ?? checkRuntime({ env })
  const check = runCheck()
  if (check.status === 'ok') {
    return { ok: true, permission: false, message: 'runtime already installed', command: RUNTIME_INSTALL_COMMAND, check }
  }
  if (check.npmPath === null) {
    return {
      ok: false,
      permission: false,
      message: check.error ?? NPM_NOT_FOUND_ERROR,
      command: RUNTIME_INSTALL_COMMAND,
      check,
    }
  }
  const spawnNpm = deps.spawnNpm ?? defaultSpawnNpm
  let outcome: { code: number; stdout: string; stderr: string }
  try {
    outcome = await spawnNpm(check.npmPath, env)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, permission: false, message, command: RUNTIME_INSTALL_COMMAND, check }
  }
  if (outcome.code !== 0) {
    const detail = (outcome.stderr.trim() || outcome.stdout.trim()).slice(-400)
    return {
      ok: false,
      permission: NPM_PERMISSION_ERROR.test(outcome.stderr) || NPM_PERMISSION_ERROR.test(outcome.stdout),
      message: detail !== '' ? `npm exited with ${outcome.code}: ${detail}` : `npm exited with ${outcome.code}.`,
      command: RUNTIME_INSTALL_COMMAND,
      check,
    }
  }
  resetRuntimeVersionCache()
  const post = runCheck()
  if (post.status !== 'ok') {
    return {
      ok: false,
      permission: false,
      message: post.error ?? `npm finished but the runtime still reports "${post.status}".`,
      command: RUNTIME_INSTALL_COMMAND,
      check: post,
    }
  }
  return { ok: true, permission: false, message: 'runtime installed', command: RUNTIME_INSTALL_COMMAND, check: post }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCommandState(value: unknown): value is MetabotCommandState {
  return value === 'success'
    || value === 'awaiting_confirmation'
    || value === 'waiting'
    || value === 'manual_action_required'
    || value === 'failed'
}

export function parseMetabotStdout(stdout: string): MetabotCommandResult {
  const text = stdout.trim()
  const tryParse = (raw: string): unknown => JSON.parse(raw) as unknown
  let parsed: unknown
  try {
    parsed = tryParse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) {
      throw new CliBridgeError(`metabot did not return JSON: ${text.slice(0, 240)}`)
    }
    try {
      parsed = tryParse(text.slice(start, end + 1))
    } catch {
      throw new CliBridgeError(`metabot did not return JSON: ${text.slice(0, 240)}`)
    }
  }
  if (!isRecord(parsed) || typeof parsed.ok !== 'boolean' || !isCommandState(parsed.state)) {
    throw new CliBridgeError('metabot output is not a MetabotCommandResult')
  }
  return parsed as MetabotCommandResult
}

export type RunMetabotOptions = {
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
  resolution?: CliResolution
  entry?: 'metabot' | 'oac'
}

function spawnCli(
  nodePath: string,
  scriptPath: string,
  args: string[],
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(nodePath, [scriptPath, ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new CliBridgeError(`metabot timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new CliBridgeError(error.message))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: code ?? 1 })
    })
  })
}

/**
 * Run one CLI command and parse the JSON envelope. Non-zero exit is fine when
 * stdout is still a `MetabotCommandResult` (failed / waiting states).
 */
export async function runMetabot(
  args: string[],
  options: RunMetabotOptions = {},
): Promise<MetabotCommandResult> {
  const env = options.env ?? process.env
  const resolution = options.resolution ?? resolveCli(env)
  const entry = options.entry ?? 'metabot'
  const scriptPath = entry === 'oac' ? resolution.oacPath : resolution.cliPath
  if (scriptPath === null || scriptPath === undefined) {
    throw new CliBridgeError(`${entry} CLI not found`)
  }
  const timeoutMs = options.timeoutMs ?? 30_000
  const { stdout, stderr } = await spawnCli(
    resolution.nodePath,
    scriptPath,
    args,
    timeoutMs,
    env,
  )
  try {
    return parseMetabotStdout(stdout)
  } catch (error) {
    const detail = stderr.trim() ? ` stderr: ${stderr.trim().slice(0, 400)}` : ''
    if (error instanceof CliBridgeError) {
      throw new CliBridgeError(`${error.message}${detail}`)
    }
    throw error
  }
}
