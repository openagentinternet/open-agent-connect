'use strict'

/**
 * Shared runtime for the OAC-on-DSH tool plugins.
 *
 * Every OAC CLI command emits a `MetabotCommandResult<T>` as pretty-printed
 * JSON on stdout (see `src/cli/main.ts` — `writeJsonLine`), so a plugin only
 * needs to spawn `node <repo>/dist/cli/main.js <args>` with piped stdio and
 * parse the final JSON document. The CLI auto-starts the local MetaBot daemon
 * when a command needs it, so a single spawn is a complete, independent unit
 * of work.
 *
 * This module is a plain CommonJS helper shared by the domain plugins via
 * relative `require`. It intentionally imports nothing outside Node builtins,
 * so the plugin files stay self-contained and loadable by the DSH preset
 * loader from any location.
 */

const { spawnSync } = require('node:child_process')
const { writeFileSync, rmSync, mkdtempSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const DEFAULT_TIMEOUT_MS = 120000
const MAX_BUFFER_BYTES = 32 * 1024 * 1024

/** Resolve the metabot CLI entry script path from config or environment. */
function resolveCliPath(config) {
  const explicit = config && config.cliPath ? config.cliPath : process.env.OAC_METABOT_CLI_PATH
  if (explicit) return explicit
  throw new Error(
    'metabot CLI path is not configured: run `node dsh/install.mjs` (writes config.cliPath) '
    + 'or export OAC_METABOT_CLI_PATH pointing at <repo>/dist/cli/main.js',
  )
}

/**
 * Spawn the metabot CLI once and return its parsed `MetabotCommandResult`.
 *
 * @param {object} config - plugin config (`cliPath`, `nodePath`, `defaultTimeoutMs`, optional `env`).
 * @param {string[]} args - CLI arguments after the command name, e.g. `['identity', 'who']`.
 * @param {object} [options]
 * @param {number} [options.timeoutMs] - per-call timeout override.
 * @param {string} [options.cwd] - spawn working directory (defaults to the process cwd).
 * @returns {Promise<{ result: object, exitCode: number, rawStdout: string, rawStderr: string, error?: string }>}
 */
async function runMetabot(config, args, options = {}) {
  const nodePath = config && config.nodePath ? config.nodePath : process.execPath
  const cliPath = resolveCliPath(config)
  const timeoutMs = options.timeoutMs
    ?? (config && config.defaultTimeoutMs)
    ?? DEFAULT_TIMEOUT_MS
  const env = { ...process.env, ...(config && config.env ? config.env : {}) }

  const outcome = {
    result: null,
    exitCode: 0,
    rawStdout: '',
    rawStderr: '',
    error: undefined,
  }

  let spawned
  try {
    spawned = spawnSync(nodePath, [cliPath, ...args], {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER_BYTES,
      timeout: timeoutMs,
      cwd: options.cwd,
      env,
    })
  } catch (error) {
    outcome.error = `failed to spawn metabot CLI: ${error instanceof Error ? error.message : String(error)}`
    return outcome
  }

  outcome.exitCode = spawned.status === null ? -1 : spawned.status
  outcome.rawStdout = typeof spawned.stdout === 'string' ? spawned.stdout : ''
  outcome.rawStderr = typeof spawned.stderr === 'string' ? spawned.stderr : ''

  if (spawned.error !== undefined) {
    // A missing/bogus CLI path surfaces as a module error inside node or an
    // ENOENT; a timeout arrives as ETIMEDOUT with a null status. Both are
    // reported distinctly so the model can act on the real cause.
    if (spawned.error.code === 'ETIMEDOUT' || (spawned.status === null && spawned.signal === null)) {
      outcome.error = `metabot CLI timed out after ${timeoutMs}ms`
    } else {
      outcome.error = `failed to run metabot CLI: ${spawned.error.message}`
    }
    return outcome
  }
  if (spawned.signal !== null || outcome.exitCode === -1) {
    outcome.error = `metabot CLI was killed (signal ${spawned.signal ?? 'unknown'})`
    return outcome
  }

  outcome.result = parseCliResult(outcome.rawStdout, outcome.rawStderr)
  return outcome
}

/**
 * Parse the final JSON document from CLI stdout. The CLI always prints the
 * `MetabotCommandResult` object at the end; a few paths (daemon startup
 * warnings) may precede it on stderr only. When the tail is not JSON, the
 * raw text is surfaced so the model still sees the failure detail.
 */
function parseCliResult(stdout, stderr) {
  const text = typeof stdout === 'string' ? stdout.trim() : ''
  if (!text) {
    return {
      ok: false,
      state: 'failed',
      code: 'no_stdout',
      message: `metabot CLI produced no stdout${stderr ? `; stderr: ${stderr.trim().slice(0, 500)}` : ''}`,
    }
  }
  try {
    return JSON.parse(text)
  } catch {
    return {
      ok: false,
      state: 'failed',
      code: 'unparseable_output',
      message: `metabot CLI stdout was not JSON: ${text.slice(0, 500)}${text.length > 500 ? '…' : ''}`,
    }
  }
}

/**
 * Write a JSON request file for the CLI commands that consume `--request-file`
 * / `--payload-file` / `--manifest-file`, run `work` with the path, then
 * remove it.
 */
async function withRequestFile(payload, work) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oac-dsh-'))
  const filePath = path.join(dir, 'request.json')
  writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
  try {
    return await work(filePath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Build a request-file style command tail, e.g. `['--request-file', filePath]`. */
function requestFileArgs(flag, filePath) {
  return [flag, filePath]
}

/**
 * Compile the author-facing parameter map (the same implicit form the harness
 * tools use) into the raw JSON Schema object the model sees in the catalog.
 * Supported per-property keys: type, description, enum, required.
 */
function compileParameters(spec) {
  const properties = {}
  const required = []
  for (const [key, prop] of Object.entries(spec || {})) {
    if (prop === null || typeof prop !== 'object') continue
    const node = { type: prop.type || 'string' }
    if (typeof prop.description === 'string') node.description = prop.description
    if (Array.isArray(prop.enum)) node.enum = prop.enum
    if (prop.const !== undefined) node.const = prop.const
    properties[key] = node
    if (prop.required === true) required.push(key)
  }
  const schema = { type: 'object', properties }
  if (required.length > 0) schema.required = required
  return schema
}

/**
 * Validate required string/number fields manually (plain-object tools are not
 * wrapped by the harness `defineTool` validator).
 * @returns {string[]} human-readable violations; empty when valid.
 */
function validateRequiredArgs(args, spec) {
  const violations = []
  for (const [key, prop] of Object.entries(spec || {})) {
    if (prop.required !== true) continue
    const value = args ? args[key] : undefined
    if (value === undefined || value === null || value === '') {
      violations.push(`${key} is required`)
    }
  }
  return violations
}

/**
 * Shared renderer: present the canonical metabot result as compact text.
 * The full parsed `MetabotCommandResult` object is what the model reads; the
 * render only shapes the UI card.
 */
function renderMetabotResult(args, value) {
  const summary = []
  if (value && typeof value === 'object') {
    const state = String(value.state || 'unknown')
    if (value.ok === true) {
      summary.push(`metabot: ${state}`)
    } else {
      summary.push(`metabot: ${state}${value.code ? ` (${value.code})` : ''}${value.message ? ` — ${value.message}` : ''}`)
    }
  } else {
    summary.push(`metabot: ${JSON.stringify(value)}`)
  }
  return [{ type: 'text', text: summary.join('\n') }]
}

/**
 * Build one model tool: validates required args, runs the CLI, normalizes the
 * outcome into a stable shape the model can act on, and renders a card.
 *
 * Normalized outcome:
 *   { ok, state, code?, message?, data?, rawStdout?, error? }
 *   - `error` is set for spawn-level failures (missing CLI, kill, timeout).
 *   - `ok === false` keeps `state`/`code`/`message` from the CLI result so the
 *     model can distinguish `failed` from `waiting`/`manual_action_required`.
 */
function defineMetabotTool(registrar, options) {
  const definition = {
    name: options.name,
    description: options.description,
    parameters: compileParameters(options.parameters),
    timeoutMs: options.timeoutMs,
    execute: async (args, exec) => {
      const violations = validateRequiredArgs(args, options.parameters)
      if (violations.length > 0) {
        throw new Error(`invalid arguments: ${violations.join('; ')}`)
      }
      // `buildArgs` may be async when the tool must materialize a request file.
      const argv = await options.buildArgs(args)
      const { result, exitCode, rawStdout, rawStderr, error } = await runMetabot(
        registrar.config,
        argv,
        { timeoutMs: options.timeoutMs },
      )
      if (error !== undefined) {
        return {
          ok: false,
          state: 'failed',
          code: 'spawn_error',
          message: error,
          rawStderr: rawStderr ? rawStderr.slice(0, 2000) : undefined,
        }
      }
      const normalized = normalizeResult(result)
      normalized.exitCode = exitCode
      if (!normalized.ok && !normalized.rawStdout) {
        normalized.rawStdout = rawStdout
      }
      if (rawStderr) normalized.rawStderr = rawStderr.slice(0, 2000)
      return normalized
    },
  }
  // Register and hand back the definition (its execute/output are the live
  // callable surface; the registry owns disposal through the plugin fiber).
  registrar.define(definition)
  return definition
}

/** Project a parsed `MetabotCommandResult` into the model-facing shape. */
function normalizeResult(result) {
  if (result === null || typeof result !== 'object') {
    return { ok: false, state: 'failed', code: 'bad_result', message: 'CLI returned no usable result object' }
  }
  const out = { ok: result.ok === true }
  if (result.state !== undefined) out.state = result.state
  if (result.code !== undefined) out.code = result.code
  if (result.message !== undefined) out.message = result.message
  if (result.data !== undefined) out.data = result.data
  if (result.localUiUrl !== undefined) out.localUiUrl = result.localUiUrl
  if (result.pollAfterMs !== undefined) out.pollAfterMs = result.pollAfterMs
  return out
}

/**
 * Create the shared tool-registration helper for one plugin.
 * `ctx.tools` is resolved lazily inside `define` so plugins may be applied
 * before the host registry becomes visible.
 */
function createRegistrar(ctx, config) {
  const registered = []
  return {
    config,
    /** Register one plain-object tool via the host `tools` registry. */
    define(definition) {
      const tools = ctx.get('tools')
      if (tools === undefined) {
        throw new Error('tools service unavailable: load @deepseek-ai/dsh-tools on the host plane')
      }
      const disposer = tools.register({
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
        timeoutMs: definition.timeoutMs,
        output: {
          schema: {},
          render: renderMetabotResult,
        },
        execute: definition.execute,
      })
      registered.push(disposer)
      return disposer
    },
    /** Dispose every registered tool (used when the plugin fiber is torn down). */
    dispose() {
      for (const disposer of registered) disposer()
      registered.length = 0
    },
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  runMetabot,
  parseCliResult,
  withRequestFile,
  requestFileArgs,
  compileParameters,
  validateRequiredArgs,
  renderMetabotResult,
  normalizeResult,
  defineMetabotTool,
  createRegistrar,
}
