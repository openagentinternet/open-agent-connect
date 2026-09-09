/** Shared A2A unread-badge logic (host watcher + client panel). No Node or DOM APIs. */

/**
 * Unread marks keyed `<from-slug>:<peer-global-meta-id>` (private) and
 * `<chair-slug>:<task-id>` (group). The `*Seen` maps are per-conversation
 * baselines: the newest activity timestamp the user has accounted for. First
 * sight only seeds the baseline, so installing the plugin never marks
 * history unread.
 */
export type UnreadState = {
  private: Record<string, number>
  group: Record<string, number>
  privateSeen: Record<string, number>
  groupSeen: Record<string, number>
}

export const EMPTY_UNREAD: UnreadState = { private: {}, group: {}, privateSeen: {}, groupSeen: {} }

/** One changed group task, emitted by the host watcher's store diff. */
export type GroupTaskUpdate = { key: string; updatedAt: number }

export type GroupTaskRow = { chairSlug: string; id: number; updatedAt: number }

/**
 * Diff a fresh group-task list against the watcher's previous snapshot:
 * tasks whose `updatedAt` moved (or that appeared) become updates; vanished
 * tasks just drop out of the next snapshot.
 */
export function diffGroupTasks(
  prev: Readonly<Record<string, number>>,
  tasks: readonly GroupTaskRow[],
): { next: Record<string, number>; updates: GroupTaskUpdate[] } {
  const next: Record<string, number> = {}
  const updates: GroupTaskUpdate[] = []
  for (const task of tasks) {
    const key = `${task.chairSlug}:${task.id}`
    const updatedAt = task.updatedAt
    if (!Number.isFinite(updatedAt)) continue
    next[key] = updatedAt
    if (prev[key] !== updatedAt) updates.push({ key, updatedAt })
  }
  return { next, updates }
}

/**
 * Fold one group-task update: first sight seeds the baseline; a newer update
 * marks unread unless the user is viewing that task right now (then it stays
 * read). The baseline always advances, so every update is accounted once.
 */
export function applyGroupUpdate(
  state: Readonly<UnreadState>,
  update: GroupTaskUpdate,
  viewing: boolean,
): UnreadState {
  const seen = state.groupSeen[update.key]
  if (seen === undefined) {
    return {
      ...state,
      groupSeen: { ...state.groupSeen, [update.key]: update.updatedAt },
    }
  }
  if (update.updatedAt <= seen) return state
  const group = { ...state.group }
  if (viewing) delete group[update.key]
  else group[update.key] = update.updatedAt
  return {
    ...state,
    group,
    groupSeen: { ...state.groupSeen, [update.key]: update.updatedAt },
  }
}

/**
 * One conversation row against the seen baseline. `seeded` = first sight
 * (baseline only); `changed` = activity newer than the baseline, which needs
 * a thread fetch to tell peer messages from the local Bot's own sends;
 * `current` = nothing new.
 */
export function privateRowStatus(
  state: Readonly<UnreadState>,
  key: string,
  latestAt: number,
): 'seeded' | 'changed' | 'current' {
  if (!Number.isFinite(latestAt)) return 'current'
  const seen = state.privateSeen[key]
  if (seen === undefined) return 'seeded'
  return latestAt > seen ? 'changed' : 'current'
}

/**
 * Fold the thread check for a `changed` row: an inbound latest message marks
 * unread; a local one (own sends, auto-replies) only advances the baseline —
 * the local Bot's own activity must never light a badge.
 */
export function applyPrivateLatest(
  state: Readonly<UnreadState>,
  key: string,
  latestAt: number,
  isLocal: boolean,
): UnreadState {
  const priv = { ...state.private }
  if (isLocal) delete priv[key]
  else priv[key] = latestAt
  return {
    ...state,
    private: priv,
    privateSeen: { ...state.privateSeen, [key]: latestAt },
  }
}

/** Seed a private baseline without marking unread (first sight). */
export function seedPrivateSeen(
  state: Readonly<UnreadState>,
  key: string,
  latestAt: number,
): UnreadState {
  return { ...state, privateSeen: { ...state.privateSeen, [key]: latestAt } }
}

/** Any unread mark at all — drives the sidebar-foot entry dot. */
export function hasAnyUnread(state: Readonly<UnreadState>): boolean {
  return Object.keys(state.private).length > 0 || Object.keys(state.group).length > 0
}
