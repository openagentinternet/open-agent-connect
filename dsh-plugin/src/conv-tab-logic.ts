/**
 * Conversation-list tabs (本地对话 / 线上对话 / 群任务): pure state helpers.
 *
 * IDBots parity: the left conversation list carries three tabs — local DSH
 * sessions, A2A private conversations, and group tasks. The local tab IS the
 * official browsing region (`sidebar.workspaces`, untouched); the other two
 * render OAC lists in its place while active. Everything DOM-shaped lives in
 * the client half (conv-tab-mount.ts); this module stays importable from the
 * host build so tests can drive it without a browser.
 */

/** The three tabs, in strip order. */
export type ConvTab = 'local' | 'online' | 'group'

export const CONV_TABS: readonly ConvTab[] = ['local', 'online', 'group']

/** localStorage key for the remembered tab (IDBots `taskRecordTab` parity). */
export const CONV_TAB_STORAGE_KEY = 'oac-dsh:conv-tab:v1'

/** localStorage key for the online list's remembered from-Bot slug. */
export const CONV_TAB_FROM_STORAGE_KEY = 'oac-dsh:conv-tab-from:v1'

/**
 * `<html>` class present exactly while a non-local tab owns the browsing
 * region; the CSS hides the official region for that class only. Toggled by
 * the mount, never by the component, so a crashed component cannot strand
 * the official list hidden.
 */
export const CONV_TABS_ACTIVE_CLASS = 'oac-conv-tabs-active'

/**
 * Below this rendered width the sidebar is the collapsed 56px rail: the strip
 * hides (tabs do not fit) and the official region must show its rail icons,
 * so the active class drops and the tab resets to local.
 */
export const CONV_TAB_RAIL_PX = 100

export function isConvTab(value: unknown): value is ConvTab {
  return value === 'local' || value === 'online' || value === 'group'
}

/** Read the remembered tab; anything unreadable or invalid falls back to local. */
export function loadConvTab(storage: Pick<Storage, 'getItem'> | null | undefined): ConvTab {
  try {
    const raw = storage?.getItem(CONV_TAB_STORAGE_KEY)
    if (isConvTab(raw)) return raw
  } catch {
    // storage may be unavailable
  }
  return 'local'
}

/** Persist the tab; storage failures are non-fatal by design. */
export function saveConvTab(storage: Pick<Storage, 'setItem'> | null | undefined, tab: ConvTab): void {
  try {
    storage?.setItem(CONV_TAB_STORAGE_KEY, tab)
  } catch {
    // storage may be unavailable
  }
}

/** Read the online list's remembered from-Bot slug ('' = pick the default). */
export function loadConvFrom(storage: Pick<Storage, 'getItem'> | null | undefined): string {
  try {
    const raw = storage?.getItem(CONV_TAB_FROM_STORAGE_KEY)
    if (typeof raw === 'string' && raw !== '') return raw
  } catch {
    // storage may be unavailable
  }
  return ''
}

/** Persist the from-Bot slug; storage failures are non-fatal by design. */
export function saveConvFrom(storage: Pick<Storage, 'setItem'> | null | undefined, slug: string): void {
  try {
    if (typeof slug === 'string' && slug !== '') storage?.setItem(CONV_TAB_FROM_STORAGE_KEY, slug)
  } catch {
    // storage may be unavailable
  }
}

/**
 * Parse a group-task key (`<chairSlug>:<taskId>`, the same form
 * GroupTaskView's rows and the unread feed use). The slug never contains a
 * colon, so the LAST separator wins even if a future slug charset changes.
 */
export function parseGroupTaskKey(key: string): { chair: string; taskId: number } | null {
  if (typeof key !== 'string') return null
  const at = key.lastIndexOf(':')
  if (at <= 0 || at >= key.length - 1) return null
  const chair = key.slice(0, at)
  const taskId = Number.parseInt(key.slice(at + 1), 10)
  if (!Number.isInteger(taskId) || taskId <= 0) return null
  return { chair, taskId }
}
