/**
 * Per-agent OAC tool installation: the memory/chain-history family (every
 * `oac-*` agent) and the twin/group family (twin Bots only).
 *
 * DSH fires `agent/created` with the session header's preset. For
 * create-then-select sessions that is the global `agent-presets.default`
 * (e.g. `oac`), not the `oac-<slug>` preset the user picks a moment later —
 * the `agent-preset/selected` session event carries the real choice.
 * Installing only at creation therefore dropped every per-agent tool on those
 * sessions, silently, before the twin check ever ran. Installation here is
 * idempotent per agent and retries on the selection event, and every skip or
 * failure is logged: a missing capability must never be invisible.
 */
import { slugFromPresetId } from './chip-logic.js'
import { installChainHistoryRecallOnAgent } from './chain-history-recall.js'
import type { HostAgentLike, HostContext, HostSessionEventLike, HostSessionLike } from './context-types.js'
import { runMetabotPinned } from './daemon-pinned-run.js'
import { installGroupTaskOnAgent } from './group-task-tools.js'
import { installMemoryToolsOnAgent } from './memory-tools.js'
import { agentsRegistryOf, installTwinOnAgent } from './twin-tools.js'

export interface PerAgentInstallOptions {
  /** Twin/group family gate (config.twin.enabled, default on). */
  twinEnabled?: boolean
  twinStepTimeoutMs?: number
  liveOacAgents: Map<string, HostAgentLike>
  /** Slugs whose legacy notification backlog was already flushed this host run. */
  notifiedBacklogs: Set<string>
  log?: (message: string) => void
  /** botType probe; tests inject a fake, production uses the daemon-pinned CLI. */
  botTypeOf?: (slug: string) => Promise<string | undefined>
}

export interface PerAgentInstaller {
  handleAgentCreated(agent: HostAgentLike | undefined): void
  handleAgentDisposed(agent: HostAgentLike | undefined): void
  handlePresetSelected(session: HostSessionLike | undefined, event: HostSessionEventLike | undefined): void
}

async function defaultBotTypeOf(slug: string): Promise<string | undefined> {
  // Daemon-pinned: this fires at chat-open frequency — it must never
  // probe-and-replace a busy daemon (see daemon-pinned-run.ts).
  const shown = await runMetabotPinned(['bot', 'show', '--from', slug], { timeoutMs: 30_000 })
  return shown.ok
    ? (shown.data as { profile?: { botType?: string } } | undefined)?.profile?.botType
    : undefined
}

export function createPerAgentInstaller(ctx: HostContext, options: PerAgentInstallOptions): PerAgentInstaller {
  const log = options.log ?? (() => undefined)
  const botTypeOf = options.botTypeOf ?? defaultBotTypeOf
  const memoryInstalled = new WeakSet<object>()
  const twinDecided = new WeakSet<object>()
  const skipWarned = new WeakSet<object>()
  const agentBySessionId = new Map<string, HostAgentLike>()

  function findAgentForSession(session: HostSessionLike | undefined, sessionId: string): HostAgentLike | undefined {
    const fromMap = sessionId ? agentBySessionId.get(sessionId) : undefined
    if (fromMap) return fromMap
    const registry = agentsRegistryOf(ctx)
    const agents = registry?.list?.() ?? []
    return agents.find((candidate) => {
      if (session !== undefined && candidate.session === session) return true
      const id = candidate.session?.id
      return Boolean(sessionId && typeof id === 'string' && id === sessionId)
    })
  }

  async function ensureInstalled(agent: HostAgentLike, presetOverride: string | undefined, source: string): Promise<void> {
    const preset = presetOverride ?? (agent.ctx ? ctx.agentPresets?.composedPreset?.(agent.ctx) : undefined)
    const slug = preset ? slugFromPresetId(preset) : undefined
    if (!slug) {
      if (!skipWarned.has(agent)) {
        skipWarned.add(agent)
        log(
          `per-agent tools not installed at ${source}: composed preset "${preset ?? '(unresolved)'}" `
          + 'is not an oac-<slug> preset; if this session selects an oac-* preset the tools install on that event',
        )
      }
      return
    }
    if (!memoryInstalled.has(agent)) {
      installMemoryToolsOnAgent(agent, slug)
      installChainHistoryRecallOnAgent(ctx, agent)
      memoryInstalled.add(agent)
    }
    options.liveOacAgents.set(slug, agent)
    if (options.twinEnabled === false || twinDecided.has(agent)) return
    twinDecided.add(agent)
    let botType: string | undefined
    try {
      botType = await botTypeOf(slug)
    } catch (error) {
      // Allow a later preset event to retry the probe instead of latching a
      // transient CLI failure into "no twin tools for this session".
      twinDecided.delete(agent)
      throw error
    }
    if (botType !== 'twin') return
    const orchestrator = installTwinOnAgent(ctx, agent, slug, {
      stepTimeoutMs: options.twinStepTimeoutMs,
    })
    installGroupTaskOnAgent(agent, slug)
    if (!options.notifiedBacklogs.has(slug)) {
      options.notifiedBacklogs.add(slug)
      await orchestrator.clearPendingNotifications(slug)
    }
  }

  function run(agent: HostAgentLike, presetOverride: string | undefined, source: string): void {
    void ensureInstalled(agent, presetOverride, source).catch((error) => {
      log(`per-agent tool install failed at ${source}: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  return {
    handleAgentCreated(agent) {
      if (!agent) return
      const sessionId = typeof agent.session?.id === 'string' ? agent.session.id : ''
      if (sessionId) agentBySessionId.set(sessionId, agent)
      run(agent, undefined, 'agent/created')
    },
    handleAgentDisposed(agent) {
      if (!agent) return
      for (const [slug, entry] of options.liveOacAgents) {
        if (entry === agent) options.liveOacAgents.delete(slug)
      }
      for (const [id, entry] of agentBySessionId) {
        if (entry === agent) agentBySessionId.delete(id)
      }
    },
    handlePresetSelected(session, event) {
      if (event?.type !== 'agent-preset/selected') return
      const agentPreset = (event.data as { agentPreset?: unknown } | undefined)?.agentPreset
      if (typeof agentPreset !== 'string' || agentPreset === '') return
      const sessionId = typeof session?.id === 'string' ? session.id : ''
      const agent = findAgentForSession(session, sessionId)
      if (!agent) {
        if (slugFromPresetId(agentPreset) !== undefined) {
          log(`agent-preset/selected "${agentPreset}" arrived but no live agent matches session ${sessionId || '(unknown)'}; per-agent tools not installed`)
        }
        return
      }
      if (sessionId) agentBySessionId.set(sessionId, agent)
      run(agent, agentPreset, 'agent-preset/selected')
    },
  }
}
