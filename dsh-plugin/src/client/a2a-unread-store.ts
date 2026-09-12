/**
 * A2A unread feed (client half, apply scope).
 *
 * The unread dots used to live inside the A2A overlay panel, so they only
 * worked while the panel was open. The panel now opens from a
 * `sidebar.panellist` glyph (a `shell.overlay` entry, id `oac-a2a`), and the
 * feed lives here at apply scope so the glyph's dot works no matter which
 * panel is selected: one SSE subscription to `/oac/api/chat/events/all` folds
 * private and group-task changes into one persisted UnreadState both the
 * glyph and the panel read through the inject `hooks` compartment.
 *
 * The panel feeds its live view (`setView`) so the thread/task the user is
 * reading right now stays read; unmounting the panel clears the feed.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConversationMessage, ConversationSummary, ConversationThread } from './api.ts'
import {
  applyGroupUpdate,
  applyPrivateLatest,
  EMPTY_UNREAD,
  privateRowStatus,
  seedPrivateSeen,
  type UnreadState,
} from '../unread-logic.ts'

const UNREAD_STORAGE_KEY = 'oac-dsh:a2a-unread:v1'

/** A first-sight row only lights a badge when its latest message is inbound AND fresh. */
const FRESH_MS = 10 * 60_000

function readUnreadState(): UnreadState {
  const fallback: UnreadState = EMPTY_UNREAD
  try {
    const raw = window.localStorage.getItem(UNREAD_STORAGE_KEY)
    if (!raw) return fallback
    const value = JSON.parse(raw) as Partial<UnreadState>
    return {
      private: value.private && typeof value.private === 'object' ? value.private : {},
      group: value.group && typeof value.group === 'object' ? value.group : {},
      privateSeen: value.privateSeen && typeof value.privateSeen === 'object' ? value.privateSeen : {},
      groupSeen: value.groupSeen && typeof value.groupSeen === 'object' ? value.groupSeen : {},
    }
  } catch {
    return fallback
  }
}

function writeUnreadState(state: UnreadState): void {
  try { window.localStorage.setItem(UNREAD_STORAGE_KEY, JSON.stringify(state)) } catch { /* storage may be disabled */ }
}

function isLocalMessage(message: ConversationMessage): boolean {
  const direction = message.direction.toLowerCase()
  return direction === 'outbound' || direction === 'outgoing'
}

/** What the mounted A2A panel is showing right now; null while it is not selected. */
export type A2AUnreadView = {
  mode: 'private' | 'grouptask'
  from: string
  selectedPeer: string
  /** The group task key (`<chair>:<taskId>`) the user opened last; '' while none is on screen. */
  taskKey: string
} | null

/** The daemon reads the feed needs to tell peer activity from local sends. */
export interface A2AUnreadApi {
  list: (from: string) => Promise<ConversationSummary[]>
  thread: (from: string, peer: string) => Promise<ConversationThread>
}

export class A2AUnreadController {
  private readonly store = createSnapshotStore<UnreadState>(readUnreadState())
  private view: A2AUnreadView = null

  constructor(private readonly api: A2AUnreadApi) {}

  /** The observable face the inject `hooks` compartment binds to `useUnread`. */
  readonly source: SnapshotStore<UnreadState> = this.store

  private update(next: UnreadState): void {
    writeUnreadState(next)
    this.store.set(next)
  }

  /** Feed the panel's live view; the panel clears it (null) on unmount. */
  setView(view: A2AUnreadView): void {
    this.view = view
  }

  clearPrivateUnread(from: string, peer: string): void {
    if (!from || !peer) return
    const key = `${from}:${peer}`
    const state = this.store.getSnapshot()
    if (!(key in state.private)) return
    const next = { ...state, private: { ...state.private } }
    delete next.private[key]
    next.privateSeen[key] = Math.max(next.privateSeen[key] ?? 0, state.private[key] ?? 0)
    this.update(next)
  }

  clearGroupUnread(key: string): void {
    const state = this.store.getSnapshot()
    if (!(key in state.group)) return
    const next = { ...state, group: { ...state.group } }
    delete next.group[key]
    next.groupSeen[key] = Math.max(next.groupSeen[key] ?? 0, state.group[key] ?? 0)
    this.update(next)
  }

