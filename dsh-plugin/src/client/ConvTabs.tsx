/**
 * Conversation-list tabs (client half): the 本地对话 / 线上对话 / 群任务 strip
 * mounted above the official browsing region, plus the two OAC list bodies
 * that replace it while their tab is active.
 *
 * The strip and the lists render through a plain React root
 * (conv-tab-mount.ts) — the official `sidebar.workspaces` region is never
 * re-hosted, only visually replaced (the mount hides it via the
 * `oac-conv-tabs-active` html class while a non-local tab owns the column).
 * The local tab renders nothing but the strip: the official browser shows
 * through untouched. Rows navigate, they do not render threads — clicking an
 * online conversation or a group task opens the A2A Chat center overlay
 * pre-positioned on that thread (the pending-target path through
 * A2APanelStore), so the left column is the IDBots-style navigation surface
 * and the center overlay stays the reading surface.
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { BotRow, ConversationSummary, GroupTaskStatus, GroupTaskSummaryRow } from './api.ts'
import { BotAvatar } from './BotAvatar.tsx'
import { pickDefaultBotSlug } from '../bot-order.ts'
import { relativeTimeLabel } from '../relative-time.ts'
import type { UnreadState } from '../unread-logic.ts'
import { CONV_TABS, loadConvFrom, saveConvFrom, type ConvTab } from '../conv-tab-logic.ts'
import type { ConvTabState } from './conv-tab-store.ts'
import type { ConversationsLocaleKey } from './locale-conversations.ts'

export type ConvTabsTranslate =
  (key: ConversationsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

const GROUP_STATUS_KEY: Record<GroupTaskStatus, ConversationsLocaleKey> = {
  planning: 'gtStatusPlanning',
  executing: 'gtStatusExecuting',
  review: 'gtStatusReview',
  done: 'gtStatusDone',
  cancelled: 'gtStatusCancelled',
}

export interface ConvTabsInjected {
  bots: () => Promise<BotRow[]>
  list: (from: string) => Promise<ConversationSummary[]>
  grouptaskList: () => Promise<GroupTaskSummaryRow[]>
  /** Open the A2A center overlay on one private conversation. */
  openPrivate: (from: string, peer: string) => void
  /** Open the A2A center overlay's Group Tasks tab on one task. */
  openGroupTask: (taskKey: string) => void
  /** Switch the active tab (persists through the store). */
  setTab: (tab: ConvTab) => void
  hooks: {
    /** The apply-scope conversation-tab store. */
    tabs: SnapshotStore<ConvTabState>
    /** The apply-scope A2A unread feed (tab dots + row dots). */
    unread: SnapshotStore<UnreadState>
  }
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

const TAB_LABEL_KEY: Record<ConvTab, ConversationsLocaleKey> = {
  local: 'convTabLocal',
  online: 'convTabOnline',
  group: 'convTabGroup',
}

/** The three-cell strip; dots mark unread online chats / group tasks. */
function TabStrip({
  tab,
  hasOnlineUnread,
  hasGroupUnread,
  onSelect,
  t,
}: {
  tab: ConvTab
  hasOnlineUnread: boolean
  hasGroupUnread: boolean
  onSelect: (tab: ConvTab) => void
  t: ConvTabsTranslate
}): ReactNode {
  return (
    <div className="oac-conv-tablist" role="tablist" aria-label={t('convTabStripLabel')}>
      {CONV_TABS.map((key) => {
        const dot = key === 'online' ? hasOnlineUnread : key === 'group' ? hasGroupUnread : false
        return (
          <button
            key={key}
            type="button"
            role="tab"
            className="oac-conv-tab"
            aria-selected={tab === key}
            title={t(TAB_LABEL_KEY[key])}
            onClick={() => { onSelect(key) }}
          >
            <span className="oac-conv-tab-label">{t(TAB_LABEL_KEY[key])}</span>
            {dot ? <span className="oac-conv-tab-dot" aria-hidden="true" /> : null}
          </button>
        )
      })}
    </div>
  )
}

