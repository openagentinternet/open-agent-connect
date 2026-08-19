/**
 * Spawn `metabot` / `oac` and parse `MetabotCommandResult`. This plugin does
 * not reimplement identity, chain, chat, or services — it only runs the CLI.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveNodeBinary, type NodeResolution } from './node-runtime.js'

const require = createRequire(import.meta.url)
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

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

function firstExisting(paths: Array<string | undefined>): string | undefined {
  for (const candidate of paths) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Resolve the `metabot` JS entry.
 * Order: `OAC_METABOT_CLI_PATH`, published `open-agent-connect` package, sibling repo `dist/`.
 */
export function resolveMetabotCliPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return firstExisting([
    env.OAC_METABOT_CLI_PATH,
    fromNpmPackage('metabot'),
    siblingRepoCli('metabot'),
  ])
}

export function resolveOacCliPath(env: NodeJS.ProcessEnv = process.env, metabotCliPath?: string): string | undefined {
  if (env.OAC_CLI_PATH && existsSync(env.OAC_CLI_PATH)) return env.OAC_CLI_PATH
  const fromPackage = fromNpmPackage('oac')
  if (fromPackage) return fromPackage
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
  const cliPath = resolveMetabotCliPath(env)
  if (cliPath === undefined) {
    throw new CliBridgeError(
      'metabot CLI not found. Install open-agent-connect or set OAC_METABOT_CLI_PATH.',
    )
  }
  return {
    cliPath,
    oacPath: resolveOacCliPath(env, cliPath) ?? null,
    nodePath: node.path,
    nodeVersion: node.version,
  }
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
