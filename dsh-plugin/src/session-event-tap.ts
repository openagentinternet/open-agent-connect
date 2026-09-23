/**
 * Live session-event collection. DSH deprecated the synchronous Session log
 * reads (`snapshotEvents`/`eventAt`/`ownEvents`, deepseek-harness agent note
 * 2026-09-09): the log is slated to move behind storage I/O, so turn output
 * must be consumed from the `session/event` firehose as it is delivered
 * instead of read back from history afterwards.
 */
import type { HostContext, HostSessionEventLike, HostSessionLike } from './context-types.js'

export interface SessionEventTap {
  /** Events collected so far, in arrival order. Grows until dispose(). */
  readonly events: HostSessionEventLike[]
  dispose(): void
}

/**
 * Collect one session's events from the live `session/event` firehose.
 * Subscribe BEFORE the turn starts — events are delivered synchronously on
 * append — and dispose right after the turn settles. Returns null when the
 * context has no cordis event surface (test doubles), letting callers fall
 * back to the deprecated read.
 */
export function tapSessionEvents(ctx: HostContext, sessionId: string): SessionEventTap | null {
  if (typeof ctx.on !== 'function') return null
  const events: HostSessionEventLike[] = []
  const off = ctx.on('session/event', (session: (HostSessionLike & { id?: string }) | undefined, event: HostSessionEventLike) => {
    if (!event || session?.id !== sessionId) return
    events.push(event)
  })
  return {
    events,
    dispose: () => {
      if (typeof off === 'function') off()
    },
  }
}

/**
 * The tap's collected events, or the deprecated synchronous log read when no
 * tap exists. The fallback keeps pre-tap test doubles working; on a real host
 * the cordis surface is always present, so the deprecated read stays cold.
 */
export function tappedOrSnapshot(
  tap: SessionEventTap | null,
  session: (HostSessionLike & { id?: string }) | undefined | null,
): ReadonlyArray<HostSessionEventLike> {
  if (tap) return tap.events
  return session?.snapshotEvents?.() ?? session?.events ?? []
}
