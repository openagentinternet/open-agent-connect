/**
 * Open Agent Connect host plugin for DeepSeek Harness.
 *
 * Dual-face package: this file is the Node half (CLI bridge + fenced HTTP
 * routes). The browser half is `src/client/index.ts`.
 */
import { bootstrapHealth } from './bootstrap.js'
import { createBot, deleteBot, listLlmDirectory, updateBot } from './bots.js'
import { BrowserEventHub } from './browser-bridge.js'
import { getAutoReplyStatus, listChatSkills, setAutoReplyConfig } from './chat-settings.js'
import { getConversationMessages, listConversations, runConversationGuidance } from './a2a.js'
import { CliBridgeError, runMetabot, type MetabotCommandResult } from './cli-bridge.js'
import { localBotList, localBotShow } from './local-read.js'
import type { HostAgentLike, HostContext, OacDshConfig, PluginHttpRequest, PluginHttpResponse } from './context-types.js'
import { uploadFileBytes } from './file-upload.js'
import { emptyHealth, type HealthPayload } from './health.js'
import { apiMethod, readJsonBody, readRawBody, writeJson } from './http.js'
import { applyMemoryExtraction, applyMemoryInjection } from './memory-observe.js'
import { dispatchMemoryRoutes } from './memory-routes.js'
import { applyDreamScheduler } from './dream-scheduler.js'
import { installMemoryToolsOnAgent } from './memory-tools.js'
import { installTwinOnAgent, liveOacAgents } from './twin-tools.js'
import { slugFromPresetId } from './chip-logic.js'
import { reconcilePresets } from './preset.js'
import { dispatchSection } from './sections.js'
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
  browserHub: BrowserEventHub,
): Promise<MetabotCommandResult> {
  if (method === 'browser/open') {    const uri = typeof (payload as { uri?: unknown })?.uri === 'string'
      ? (payload as { uri: string }).uri.trim()
      : ''
    const event = browserHub.open(uri || null)
    if (event === null) {
      return {
        ok: false,
        state: 'failed',
        code: 'daemon_unreachable',
        message: 'OAC daemon is not reachable; start it with "metabot daemon start".',
      }
    }
    return { ok: true, state: 'success', data: event }
  }
  if (method === 'who') {
    return handleWho()
  }
  if (method === 'bots/list') {
    const local = await localBotList()
    if (local) return local
    return runMetabot(['bot', 'list'], { timeoutMs: PING_TIMEOUT_MS })
  }
  if (method === 'bots/show') {
    const slug = typeof (payload as { slug?: unknown })?.slug === 'string'
      ? (payload as { slug: string }).slug.trim()
      : ''
    if (!slug) return { ok: false, state: 'failed', code: 'missing_slug', message: 'slug is required' }
    const local = await localBotShow(slug)
    if (local) return local
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
  if (method === 'chat/skills') {
    const from = typeof (payload as { from?: unknown })?.from === 'string'
      ? (payload as { from: string }).from.trim()
      : ''
    if (!from) return { ok: false, state: 'failed', code: 'missing_from', message: 'from is required' }
    return listChatSkills(from)
  }
  if (method === 'chat/auto-reply/status') {
    const from = typeof (payload as { from?: unknown })?.from === 'string'
      ? (payload as { from: string }).from.trim()
      : ''
    if (!from) return { ok: false, state: 'failed', code: 'missing_from', message: 'from is required' }
    return getAutoReplyStatus(from)
  }
  if (method === 'chat/auto-reply/config') {
    const body = payload as { from?: unknown; enabled?: unknown; maxTurns?: unknown; cooldownMs?: unknown }
    const from = typeof body.from === 'string' ? body.from.trim() : ''
    if (!from) return { ok: false, state: 'failed', code: 'missing_from', message: 'from is required' }
    return setAutoReplyConfig({
      from,
      ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
      ...(typeof body.maxTurns === 'number' ? { maxTurns: body.maxTurns } : {}),
      ...(typeof body.cooldownMs === 'number' ? { cooldownMs: body.cooldownMs } : {}),
    })
  }
  if (method === 'conversations/list') {
    const from = typeof (payload as { from?: unknown })?.from === 'string'
      ? (payload as { from: string }).from.trim()
      : ''
    if (!from) return { ok: false, state: 'failed', code: 'missing_from', message: 'from is required' }
    return listConversations(from)
  }
  if (method === 'conversations/messages') {
    const body = payload as { from?: unknown; peer?: unknown }
    const from = typeof body.from === 'string' ? body.from.trim() : ''
    const peer = typeof body.peer === 'string' ? body.peer.trim() : ''
    if (!from) return { ok: false, state: 'failed', code: 'missing_from', message: 'from is required' }
    if (!peer) return { ok: false, state: 'failed', code: 'missing_peer', message: 'peer is required' }
    return getConversationMessages(from, peer)
  }
  if (method === 'conversations/guidance') {
    const body = payload as { from?: unknown; peer?: unknown; guidance?: unknown }
    const from = typeof body.from === 'string' ? body.from.trim() : ''
    const peer = typeof body.peer === 'string' ? body.peer.trim() : ''
    const guidance = typeof body.guidance === 'string' ? body.guidance.trim() : ''
    if (!from) return { ok: false, state: 'failed', code: 'missing_from', message: 'from is required' }
    if (!peer) return { ok: false, state: 'failed', code: 'missing_peer', message: 'peer is required' }
    if (!guidance) return { ok: false, state: 'failed', code: 'missing_guidance', message: 'guidance is required' }
    return runConversationGuidance(from, peer, guidance)
  }
  const memory = await dispatchMemoryRoutes(method, payload, {
    llm: ctx.llm as unknown as import('./llm-generate.js').LlmStreamLike | undefined,
  })
  if (memory !== undefined) return memory
  const section = await dispatchSection(method, payload)
  if (section !== undefined) return section
  return { ok: false, state: 'failed', code: 'not-found', message: `unknown oac API method "${method}"` }
}

function streamBrowserEvents(
  req: PluginHttpRequest,
  res: PluginHttpResponse,
  hub: BrowserEventHub,
): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  res.write?.('retry: 3000\n\n')
  const unsubscribe = hub.addListener((event) => {
    try {
      res.write?.(`event: browser-open\ndata: ${JSON.stringify(event)}\n\n`)
    } catch {
      // a broken connection is unregistered on req close below
    }
  })
  req.on?.('close', () => {
    unsubscribe()
    try {
      res.end?.()
    } catch {
      // already ended
    }
  })
}

