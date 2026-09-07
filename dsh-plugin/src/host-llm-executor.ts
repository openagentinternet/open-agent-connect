/**
 * Host LLM executor: leases reply generations from the OAC daemon.
 *
 * The daemon's private-chat reply runners can delegate the model call to the
 * DSH host when a Bot carries a DSH LLM pair (`dsh-llm.json`) and this
 * executor is connected. Transport mirrors the browser-event hub: the host
 * holds one long-lived SSE subscription to the daemon's
 * `/api/llm/host-executor/events` stream (host-initiated loopback only —
 * Electron hosts have no callable HTTP origin), executes each `generate`
 * request through the DSH `llm` service with the requested pair (primary,
 * then the fallback pair once), and POSTs the result back to
 * `/api/llm/host-executor/result`. The daemon keeps owning the reply
 * orchestration (turn counting, Bye detection, delivery); only the model
 * call runs here.
 */
import { request as httpRequest } from 'node:http'
import { resolveDaemonBaseUrl, subscribeDaemonSse } from './browser-bridge.js'
import { generateLlmText, type LlmStreamLike } from './llm-generate.js'

const RETRY_DELAY_MS = 2_000
const RESULT_POST_TIMEOUT_MS = 10_000
/** Reply turns target 2-4 sentences; a generous cap keeps runaway models bounded. */
const GENERATE_MAX_TOKENS = 1024

interface GenerateRequest {
  type: 'generate'
  requestId: string
  botSlug?: string
  provider: string
  model: string
  reasoningEffort?: string | null
  fallback?: { provider: string; model: string; reasoningEffort?: string | null } | null
  system: string
  prompt: string
  timeoutMs: number
}

function parseGenerateRequest(data: string): GenerateRequest | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  if (record.type !== 'generate') return null
  const requestId = typeof record.requestId === 'string' ? record.requestId : ''
  const provider = typeof record.provider === 'string' ? record.provider : ''
  const model = typeof record.model === 'string' ? record.model : ''
  const system = typeof record.system === 'string' ? record.system : ''
  const prompt = typeof record.prompt === 'string' ? record.prompt : ''
  if (!requestId || !provider || !model || !system || !prompt) return null
  const fallbackRecord = record.fallback && typeof record.fallback === 'object'
    ? record.fallback as Record<string, unknown>
    : null
  const fallback = fallbackRecord
    && typeof fallbackRecord.provider === 'string' && fallbackRecord.provider
    && typeof fallbackRecord.model === 'string' && fallbackRecord.model
    ? {
      provider: fallbackRecord.provider,
      model: fallbackRecord.model,
      ...(typeof fallbackRecord.reasoningEffort === 'string' && fallbackRecord.reasoningEffort
        ? { reasoningEffort: fallbackRecord.reasoningEffort }
        : {}),
    }
    : null
  return {
    type: 'generate',
    requestId,
    ...(typeof record.botSlug === 'string' && record.botSlug ? { botSlug: record.botSlug } : {}),
    provider,
    model,
    ...(typeof record.reasoningEffort === 'string' && record.reasoningEffort
      ? { reasoningEffort: record.reasoningEffort }
      : {}),
    ...(fallback ? { fallback } : {}),
    system,
    prompt,
    timeoutMs: typeof record.timeoutMs === 'number' && Number.isFinite(record.timeoutMs) && record.timeoutMs > 0
      ? record.timeoutMs
      : 60_000,
  }
}

