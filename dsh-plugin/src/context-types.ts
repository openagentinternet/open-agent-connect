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
}

/** Optional apply config (tests skip CLI bootstrap so they cannot start a user daemon). */
export interface OacDshConfig {
  skipBootstrap?: boolean
}
