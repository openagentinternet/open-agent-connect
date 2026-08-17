/**
 * Open Agent Connect host plugin for DeepSeek Harness.
 *
 * Dual-face package: this file is the Node half (CLI bridge + fenced HTTP
 * routes). The browser half is `src/client/index.ts`.
 */
import { bootstrapHealth } from './bootstrap.js'
import { createBot, deleteBot, listLlmDirectory, updateBot } from './bots.js'
import { CliBridgeError, runMetabot, type MetabotCommandResult } from './cli-bridge.js'
import type { HostContext, OacDshConfig, PluginHttpRequest, PluginHttpResponse } from './context-types.js'
import { emptyHealth, type HealthPayload } from './health.js'
import { apiMethod, readJsonBody, writeJson } from './http.js'
import { reconcilePresets } from './preset.js'
import { isTrustedApiRequest } from './trust-fence.js'

/** Cordis plugin name (patch id `oac-dsh`). */
export const name = 'oac-dsh'

/**
 * `agentPresets` and `llm` are required. `webServer` + `webRuntime` are the trust seam.
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

async function dispatchPost(
  ctx: HostContext,
  method: string,
  payload: unknown,
): Promise<MetabotCommandResult> {
  if (method === 'who') {
    return handleWho()
  }
  if (method === 'bots/list') {
    return runMetabot(['bot', 'list'], { timeoutMs: PING_TIMEOUT_MS })
  }
  if (method === 'bots/show') {
    const slug = typeof (payload as { slug?: unknown })?.slug === 'string'
      ? (payload as { slug: string }).slug.trim()
      : ''
    if (!slug) return { ok: false, state: 'failed', code: 'missing_slug', message: 'slug is required' }
    return runMetabot(['bot', 'show', '--from', slug])
  }
  if (method === 'bots/create') {
    return createBot(ctx, payload)
  }
  if (method === 'bots/update') {
    const body = payload as { slug?: unknown; patch?: unknown }
    const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''
    if (!slug) return { ok: false, state: 'failed', code: 'missing_slug', message: 'slug is required' }
    const patch = body.patch !== null && typeof body.patch === 'object' && !Array.isArray(body.patch)
      ? body.patch as Record<string, unknown>
      : {}
    return updateBot(ctx, slug, patch)
  }
  if (method === 'bots/delete') {
    const slug = typeof (payload as { slug?: unknown })?.slug === 'string'
      ? (payload as { slug: string }).slug.trim()
      : ''
    if (!slug) return { ok: false, state: 'failed', code: 'missing_slug', message: 'slug is required' }
    return deleteBot(ctx, slug)
  }
  if (method === 'llm/directory') {
    return { ok: true, state: 'success', data: await listLlmDirectory(ctx) }
  }
  return { ok: false, state: 'failed', code: 'not-found', message: `unknown oac API method "${method}"` }
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
      try {
        const payload = await readJsonBody(req)
        const result = await dispatchPost(ctx, method, payload)
        const status = result.code === 'not-found' ? 404 : 200
        writeJson(res, status, result)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        writeJson(res, 500, {
          ok: false,
          state: 'failed',
          code: error instanceof CliBridgeError ? 'cli_bridge' : 'internal',
          message,
        })
      }
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
    if (ctx.agentPresets !== undefined && health.cliPath !== null) {
      try {
        const reconciled = await reconcilePresets(ctx)
        health.presets = {
          ok: true,
          message: `${reconciled.createdOrUpdated.length} bots, ${reconciled.removed.length} removed`,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        health.presets = { ok: false, message }
        health.ok = false
        health.error = [health.error, `presets: ${message}`].filter(Boolean).join('; ')
        warn(ctx, health.error)
      }
    } else if (ctx.agentPresets === undefined) {
      health.presets = { ok: false, message: 'agentPresets not available' }
    }
  }
  ctx.effect(() => registerApi(ctx, () => health), 'oac-dsh: /oac/api routes')
}

export type { HealthPayload, OacDshConfig }
export { parseMetabotStdout, resolveCli, resolveMetabotCliPath, runMetabot } from './cli-bridge.js'
export { isSupportedNodeVersion, resolveNodeBinary } from './node-runtime.js'
export { isTrustedApiRequest } from './trust-fence.js'
export { bootstrapHealth } from './bootstrap.js'
export { createBot, deleteBot, listLlmDirectory, updateBot } from './bots.js'
export { validateCreatePayload } from './bots-input.js'
export { buildPersonaPrompt, parseBotListData } from './persona.js'
export {
  generatePreset,
  isOacPresetId,
  presetDir,
  presetIdForSlug,
  reconcilePresets,
  removePreset,
  STANDARD_PRESET_ID,
} from './preset.js'
