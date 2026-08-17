/**
 * Open Agent Connect host plugin for DeepSeek Harness.
 *
 * Dual-face package: this file is the Node half (CLI bridge + fenced HTTP
 * routes). The browser half is `src/client/index.ts`. Round 2 mounts the
 * ping/health surface only; Settings sections land in later rounds.
 */
import { bootstrapHealth } from './bootstrap.js'
import { CliBridgeError, runMetabot, type MetabotCommandResult } from './cli-bridge.js'
import type { HostContext, OacDshConfig, PluginHttpRequest, PluginHttpResponse } from './context-types.js'
import { emptyHealth, type HealthPayload } from './health.js'
import { apiMethod, writeJson } from './http.js'
import { isTrustedApiRequest } from './trust-fence.js'

/** Cordis plugin name (patch id `oac-dsh`). */
export const name = 'oac-dsh'

/**
 * `agentPresets` / `llm` are consumed in later rounds; declaring them now
 * keeps composition stable. `webServer` + `webRuntime` are the trust seam.
 */
export const inject = ['webServer', 'webRuntime', 'agentPresets', 'llm']

export const API_PREFIX = '/oac/api'

const PING_TIMEOUT_MS = 15_000

function warn(ctx: HostContext, message: string): void {
  ctx.logger?.warn?.(`[oac-dsh] ${message}`)
}

async function handleWho(): Promise<MetabotCommandResult> {
  return runMetabot(['identity', 'who'], { timeoutMs: PING_TIMEOUT_MS })
}

function registerApi(ctx: HostContext, getHealth: () => HealthPayload): () => void {
  const fence = (req: PluginHttpRequest): boolean =>
    isTrustedApiRequest(req, ctx.webRuntime.trustedHosts)

  return ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (req: PluginHttpRequest, res: PluginHttpResponse) => {
      if (!fence(req)) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      const method = apiMethod(req, API_PREFIX)
      if (method === undefined) {
        writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown oac API method' } })
        return
      }
      if (method === 'health') {
        if (req.method !== 'GET' && req.method !== 'POST') {
          writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
          return
        }
        writeJson(res, 200, getHealth())
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
        return
      }
      if (method === 'who') {
        try {
          writeJson(res, 200, await handleWho())
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          writeJson(res, 500, {
            ok: false,
            state: 'failed',
            code: error instanceof CliBridgeError ? 'cli_bridge' : 'internal',
            message,
          })
        }
        return
      }
      writeJson(res, 404, { ok: false, error: { code: 'not-found', message: `unknown oac API method "${method}"` } })
    },
  })
}

/**
 * Plugin body: resolve CLI, bind skills, mount `/oac/api/*`. Failures stay on
 * the health payload — they must not take down `dsh web`.
 */
export async function apply(ctx: HostContext, config: OacDshConfig = {}): Promise<void> {
  let health: HealthPayload = emptyHealth()
  if (config.skipBootstrap) {
    health.error = 'bootstrap skipped'
  } else {
    try {
      health = await bootstrapHealth()
      if (!health.ok) warn(ctx, health.error ?? 'OAC host bootstrap incomplete')
    } catch (error) {
      health.error = error instanceof Error ? error.message : String(error)
      warn(ctx, health.error)
    }
  }
  ctx.effect(() => registerApi(ctx, () => health), 'oac-dsh: /oac/api routes')
}

export type { HealthPayload, OacDshConfig }
export { parseMetabotStdout, resolveCli, resolveMetabotCliPath, runMetabot } from './cli-bridge.js'
export { isSupportedNodeVersion, resolveNodeBinary } from './node-runtime.js'
export { isTrustedApiRequest } from './trust-fence.js'
export { bootstrapHealth } from './bootstrap.js'
