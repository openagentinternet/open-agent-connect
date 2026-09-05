/**
 * Source-session relay drain ("哪里发起哪里结束"): a host-lifetime timer calls
 * `metabot grouptask relay drain` (across all chair profiles) and delivers
 * every milestone back into the DSH chat that originated the task. Delivery is
 * two-tier: a direct followup when the origin session is live, otherwise the
 * row waits in a pending map and is appended to that session's NEXT turn via
 * the agent/pre-step waterfall (the same seam as memory injection) — so a
 * closed chat still catches up when the owner returns to it.
 */
import { randomUUID } from 'node:crypto'
import { runMetabot, type MetabotCommandResult } from './cli-bridge.js'
import { resolveDaemonBaseUrl } from './browser-bridge.js'
import { liveOacAgents } from './twin-tools.js'
import type {
  HostContext,
  HostPreStepDecision,
  HostPreStepPayload,
  HostUserMessage,
} from './context-types.js'
import type { RunFn } from './cli-payload.js'

export interface GroupTaskRelayRow {
  id: number
  taskId: number
  groupId: string | null
  sessionId: string
  kind: string
  title: string
  text: string
  createdAt: number
  chairSlug?: string
}

const DEFAULT_TICK_MS = 30_000
const READ_TIMEOUT_MS = 60_000

export interface GroupTaskRelayOptions {
  run?: RunFn
  tickMs?: number
  /** Daemon liveness probe override (tests). */
  daemonAlive?: () => Promise<boolean>
}

export interface GroupTaskRelayDrainer {
  /** One drain + delivery pass (exposed for tests and manual flushes). */
  drainOnce(): Promise<number>
  stop(): void
}

function relayTextOf(row: GroupTaskRelayRow): string {
  return `[Group Task] ${row.title}\n${row.text}`
}

function relayMessageOf(text: string): HostUserMessage {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'oac-dsh', form: 'group-task-relay' },
  }
}

export function applyGroupTaskRelayDrain(
  ctx: HostContext,
  options: GroupTaskRelayOptions = {},
): GroupTaskRelayDrainer {
  const run = options.run ?? runMetabot
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS
  const daemonAlive = options.daemonAlive ?? daemonAliveByHttp
  /** Rows that could not be delivered live, keyed by origin session id. */
  const pendingBySession = new Map<string, string[]>()
  /** Delivered-row dedupe across scheduler ticks and pre-step races. */
  const deliveredKeys = new Set<string>()

  function deliver(row: GroupTaskRelayRow): boolean {
    const key = `${row.chairSlug ?? ''}:${row.id}`
    if (deliveredKeys.has(key)) return true
    for (const agent of liveOacAgents.values()) {
      if (agent.session?.id === row.sessionId && agent.followup) {
        try {
          agent.followup(relayMessageOf(relayTextOf(row)))
          deliveredKeys.add(key)
          return true
        } catch {
          break // dead agent: fall through to the pending path
        }
      }
    }
    const list = pendingBySession.get(row.sessionId) ?? []
    list.push(relayTextOf(row))
    pendingBySession.set(row.sessionId, list)
    return false
  }

  /** Raw-HTTP daemon probe: never auto-start a daemon from a poller. */
  async function daemonAliveByHttp(): Promise<boolean> {
    try {
      const base = await resolveDaemonBaseUrl()
      if (!base) return false
      const response = await fetch(`${base}/api/grouptask/health`, { signal: AbortSignal.timeout(2_500) })
      return response.ok
    } catch {
      return false
    }
  }

  async function drainOnce(): Promise<number> {
    if (!(await daemonAlive())) return 0
    const result: MetabotCommandResult = await run(['grouptask', 'relay', 'drain'], {
      timeoutMs: READ_TIMEOUT_MS,
    })
    if (!result.ok) return 0
    const rows = (result.data as { relayed?: GroupTaskRelayRow[] } | undefined)?.relayed ?? []
    for (const row of rows) deliver(row)
    return rows.length
  }

  if (ctx.on) {
    ctx.on(
      'agent/pre-step',
      async (
        payload: HostPreStepPayload,
        next: () => Promise<HostPreStepDecision>,
      ): Promise<HostPreStepDecision> => {
        const decision = await next()
        if (decision.kind !== 'enter' || !Array.isArray(decision.messages)) return decision
        try {
          const sessionId = payload.agent?.session?.id
          if (!sessionId) return decision
          const pending = pendingBySession.get(sessionId)
          if (!pending || pending.length === 0) return decision
          pendingBySession.delete(sessionId)
          const text = pending.join('\n\n')
          return {
            kind: 'enter',
            messages: [...decision.messages, {
              id: randomUUID(),
              role: 'user' as const,
              content: [{ type: 'text' as const, text }],
              source: { kind: 'plugin', plugin: 'oac-dsh', form: 'group-task-relay' },
            }],
          }
        } catch {
          return decision
        }
      },
      { prepend: true },
    )
  }

  const timer = setInterval(() => {
    void drainOnce().catch(() => undefined)
  }, tickMs)
  timer.unref?.()

  return {
    drainOnce,
    stop(): void {
      clearInterval(timer)
    },
  }
}
