/**
 * Structural types for the Cordis services this plugin consumes.
 *
 * Third-party plugins resolve outside DSH's single cordis instance, so
 * upstream `declare module` augmentations do not reach this Context. Keep
 * this file free of Node.js types so the client half can stay browser-only.
 */

/** Request facts route handlers read (structural subset of IncomingMessage). */
export interface PluginHttpRequest {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
  /** Subject-verb wire event hook (the SSE routes use it to detect client close). */
  on?(event: string, listener: (...args: unknown[]) => void): unknown
  [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array>
}

/** Response face route handlers write to. */
export interface PluginHttpResponse {
  statusCode: number
  writeHead(status: number, headers?: Record<string, string>): void
  /** Streaming frame writer (the browser-events SSE route uses it). */
  write?(chunk: string | Uint8Array): unknown
  end(body?: string | Uint8Array): void
}

export interface PluginWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: PluginHttpRequest, res: PluginHttpResponse) => void | Promise<void>
}

export interface PluginWebServer {
  register(route: PluginWebRoute): () => void
}

export interface PluginWebRuntime {
  trustedHosts: readonly string[]
}

export interface PluginLogger {
  warn?(message: string): void
  info?(message: string): void
}

export interface AgentPresetsLike {
  copy(from: string, id: string, name?: string): Promise<void>
  remove(id: string): Promise<void>
  list(): Promise<ReadonlyArray<{ id: string }>>
  /** Live preset id for a composed agent context (e.g. 'oac-<slug>'). */
  composedPreset?(agentCtx: unknown): string | undefined
  /** Mount a preset composition onto a fresh agent context (agents.create setup). */
  mount?(agentCtx: unknown, id?: string): Promise<void>
}

/** Content block + user message shapes the agent loop consumes (structural). */
export interface HostTextBlock {
  type: 'text'
  text: string
}

export interface HostUserMessage {
  /** Stable message identity. DSH persists pre-step messages as `user/message`
   * session events and refuses to reload any that lack an id, so plugin-built
   * messages must carry one. */
  id?: string
  role: 'user'
  content: HostTextBlock[]
  source: { kind: string; plugin?: string; form?: string; sections?: Array<{ name: string; text: string }> }
}

/** Pre-step waterfall decision (the part this plugin reads/writes). */
export interface HostPreStepDecision {
  kind: 'enter' | 'reject'
  messages?: HostUserMessage[]
}

export interface HostPreStepPayload {
  agent: HostAgentLike
  messages: HostUserMessage[]
  turn: number
  step: number
  signal?: AbortSignal
}

/** Durable session event feed entry (structural). */
export interface HostSessionEventLike {
  type: string
  data?: unknown
}

export interface HostSessionLike {
  id?: string
  events: ReadonlyArray<HostSessionEventLike>
  header?: { agentPreset?: string }
}

export interface HostToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render: (args: unknown, value: unknown) => Array<{ type: 'text'; text: string }>
  }
  timeoutMs?: number
  execute(args: Record<string, unknown>, exec: HostToolExec): Promise<unknown>
}

/** Runtime facts DSH passes into tool execute (structural subset of ToolRunContext). */
export interface HostToolExec {
  signal?: AbortSignal
  agent?: HostAgentLike
  callId?: string
}

/** DSH native one-shot approval (ctx.approval.request). */
export type HostApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

export interface HostApproval {
  request(req: {
    agent: unknown
    toolName: string
    callId?: string
    reason?: string
    signal?: AbortSignal
  }): Promise<HostApprovalOutcome>
}

export interface HostAgentLike {
  id?: string
  ctx: {
    on?(event: string, listener: (...args: any[]) => unknown, options?: { prepend?: boolean }): void
    systemPrompt?: {
      section(section: { name: string; order: number; text: string | (() => string) }): () => void
    }
    tools?: {
      register(definition: HostToolDefinition): () => void
    }
  }
  session?: HostSessionLike
  followup?(message: HostUserMessage): void
  inject?(message: HostUserMessage): void
  whenIdle?(): Promise<unknown>
  cancel?(reason: unknown): void
}

export interface HostAgentsRegistryLike {
  create(options: {
    sessionId?: string
    meta?: Record<string, unknown>
    setup?: (agentCtx: unknown) => Promise<void> | void
    signal?: AbortSignal
  }): Promise<{ agent: HostAgentLike; dispose(): Promise<void> | void }>
  get?(id: string): HostAgentLike | undefined
  list?(): HostAgentLike[]
}

export interface HostAgentsCreateLike {
  agents?: HostAgentsRegistryLike
}

export interface LlmLike {
  listProviders(): ReadonlyArray<{ id: string; name?: string }>
  listModels(provider: string): Promise<ReadonlyArray<{ id: string; name?: string }>>
}

/** Host plugin context: webserver/trust seam plus inject targets for later rounds. */
export interface HostContext {
  webServer: PluginWebServer
  webRuntime: PluginWebRuntime
  logger?: PluginLogger
  effect(fn: () => void | (() => void), label?: string): void
  agentPresets?: AgentPresetsLike
  llm?: LlmLike
  get?(key: string): unknown
  dshHomePath?: (...segments: string[]) => string
  /** Cordis event/waterfall surface (agent/pre-step, session/event, agent/created…). */
  on?(event: string, listener: (...args: any[]) => unknown, options?: { prepend?: boolean }): void
  agents?: HostAgentsRegistryLike
  /** Present when the DSH web composition mounts user-approval. */
  approval?: HostApproval
}

/** Optional apply config (tests skip CLI bootstrap so they cannot start a user daemon). */
export interface OacDshConfig {
  skipBootstrap?: boolean
  /** Memory system gates (Phase 5+; all default enabled when omitted). */
  memory?: {
    enabled?: boolean
    /** Per-turn prompt injection into oac-* preset sessions. */
    injection?: boolean
    /** Post-turn transcript mirroring + extraction for oac-* preset sessions. */
    extraction?: boolean
    /** Model-facing memory tools on oac-* preset sessions. */
    tools?: boolean
  }
  /** Nightly dream scheduler (Phase 6+). */
  dream?: {
    enabled?: boolean
    /** Scheduler tick period in minutes (default 10). */
    tickMinutes?: number
  }
  /** Twin/Worker orchestration (Phase 7+). */
  twin?: {
    enabled?: boolean
    /** Delegated worker step watchdog (default 300_000, the IDBots value). */
    stepTimeoutMs?: number
  }
  /** User panel + owner binding routes (Phase 5+). */
  user?: {
    enabled?: boolean
  }
}
