/** Shared A2A unread-badge logic (host watcher + client panel). No Node or DOM APIs. */

/**
 * Unread marks keyed `<from-slug>:<peer-global-meta-id>` (private) and
 * `<chair-slug>:<task-id>` (group). The `*Seen` maps are per-conversation
 * baselines: the newest activity timestamp the user has accounted for. First
 * sight only seeds the baseline, so installing the plugin never marks
 * history unread. `privateCounts` carries the unread message COUNT per
 * private key (IDBots numeric-badge parity); presence in `private` still
 * drives boolean dots where a count is not shown.
 */
export type UnreadState = {
  private: Record<string, number>
  group: Record<string, number>
  privateSeen: Record<string, number>
  groupSeen: Record<string, number>
  privateCounts: Record<string, number>
}

export const EMPTY_UNREAD: UnreadState = { private: {}, group: {}, privateSeen: {}, groupSeen: {}, privateCounts: {} }

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
 * Fold one group-task update. The HOST primes its own diff baseline at stream
 * start, so every frame here is a genuine change: first sight marks unread
 * (unless the user is viewing that task right now) instead of seeding —
 * seeding here would swallow a new task's first activity. The baseline
 * always advances, so every update is accounted once.
 */
export function applyGroupUpdate(
  state: Readonly<UnreadState>,
  update: GroupTaskUpdate,
  viewing: boolean,
): UnreadState {
  const seen = state.groupSeen[update.key] ?? Number.NEGATIVE_INFINITY
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
 * Fold the thread check for a `changed` row: inbound messages mark unread
 * (and add their count); a local one (own sends, auto-replies) only advances
 * the baseline — the local Bot's own activity must never light a badge.
 */
export function applyPrivateLatest(
  state: Readonly<UnreadState>,
  key: string,
  latestAt: number,
  isLocal: boolean,
  unseenInboundCount = 1,
): UnreadState {
  const priv = { ...state.private }
  let privateCounts = state.privateCounts
  if (isLocal) {
    delete priv[key]
    if (privateCounts[key] !== undefined) privateCounts = { ...privateCounts }
    delete privateCounts[key]
  } else {
    priv[key] = latestAt
    privateCounts = {
      ...privateCounts,
      [key]: Math.max(1, Math.trunc(unseenInboundCount) || 1) + (privateCounts[key] ?? 0),
    }
  }
  return {
    ...state,
    private: priv,
    privateCounts,
    privateSeen: { ...state.privateSeen, [key]: latestAt },
  }
}

/**
 * Clear one private unread mark (the user opened the thread) while keeping
 * the seen baseline at the worst accounted timestamp. Every written map is
 * copied: snapshot stores may deep-freeze the state, so an in-place write
 * throws. Returns null when the key carries no mark, so the caller can skip
 * the store write entirely.
 */
export function clearPrivateMark(
  state: Readonly<UnreadState>,
  key: string,
): UnreadState | null {
  const marked = state.private[key]
  if (marked === undefined) return null
  const priv = { ...state.private }
  delete priv[key]
  const privateCounts = { ...state.privateCounts }
  delete privateCounts[key]
  return {
    ...state,
    private: priv,
    privateCounts,
    privateSeen: { ...state.privateSeen, [key]: Math.max(state.privateSeen[key] ?? 0, marked) },
  }
}

/** Group-task twin of `clearPrivateMark`. */
export function clearGroupMark(
  state: Readonly<UnreadState>,
  key: string,
): UnreadState | null {
  const marked = state.group[key]
  if (marked === undefined) return null
  const group = { ...state.group }
  delete group[key]
  return {
    ...state,
    group,
    groupSeen: { ...state.groupSeen, [key]: Math.max(state.groupSeen[key] ?? 0, marked) },
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

/** Total unread private messages across conversations (numeric badges). */
export function sumPrivateUnreadCounts(state: Readonly<UnreadState>): number {
  let total = 0
  for (const value of Object.values(state.privateCounts)) {
    const count = Math.trunc(Number(value))
    if (Number.isFinite(count) && count > 0) total += count
  }
  return total
}