/** 线上对话: per-Bot A2A private conversations, newest first. */
function OnlineList({
  bots,
  list,
  openPrivate,
  unread,
  t,
}: Pick<ConvTabsInjected, 'bots' | 'list' | 'openPrivate'> & {
  unread: UnreadState
  t: ConvTabsTranslate
}): ReactNode {
  const [profiles, setProfiles] = useState<BotRow[]>([])
  const [from, setFrom] = useState(() => loadConvFrom(window.localStorage))
  const [summaries, setSummaries] = useState<ConversationSummary[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let current = true
    void bots().then((rows) => {
      if (!current) return
      setProfiles(rows)
      setFrom((currentFrom) => {
        if (currentFrom && rows.some((row) => row.slug === currentFrom)) return currentFrom
        return pickDefaultBotSlug(rows)
      })
    }).catch((cause: unknown) => {
      if (current) setListError(errorText(cause))
    })
    return () => { current = false }
  }, [bots])

  useEffect(() => {
    if (!from) return undefined
    let current = true
    void list(from).then(
      (rows) => {
        if (!current) return
        setSummaries(rows)
        setListError(null)
      },
      (cause: unknown) => {
        if (!current) return
        setListError(errorText(cause))
        setSummaries([])
      },
    )
    return () => { current = false }
  }, [from, list, tick])

  // Live refresh: the daemon's per-Bot conversation SSE (stored-row changes
  // and warm-up completions) reloads the list with one debounced burst,
  // exactly like the A2A panel's list.
  useEffect(() => {
    if (!from) return undefined
    let source: EventSource | null = null
    try {
      source = new EventSource(`/oac/api/chat/events?from=${encodeURIComponent(from)}`)
    } catch {
      return undefined
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const onUpdate = (): void => {
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        setTick((value) => value + 1)
      }, 400)
    }
    source.addEventListener('conversation-update', onUpdate)
    return () => {
      if (timer !== null) clearTimeout(timer)
      source.close()
    }
  }, [from])

  const localAvatarByMetaId = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of profiles) {
      if (row.globalMetaId && row.avatarDataUrl) map.set(row.globalMetaId, row.avatarDataUrl)
    }
    return map
  }, [profiles])

  return (
    <div className="oac-conv-list-body">
      <div className="oac-conv-list-head">
        <select
          className="oac-input oac-input-select"
          value={from}
          disabled={profiles.length === 0}
          aria-label={t('fieldBot')}
          onChange={(event) => {
            const slug = event.target.value
            saveConvFrom(window.localStorage, slug)
            setFrom(slug)
            setSummaries(null)
          }}
        >
          {profiles.map((bot) => (
            <option key={bot.slug} value={bot.slug}>{bot.name}</option>
          ))}
        </select>
      </div>
      {listError ? <p className="oac-note error">{listError}</p> : null}
      <div className="oac-conv-list-rows">
        {summaries === null ? <p className="oac-note saving">{t('loading')}</p> : null}
        {summaries !== null && summaries.length === 0 ? <p className="oac-note">{t('empty')}</p> : null}
        {summaries?.map((row) => {
          const rowTitle = row.displayName?.trim() || row.peerName || row.peerGlobalMetaId
          return (
            <div
              key={row.conversationId || row.peerGlobalMetaId}
              role="button"
              tabIndex={0}
              className="oac-a2a-row oac-conv-row"
              onClick={() => { openPrivate(from, row.peerGlobalMetaId) }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  openPrivate(from, row.peerGlobalMetaId)
                }
              }}
            >
              <BotAvatar
                name={rowTitle}
                src={localAvatarByMetaId.get(row.peerGlobalMetaId) ?? row.peerAvatar ?? undefined}
                className="oac-a2a-row-avatar"
              />
              <span className="oac-a2a-row-main">
                <span className="oac-conv-row-top">
                  <span className="oac-a2a-row-name">{rowTitle}</span>
                  <span className="oac-conv-row-time" title={String(row.latestAt)}>
                    {relativeTimeLabel(row.latestAt)}
                  </span>
                </span>
                <span className="oac-a2a-row-text">{row.latestText}</span>
              </span>
              {unread.private[`${from}:${row.peerGlobalMetaId}`]
                ? <span className="oac-unread-dot" aria-label={t('unread')} />
                : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 群任务: active group tasks (all statuses, archived hidden), newest update first. */
function GroupList({
  grouptaskList,
  openGroupTask,
  unread,
  t,
}: Pick<ConvTabsInjected, 'grouptaskList' | 'openGroupTask'> & {
  unread: UnreadState
  t: ConvTabsTranslate
}): ReactNode {
  const [tasks, setTasks] = useState<GroupTaskSummaryRow[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let current = true
    void grouptaskList().then(
      (rows) => {
        if (!current) return
        setTasks([...rows].sort((a, b) => b.updatedAt - a.updatedAt))
        setListError(null)
      },
      (cause: unknown) => {
        if (!current) return
        setListError(errorText(cause))
        setTasks([])
      },
    )
    return () => { current = false }
  }, [grouptaskList, tick])

  // Live refresh: pre-diffed group-task frames on the always-on unread feed.
  useEffect(() => {
    let source: EventSource
    try {
      source = new EventSource('/oac/api/chat/events/all')
    } catch {
      return undefined
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const onUpdate = (): void => {
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        setTick((value) => value + 1)
      }, 400)
    }
    source.addEventListener('group-task-update', onUpdate)
    return () => {
      if (timer !== null) clearTimeout(timer)
      source.close()
    }
  }, [])

  return (
    <div className="oac-conv-list-body">
      {listError ? <p className="oac-note error">{listError}</p> : null}
      <div className="oac-conv-list-rows">
        {tasks === null ? <p className="oac-note saving">{t('gtLoading')}</p> : null}
        {tasks !== null && tasks.length === 0 ? <p className="oac-note">{t('gtEmpty')}</p> : null}
        {tasks?.map((task) => {
          const key = `${task.chairSlug}:${task.id}`
          const rowTitle = task.displayName?.trim() || task.title
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              className="oac-a2a-row oac-gt-row oac-conv-row"
              onClick={() => { openGroupTask(key) }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  openGroupTask(key)
                }
              }}
            >
              <span className="oac-a2a-row-main">
                <span className="oac-conv-row-top">
                  <span className="oac-a2a-row-name">{rowTitle}</span>
                  <span className="oac-conv-row-time" title={String(task.updatedAt)}>
                    {relativeTimeLabel(task.updatedAt)}
                  </span>
                </span>
                <span className="oac-gt-row-meta">
                  <span className={`oac-gt-badge oac-gt-status-${task.status}`}>
                    {t(GROUP_STATUS_KEY[task.status])}
                  </span>
                  <span className="oac-a2a-row-text">{t('gtMemberCount', { count: task.memberCount })}</span>
                </span>
              </span>
              {unread.group[key] ? <span className="oac-unread-dot" aria-label={t('unread')} /> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** The mounted surface: strip always; lists only while their tab is active. */
export function ConvTabs({
  bots,
  list,
  grouptaskList,
  openPrivate,
  openGroupTask,
  setTab,
  hooks,
  t,
}: ConvTabsInjected & { t: ConvTabsTranslate }): ReactNode {
  const tab = useSyncExternalStore(hooks.tabs.subscribe, () => hooks.tabs.getSnapshot().tab)
  const unread = useSyncExternalStore(hooks.unread.subscribe, hooks.unread.getSnapshot)
  const hasOnlineUnread = Object.keys(unread.private).length > 0
  const hasGroupUnread = Object.keys(unread.group).length > 0
  return (
    <div className="oac-conv-tabs-host">
      <TabStrip
        tab={tab}
        hasOnlineUnread={hasOnlineUnread}
        hasGroupUnread={hasGroupUnread}
        onSelect={setTab}
        t={t}
      />
      {tab === 'online' ? (
        <OnlineList bots={bots} list={list} openPrivate={openPrivate} unread={unread} t={t} />
      ) : null}
      {tab === 'group' ? (
        <GroupList grouptaskList={grouptaskList} openGroupTask={openGroupTask} unread={unread} t={t} />
      ) : null}
    </div>
  )
}