export class HostLlmExecutor {
  private readonly env: NodeJS.ProcessEnv
  private readonly llm: LlmStreamLike | undefined
  private readonly log: (message: string) => void
  private started = false
  private subscription: (() => void) | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: {
    env?: NodeJS.ProcessEnv
    llm: LlmStreamLike | undefined
    log?: (message: string) => void
  }) {
    this.env = options.env ?? process.env
    this.llm = options.llm
    this.log = options.log ?? (() => {})
  }

  start(): void {
    if (this.started) return
    this.started = true
    void this.connect()
  }

  stop(): void {
    this.started = false
    this.subscription?.()
    this.subscription = null
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  private async connect(): Promise<void> {
    if (!this.started) return
    this.subscription?.()
    this.subscription = null
    const baseUrl = await resolveDaemonBaseUrl(this.env)
    if (baseUrl === null) {
      this.scheduleRetry()
      return
    }
    this.subscription = subscribeDaemonSse(
      `${baseUrl}/api/llm/host-executor/events`,
      {
        onEvent: (_eventName, data) => {
          const generateRequest = parseGenerateRequest(data)
          if (generateRequest !== null) {
            void this.handleGenerate(baseUrl, generateRequest)
          }
        },
        onClose: () => this.scheduleRetry(),
        onError: () => this.scheduleRetry(),
      },
      'daemon host-executor events',
    )
  }

  private scheduleRetry(): void {
    if (!this.started || this.retryTimer !== null) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.connect()
    }, RETRY_DELAY_MS)
  }

  private async handleGenerate(baseUrl: string, generateRequest: GenerateRequest): Promise<void> {
    if (!this.llm) {
      await this.postResult(baseUrl, { requestId: generateRequest.requestId, ok: false, error: 'DSH llm service is not available.' })
      return
    }
    // Leave the daemon's deadline room to receive the result POST.
    const idleTimeoutMs = Math.max(5_000, generateRequest.timeoutMs - 5_000)
    try {
      const output = await this.generateWithPair(generateRequest, {
        provider: generateRequest.provider,
        model: generateRequest.model,
        ...(generateRequest.reasoningEffort ? { reasoningEffort: generateRequest.reasoningEffort } : {}),
      }, idleTimeoutMs)
      await this.postResult(baseUrl, { requestId: generateRequest.requestId, ok: true, output })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.postResult(baseUrl, { requestId: generateRequest.requestId, ok: false, error: message })
    }
  }

  /** Primary pair first; on failure, the fallback pair once (dream-runner pattern). */
  private async generateWithPair(
    generateRequest: GenerateRequest,
    pair: { provider: string; model: string; reasoningEffort?: string },
    idleTimeoutMs: number,
  ): Promise<string> {
    try {
      return await generateLlmText(this.llm!, {
        provider: pair.provider,
        model: pair.model,
        ...(pair.reasoningEffort ? { reasoningEffort: pair.reasoningEffort } : {}),
        system: generateRequest.system,
        user: generateRequest.prompt,
        maxTokens: GENERATE_MAX_TOKENS,
        purpose: 'oac-a2a-reply',
        timeoutMs: idleTimeoutMs,
      })
    } catch (error) {
      const fallback = generateRequest.fallback
      if (!fallback || fallback.provider === pair.provider && fallback.model === pair.model) throw error
      this.log(`[oac-dsh host llm] primary pair failed (${error instanceof Error ? error.message : String(error)}); retrying on fallback pair`)
      return generateLlmText(this.llm!, {
        provider: fallback.provider,
        model: fallback.model,
        ...(fallback.reasoningEffort ? { reasoningEffort: fallback.reasoningEffort } : {}),
        system: generateRequest.system,
        user: generateRequest.prompt,
        maxTokens: GENERATE_MAX_TOKENS,
        purpose: 'oac-a2a-reply',
        timeoutMs: idleTimeoutMs,
      })
    }
  }

  private postResult(baseUrl: string, payload: Record<string, unknown>): Promise<void> {
    return new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      }
      const body = JSON.stringify(payload)
      const url = new URL(`${baseUrl}/api/llm/host-executor/result`)
      const req = httpRequest(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        timeout: RESULT_POST_TIMEOUT_MS,
      }, (response) => {
        response.resume()
        response.on('end', finish)
      })
      const timer = setTimeout(() => {
        req.destroy()
        finish()
      }, RESULT_POST_TIMEOUT_MS)
      req.on('error', () => finish())
      req.end(body)
    })
  }
}
