/**
 * One shared push subscription for "the Bot set changed" (client half).
 *
 * `/oac/api/bots/events` (host `bot-events.ts`) pushes a `bots-changed`
 * frame whenever a Bot is created, edited, toggled, or deleted — through
 * the plugin's own routes or a CLI/daemon write picked up by the host's
 * registry watch. Every Bot picker in the client fetches its list once on
 * mount, and the surfaces stay mounted across Bot edits (the Bots page
 * overlays the conversation column, visited sections stay alive, and 新会话
 * reuses the current blank session without remounting the hero), so a
 * mounted picker would otherwise keep a stale roster until a full reload.
 *
 * This module owns the single EventSource for that feed and hands out two
 * faces: `subscribeToBotChanges` for store controllers (the preset-seat
 * controller reloads roster + Bots on every push) and `useBotsRevision`
 * for React pickers (a revision to add to the mount-effect deps, refetching
 * the list when it moves).
 */

import { useEffect, useState } from 'react'

type Listener = () => void

const listeners = new Set<Listener>()
let source: EventSource | null = null

/**
 * The connection is opened lazily on the first subscriber and then kept
 * for the page lifetime: pickers mount and unmount constantly, one idle
 * EventSource is cheaper than reconnect churn, and the browser retries a
 * dropped connection on its own.
 */
function ensureSource(): void {
  if (source !== null) return
  try {
    source = new EventSource('/oac/api/bots/events')
  } catch {
    return
  }
  source.addEventListener('bots-changed', () => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // one picker's refetch must not break the rest
      }
    }
  })
}

/** Run `listener` on every `bots-changed` push; returns an unsubscribe. */
export function subscribeToBotChanges(listener: Listener): () => void {
  listeners.add(listener)
  ensureSource()
  return () => {
    listeners.delete(listener)
  }
}

/**
 * A revision that increments on every `bots-changed` push. Add it to a
 * picker's mount-effect deps so the Bot list refetches the moment the Bot
 * set changes under a mounted picker.
 */
export function useBotsRevision(): number {
  const [revision, setRevision] = useState(0)
  useEffect(() => subscribeToBotChanges(() => {
    setRevision((value) => value + 1)
  }), [])
  return revision
}