/** Raw MetaApp asset upload (`POST /oac/api/file/upload?from=<slug>`). */
async function handleFileUpload(req: PluginHttpRequest): Promise<MetabotCommandResult> {
  const url = new URL(req.url ?? '/', 'http://dsh.internal')
  const from = url.searchParams.get('from')?.trim() ?? ''
  if (!from) return { ok: false, state: 'failed', code: 'missing_from', message: 'from is required' }
  const bytes = await readRawBody(req)
  if (bytes.length === 0) {
    return { ok: false, state: 'failed', code: 'empty_body', message: 'upload body is empty' }
  }
  const rawContentType = req.headers['content-type']
  const contentType = Array.isArray(rawContentType)
    ? rawContentType[0]?.split(';')[0]?.trim() ?? 'application/octet-stream'
    : typeof rawContentType === 'string'
      ? rawContentType.split(';')[0].trim()
      : 'application/octet-stream'
  return uploadFileBytes(from, bytes, contentType || 'application/octet-stream')
}

function registerApi(
  ctx: HostContext,
  getHealth: () => HealthPayload,
  browserHub: BrowserEventHub,
): () => void {
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
      if (method === 'browser/events') {
        if (req.method !== 'GET') {
          writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
          return
        }
        streamBrowserEvents(req, res, browserHub)
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
        if (method === 'file/upload') {
          const result = await handleFileUpload(req)
          const uploadStatus = result.code === 'not-found' ? 404 : 200
          writeJson(res, uploadStatus, result)
          return
        }
        const payload = await readJsonBody(req)
        const result = await dispatchPost(ctx, method, payload, browserHub)
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
  const browserHub = new BrowserEventHub()
  if (!config.skipBootstrap) {
    ctx.effect(() => {
      browserHub.start()
      return () => { browserHub.stop() }
    }, 'oac-dsh: browser event hub')
  }
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
  ctx.effect(() => registerApi(ctx, () => health, browserHub), 'oac-dsh: /oac/api routes')

  // Memory system: per-turn injection, post-turn extraction, and per-agent
  // memory tools for oac-* preset sessions. Each piece is config-gated and
  // best-effort — failures never break a DSH turn.
  const memoryEnabled = config.memory?.enabled !== false
  if (memoryEnabled && config.memory?.injection !== false) {
    ctx.effect(() => {
      applyMemoryInjection(ctx)
      return () => undefined
    }, 'oac-dsh: memory injection')
  }
  if (memoryEnabled && config.memory?.extraction !== false) {
    ctx.effect(() => {
      applyMemoryExtraction(ctx)
      return () => undefined
    }, 'oac-dsh: memory extraction')
  }
  if (memoryEnabled && config.memory?.tools !== false && ctx.on) {
    ctx.on('agent/created', (payload: { agent: HostAgentLike }) => {
      void (async () => {
        try {
          const agent = payload.agent
          const preset = agent?.ctx ? ctx.agentPresets?.composedPreset?.(agent.ctx) : undefined
          const slug = preset ? slugFromPresetId(preset) : undefined
          if (!slug) return
          liveOacAgents.set(slug, agent)
          installMemoryToolsOnAgent(agent, slug)
          if (config.twin?.enabled === false) return
          const shown = await runMetabot(['bot', 'show', '--from', slug], { timeoutMs: 30_000 })
          const profile = shown.ok
            ? (shown.data as { profile?: { botType?: string } } | undefined)?.profile
            : undefined
          if (profile?.botType !== 'twin') return
          const orchestrator = installTwinOnAgent(ctx, agent, slug, {
            stepTimeoutMs: config.twin?.stepTimeoutMs,
          })
          await orchestrator.deliverPendingNotifications(slug, agent)
        } catch {
          // tool installation is best-effort per agent
        }
      })()
    })
  }

  // Nightly dream scheduler: ticks on a timer while the DSH host is alive;
  // the CLI's due-date arithmetic owns window/catch-up/backoff decisions.
  if (config.dream?.enabled !== false) {
    applyDreamScheduler(ctx, { tickMinutes: config.dream?.tickMinutes })
  }
}

export type { HealthPayload, OacDshConfig }
export { BrowserEventHub, resolveBrowserPath, resolveDaemonBaseUrl, type BrowserOpenEvent } from './browser-bridge.js'
export { parseMetabotStdout, resolveCli, resolveMetabotCliPath, runMetabot } from './cli-bridge.js'
export { isSupportedNodeVersion, resolveNodeBinary } from './node-runtime.js'
export { isTrustedApiRequest } from './trust-fence.js'
export { bootstrapHealth } from './bootstrap.js'
export { createBot, deleteBot, listLlmDirectory, updateBot } from './bots.js'
export { getAutoReplyStatus, listChatSkills, setAutoReplyConfig } from './chat-settings.js'
export { getConversationMessages, listConversations, runConversationGuidance } from './a2a.js'
export { validateCreatePayload } from './bots-input.js'
export { buildPersonaPrompt, parseBotListData } from './persona.js'
export {
  advertisedModelForBot,
  chipDisplayName,
  filterSelectablePresets,
  isOacPresetId,
  modelSelectionToApply,
  presetIdForSlug,
  shouldApplyStagedPreset,
  slugFromPresetId,
} from './chip-logic.js'
export { dispatchSection } from './sections.js'
export { dispatchMemoryRoutes } from './memory-routes.js'
export { applyMemoryExtraction, applyMemoryInjection } from './memory-observe.js'
export { applyDreamScheduler, runDreamSchedulerTick } from './dream-scheduler.js'
export {
  buildDelegationMessage,
  buildTwinToolDefinitions,
  createTwinOrchestrator,
  installTwinOnAgent,
  liveOacAgents,
  TWIN_OVERLAY_TEXT,
  WORKER_DELEGATION_SYSTEM_PROMPT,
} from './twin-tools.js'
export { buildMemoryToolDefinitions, installMemoryToolsOnAgent, MEMORY_STRATEGY_TEXT } from './memory-tools.js'
export { generateLlmText } from './llm-generate.js'
export { uploadFileBytes } from './file-upload.js'
export {
  generatePreset,
  presetDir,
  reconcilePresets,
  removePreset,
  STANDARD_PRESET_ID,
} from './preset.js'