  /**
   * Always-on unread feed (SSE rewrite of the 2026-09-07 polling badge): the
   * host watches every Bot's conversation store file and the synced
   * grouptask stores (chat-watcher.ts) and pushes change signals over one
   * idle connection — no polling, so the browser connection pool the old
   * O(bots × threads) poller starved stays free. Private changes re-check
   * only the touched Bot's rows (a thread fetch tells peer messages from the
   * local Bot's own sends/auto-replies); group updates arrive pre-diffed.
   */
  start(): () => void {
    let source: EventSource
    try {
      source = new EventSource('/oac/api/chat/events/all')
    } catch {
      return () => {}
    }
    const privateTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const fold = (mutate: (state: UnreadState) => UnreadState): void => {
      this.update(mutate(this.store.getSnapshot()))
    }
    // A first-sight row is almost always a brand-new conversation's first
    // message (the stream only fires on real store changes) — mark it read
    // only when the latest message is inbound AND fresh, so store rewrites
    // of old threads never light a badge.
    const checkThread = (from: string, peer: string, key: string, latestAt: number, firstSight: boolean): void => {
      void this.api.thread(from, peer).then((conversation) => {
        const latest = conversation.messages[conversation.messages.length - 1]
        if (latest === undefined) return
        if (firstSight) {
          const fresh = latest.timestamp >= Date.now() - FRESH_MS
          fold((state) => applyPrivateLatest(
            state,
            key,
            Math.max(latest.timestamp, latestAt),
            isLocalMessage(latest) || !fresh,
          ))
          return
        }
        fold((state) => applyPrivateLatest(
          state,
          key,
          Math.max(latest.timestamp, latestAt),
          isLocalMessage(latest),
        ))
      }).catch(() => {
        // transient read failure: the next change retries
      })
    }
    const checkPrivate = (from: string): void => {
      const timer = privateTimers.get(from)
      if (timer !== undefined) clearTimeout(timer)
      privateTimers.set(from, setTimeout(() => {
        privateTimers.delete(from)
        void this.api.list(from).then((rows) => {
          const view = this.view
          for (const row of rows) {
            const key = `${from}:${row.peerGlobalMetaId}`
            const status = privateRowStatus(this.store.getSnapshot(), key, row.latestAt)
            if (status === 'seeded') {
              checkThread(from, row.peerGlobalMetaId, key, row.latestAt, true)
            } else if (status === 'changed') {
              // The thread the user is reading right now stays read.
              if (view !== null && view.mode === 'private' && view.from === from
                && view.selectedPeer === row.peerGlobalMetaId) {
                fold((state) => seedPrivateSeen(state, key, row.latestAt))
                continue
              }
              checkThread(from, row.peerGlobalMetaId, key, row.latestAt, false)
            }
          }
        }).catch(() => {
          // transient daemon/read failure: the next change retries
        })
      }, 600))
    }
    const onPrivateChanged = (event: MessageEvent<string>): void => {
      try {
        const from = (JSON.parse(event.data) as { from?: unknown }).from
        if (typeof from === 'string' && from !== '') checkPrivate(from)
      } catch {
        // malformed frame
      }
    }
    const onGroupUpdate = (event: MessageEvent<string>): void => {
      try {
        const updates = (JSON.parse(event.data) as { updates?: unknown }).updates
        if (!Array.isArray(updates)) return
        const view = this.view
        for (const update of updates) {
          if (update === null || typeof update !== 'object') continue
          const { key, updatedAt } = update as { key?: unknown; updatedAt?: unknown }
          if (typeof key !== 'string' || typeof updatedAt !== 'number') continue
          const viewing = view !== null && view.mode === 'grouptask' && view.taskKey === key
          fold((state) => applyGroupUpdate(state, { key, updatedAt }, viewing))
        }
      } catch {
        // malformed frame
      }
    }
    source.addEventListener('private-conversations-changed', onPrivateChanged)
    source.addEventListener('group-task-update', onGroupUpdate)
    return () => {
      source.close()
      for (const timer of privateTimers.values()) clearTimeout(timer)
      privateTimers.clear()
    }
  }
}
