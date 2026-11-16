/**
 * OAC session MCP server registration into DSH's managed MCP fleet (rc.2+).
 *
 * DSH 0.2.2 added `ctx.mcpManager` (`@deepseek-ai/dsh-mcp-manager`): one
 * fleet of MCP client instances whose tools mount into agent sessions;
 * plugins contribute entries for their own lifetime through `register()`.
 * This module registers the `metabot mcp` stdio server — the local session
 * tools (list_sessions / check_inbox / message_status / send_message) —
 * under the server name `oac`, so any DSH session can pull its bound inbox
 * and answer peers as the bound Bot profile (the local-session-adapter
 * pull tier). The child is the same dependency-proxy surface the metabot
 * CLI uses and auto-starts the daemon on demand.
 *
 * Identity discipline: the mail agent (push tier) registers every live DSH
 * session under its own id and drives those inboxes natively — one
 * consuming poll loop per bound session. The MCP server binds one separate
 * named identity (`metabot mcp --name dsh`), so the two tiers never race on
 * one queue; a conversation reaches the pull tier only through an explicit
 * bind to that identity.
 *
 * Degradation paths (never throw — the agent must not destabilize the
 * host): kernels without the manager leave the inject pending forever
 * (that pending inject IS the feature detection); an unresolvable CLI
 * skips registration (the Bots-page setup card already guides install);
 * a refused registration (name taken, invalid entry) is logged and dropped.
 */

import type { HostContext } from './context-types.js'
import { resolveCli, type CliResolution } from './cli-bridge.js'

/** The managed server name: DSH namespaces the server's tools under it. */
export const MCP_SERVER_NAME = 'oac'

/** The named session identity the stdio server binds (`metabot mcp --name`). */
export const MCP_SESSION_NAME = 'dsh'

/**
 * Per-tool-call budget: check_inbox long-polls (daemon caps the wait around
 * 25s) plus daemon cold-start headroom on the first call.
 */
const MCP_TOOL_CALL_TIMEOUT_MS = 120_000

/** Structural face of DSH's `ctx.mcpManager` this module needs (rc.2+). */
export interface DshMcpManagerLike {
  register(name: string, entry: {
    readonly transport: 'stdio' | 'streamable-http'
    readonly command?: string
    readonly args?: readonly string[]
    readonly env?: Record<string, string>
    readonly cwd?: string
    readonly url?: string
    readonly headers?: Record<string, string>
    readonly toolCallTimeoutMs?: number
  }): () => void
}

export type McpRegistrationEvent =
  | { kind: 'registered'; server: string; command: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'register_failed'; server: string; error: string }

export interface McpRegistrationOptions {
  /** Injectable CLI resolution (tests); default `resolveCli()`. */
  resolve?: () => CliResolution
  /** Injectable server name (tests); default `MCP_SERVER_NAME`. */
  serverName?: string
  /** Injectable session name (tests); default `MCP_SESSION_NAME`. */
  sessionName?: string
  /** Test hook: observable registration events. */
  onEvent?: (event: McpRegistrationEvent) => void
}

/**
 * Register the OAC session MCP server with DSH's mcpManager for the
 * plugin's lifetime. Registration is deferred through `ctx.inject` so it
 * fires when (and only when) the host actually mounts the manager.
 */
export function applyMcpServerRegistration(ctx: HostContext, options: McpRegistrationOptions = {}): void {
  const resolve = options.resolve ?? (() => resolveCli())
  const serverName = options.serverName ?? MCP_SERVER_NAME
  const sessionName = options.sessionName ?? MCP_SESSION_NAME
  ctx.effect(() => {
    let stopped = false
    let disposeServer: (() => void) | undefined
    const register = (raw: unknown): void => {
      if (stopped || disposeServer !== undefined) return
      let resolution: CliResolution
      try {
        resolution = resolve()
      } catch (error) {
        options.onEvent?.({ kind: 'skipped', reason: error instanceof Error ? error.message : String(error) })
        return
      }
      const manager = raw as DshMcpManagerLike | undefined
      if (manager === undefined || typeof manager.register !== 'function') {
        options.onEvent?.({ kind: 'skipped', reason: 'mcpManager service lacks register()' })
        return
      }
      try {
        disposeServer = manager.register(serverName, {
          transport: 'stdio',
          command: resolution.nodePath,
          args: [resolution.cliPath, 'mcp', '--name', sessionName],
          env: {},
          cwd: '',
          toolCallTimeoutMs: MCP_TOOL_CALL_TIMEOUT_MS,
        })
        options.onEvent?.({
          kind: 'registered',
          server: serverName,
          command: `${resolution.nodePath} ${resolution.cliPath} mcp`,
        })
      } catch (error) {
        options.onEvent?.({
          kind: 'register_failed',
          server: serverName,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    const stopInject = ctx.inject?.('mcpManager', (scope: unknown) => {
      register((scope as { mcpManager?: unknown } | undefined)?.mcpManager)
    })
    return () => {
      stopped = true
      try {
        stopInject?.()
      } catch { /* an already-stopped inject disposer is fine to skip */ }
      try {
        disposeServer?.()
      } catch { /* instance teardown races are the manager's to report */ }
    }
  }, 'oac-dsh: oac mcp server registration')
}
