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
 * through untouched.
 *
 * These lists are THE list surfaces for A2A chat since the panel restructure
 * (the center overlay is a pure reading pane): rows carry the IDBots hover
 * menu (Copy Session ID / Rename / Pin / Archive), the 群任务 list carries
 * the engine-health note, the pending staffing slate (the owner's confirm
 * surface), the OpenTeam guest collaborations, and the + button that opens
 * the panel's create-task modal. Rows navigate: clicking an online
 * conversation, group task, or collab opens the A2A Chat overlay
 * pre-positioned on it (the pending-target path through A2APanelStore).
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button, IconPlusOutline16, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  BotRow,
  ConversationSummary,
  GroupTaskHealthPayload,
  GroupTaskStaffingProposalRow,
  GroupTaskStatus,
  GroupTaskSummaryRow,
  OpenTeamCollabsPayload,
} from './api.ts'
import { resolveAvatarUrl } from '../avatar-url.ts'
import { prefetchAvatars } from './avatar-cache.ts'
import { BotAvatar } from './BotAvatar.tsx'
import { ConversationRowMenu } from './ConversationRowMenu.tsx'
import { guestInviteStatusKey, type GroupTaskInjectedApi } from './GroupTaskView.tsx'
import { pickDefaultBotSlug } from '../bot-order.ts'
import { relativeTimeLabel } from '../relative-time.ts'
import { timestampLabel } from './api.ts'
import type { UnreadState } from '../unread-logic.ts'
import { CONV_TABS, loadConvFrom, saveConvFrom, type ConvTab } from '../conv-tab-logic.ts'
import type { ConvTabState } from './conv-tab-store.ts'
import type { ConversationsLocaleKey } from './locale-conversations.ts'

export type ConvTabsTranslate =
  (key: ConversationsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

export interface ConvTabsInjected {
  bots: () => Promise<BotRow[]>
  list: (from: string) => Promise<ConversationSummary[]>
  grouptaskList: () => Promise<GroupTaskSummaryRow[]>
  /** The full group-task api (row menus, health, staffing, collabs). */
  grouptask: GroupTaskInjectedApi
  /** UI-meta write (pin/archive/rename) on one private conversation. */
  meta: (from: string, peer: string, patch: {
    pinned?: boolean
    archived?: boolean
    displayName?: string | null
  }) => Promise<unknown>
  /** Open the A2A center overlay on one private conversation. */
  openPrivate: (from: string, peer: string) => void
  /** Open the A2A center overlay's group side on one task ('' = create modal). */
  openGroupTask: (taskKey: string) => void
  /** Open the A2A center overlay on one OpenTeam guest collaboration. */
  openCollab: (slug: string, groupId: string) => void
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

const GROUP_STATUS_KEY: Record<GroupTaskStatus, ConversationsLocaleKey> = {
  planning: 'gtStatusPlanning',
  executing: 'gtStatusExecuting',
  review: 'gtStatusReview',
  done: 'gtStatusDone',
  cancelled: 'gtStatusCancelled',
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

/** 线上对话: per-Bot A2A private conversations, newest first, IDBots hover menu. */
function OnlineList({
  bots,
  list,
  meta,
  openPrivate,
  unread,
  t,
}: Pick<ConvTabsInjected, 'bots' | 'list' | 'meta' | 'openPrivate'> & {
  unread: UnreadState
  t: ConvTabsTranslate
}): ReactNode {
  const [profiles, setProfiles] = useState<BotRow[]>([])
  const [from, setFrom] = useState(() => loadConvFrom(window.localStorage))
  const [summaries, setSummaries] = useState<ConversationSummary[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  // Row-menu rename modal (IDBots parity: empty save clears the override).
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)

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
  // exactly like the panel's summary load.
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

  // Row-menu writes (pin/archive/rename): apply, then let the SSE
  // conversation-update (published by the daemon write) plus this explicit
  // reload race to refresh the list. Failures surface in the list error slot.
  const applyConversationMeta = useCallback(async (
    peer: string,
    patch: { pinned?: boolean; archived?: boolean; displayName?: string | null },
  ): Promise<void> => {
    if (!from || !peer) return
    try {
      await meta(from, peer, patch)
      setTick((value) => value + 1)
    } catch (cause: unknown) {
      setListError(errorText(cause))
    }
  }, [from, meta])

  const submitRename = async (): Promise<void> => {
    if (renameTarget === null || renameBusy) return
    setRenameBusy(true)
    try {
      await applyConversationMeta(renameTarget, { displayName: renameDraft })
      setRenameTarget(null)
    } finally {
      setRenameBusy(false)
    }
  }

  const localAvatarByMetaId = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of profiles) {
      if (row.globalMetaId && row.avatarDataUrl) map.set(row.globalMetaId, row.avatarDataUrl)
    }
    return map
  }, [profiles])

  // Warm the local avatar cache as soon as the list arrives so a remount
  // (tab switch) paints peer faces from memory instead of the proxy.
  useEffect(() => {
    if (!summaries) return
    prefetchAvatars(summaries.map((row) => (
      resolveAvatarUrl(localAvatarByMetaId.get(row.peerGlobalMetaId) ?? row.peerAvatar ?? undefined)
    )))
  }, [summaries, localAvatarByMetaId])

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
                  <span className="oac-conv-row-time" title={timestampLabel(row.latestAt)}>
                    {relativeTimeLabel(row.latestAt)}
                  </span>
                </span>
                <span className="oac-a2a-row-text">{row.latestText}</span>
              </span>
              {unread.private[`${from}:${row.peerGlobalMetaId}`]
                ? <span className="oac-unread-dot" aria-label={t('unread')} />
                : null}
              <ConversationRowMenu
                pinned={row.pinned}
                copyId={row.conversationId}
                time={row.latestAt}
                onRename={() => {
                  setRenameTarget(row.peerGlobalMetaId)
                  setRenameDraft(row.displayName ?? '')
                }}
                onTogglePin={(pinned) => { void applyConversationMeta(row.peerGlobalMetaId, { pinned }) }}
                onArchive={() => { void applyConversationMeta(row.peerGlobalMetaId, { archived: true }) }}
                t={t}
              />
            </div>
          )
        })}
      </div>
      {/* Row-menu rename modal (DSH home-list rename pattern). */}
      <Modal
        closeLabel={t('close')}
        open={renameTarget !== null}
        onClose={() => { if (!renameBusy) setRenameTarget(null) }}
        title={t('renameConversationTitle')}
        className="oac-dialog-delete"
        footer={(
          <>
            <Button type="button" variant="outline" disabled={renameBusy} onClick={() => setRenameTarget(null)}>
              {t('guidanceCancel')}
            </Button>
            <Button type="button" variant="primary" disabled={renameBusy} onClick={() => { void submitRename() }}>
              {renameBusy ? t('sending') : t('menuRename')}
            </Button>
          </>
        )}
      >
        <div className="oac-gt-form">
          <label className="oac-gt-form-field">
            <span className="oac-gt-field-label">{t('renameConversationField')}</span>
            <Input
              value={renameDraft}
              disabled={renameBusy}
              autoFocus
              onChange={(event) => setRenameDraft(event.target.value)}
              placeholder={t('renameConversationPlaceholder')}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  if (!renameBusy) void submitRename()
                }
              }}
            />
          </label>
        </div>
      </Modal>
    </div>
  )
}

/** 群任务: the full group-task list surface — health note, staffing slate,
 * task rows with hover menus, OpenTeam collabs, and the + create button. */
function GroupList({
  grouptaskList,
  grouptask,
  openGroupTask,
  openCollab,
  unread,
  t,
}: Pick<ConvTabsInjected, 'grouptaskList' | 'grouptask' | 'openGroupTask' | 'openCollab'> & {
  unread: UnreadState
  t: ConvTabsTranslate
}): ReactNode {
  const [tasks, setTasks] = useState<GroupTaskSummaryRow[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [health, setHealth] = useState<GroupTaskHealthPayload | null>(null)
  const [staffing, setStaffing] = useState<GroupTaskStaffingProposalRow[] | null>(null)
  const [collabs, setCollabs] = useState<OpenTeamCollabsPayload>({ memberships: [], guestInvites: [] })
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  // Row-menu modals: rename + archive confirm (group archive asks first,
  // IDBots parity).
  const [renameTarget, setRenameTarget] = useState<{ key: string; chair: string; taskId: number; name: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [archiveTarget, setArchiveTarget] = useState<{ key: string; chair: string; taskId: number; name: string } | null>(null)

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

  // Health banner + pending staffing slates + collabs refresh with the list
  // (failures leave the sections hidden, panel parity).
  useEffect(() => {
    let current = true
    void grouptask.health().then(
      (payload) => { if (current) setHealth(payload) },
      () => { if (current) setHealth(null) },
    )
    void grouptask.staffingList().then(
      (rows) => { if (current) setStaffing(rows) },
      () => { if (current) setStaffing(null) },
    )
    void grouptask.collabs().then(
      (payload) => { if (current) setCollabs(payload) },
      () => { if (current) setCollabs({ memberships: [], guestInvites: [] }) },
    )
    return () => { current = false }
  }, [grouptask, tick])

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

  const runAction = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true)
    setActionError(null)
    try {
      await action()
      setTick((value) => value + 1)
      return true
    } catch (cause: unknown) {
      setActionError(errorText(cause))
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  const submitRename = async (): Promise<void> => {
    if (renameTarget === null || busy) return
    const target = renameTarget
    setBusy(true)
    try {
      await grouptask.rename(target.chair, target.taskId, renameDraft.trim())
      setRenameTarget(null)
      setTick((value) => value + 1)
    } catch (cause: unknown) {
      setActionError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  const submitArchive = async (): Promise<void> => {
    if (archiveTarget === null || busy) return
    const target = archiveTarget
    setBusy(true)
    try {
      await grouptask.archive(target.chair, target.taskId, true)
      setArchiveTarget(null)
      setTick((value) => value + 1)
    } catch (cause: unknown) {
      setActionError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  const healthWarnings: string[] = []
  if (health) {
    if (!health.chairSlug) healthWarnings.push(t('gtHealthNoChair', { reason: health.chairReason ?? '' }))
    if (!health.ownerPresent) healthWarnings.push(t('gtHealthNoOwner'))
    if (!health.simplemsgListenerEnabled) healthWarnings.push(t('gtHealthListenerOff'))
  }

  const pendingSlate = staffing?.find((row) => row.createdTaskId === null
    && (row.status === 'pending' || row.status === 'confirmed' || row.status === 'skip_authorized')) ?? null

  return (
    <div className="oac-conv-list-body">
      <div className="oac-conv-list-head">
        <span className="oac-conv-list-title">{t('convTabGroup')}</span>
        <Button
          type="button"
          variant="primary"
          size="sm"
          icon={<IconPlusOutline16 />}
          aria-label={t('gtNew')}
          title={t('gtNew')}
          onClick={() => { openGroupTask('') }}
        />
      </div>
      {healthWarnings.length > 0
        ? <p className="oac-note error">{healthWarnings.join(' · ')}</p>
        : null}
      {pendingSlate !== null ? (
        <div className="oac-gt-staffing oac-conv-staffing">
          <div className="oac-gt-staffing-title">
            <span>{t('gtStaffingTitle')}</span>
            <span className="oac-a2a-row-name">{pendingSlate.title}</span>
          </div>
          {pendingSlate.seats.map((seat) => (
            <div className="oac-gt-staffing-seat" key={`${seat.role}:${seat.candidateName}`}>
              <span className="oac-gt-badge">{seat.role}</span>
              <span className="oac-a2a-row-name">{seat.candidateName}</span>
              <span className="oac-a2a-row-text">{seat.source === 'remote' ? t('gtRemote') : t('gtLocalSeat')}</span>
            </div>
          ))}
          <div className="oac-gt-staffing-actions">
            {pendingSlate.status === 'pending' ? (
              <>
                <Button type="button" variant="primary" size="sm" disabled={busy} onClick={() => { void runAction(() => grouptask.staffingDecide(pendingSlate.chairSlug, pendingSlate.id, 'confirm')) }}>
                  {t('gtStaffingConfirm')}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { void runAction(() => grouptask.staffingDecide(pendingSlate.chairSlug, pendingSlate.id, 'revise')) }}>
                  {t('gtStaffingRevise')}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { void runAction(() => grouptask.staffingDecide(pendingSlate.chairSlug, pendingSlate.id, 'skip')) }}>
                  {t('gtStaffingSkip')}
                </Button>
              </>
            ) : (
              <Button type="button" variant="primary" size="sm" disabled={busy} onClick={() => { void runAction(() => grouptask.staffingCreate(pendingSlate.id)) }}>
                {t('gtStaffingCreate')}
              </Button>
            )}
          </div>
        </div>
      ) : null}
      {listError ? <p className="oac-note error">{listError}</p> : null}
      {actionError ? <p className="oac-note error">{actionError}</p> : null}
      <div className="oac-conv-list-rows">
        {tasks === null ? <p className="oac-note saving">{t('gtLoading')}</p> : null}
        {tasks !== null && tasks.length === 0 && collabs.memberships.length === 0 ? (
          <p className="oac-note">{t('gtEmpty')}</p>
        ) : null}
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
                  <span className="oac-conv-row-time" title={timestampLabel(task.updatedAt)}>
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
              <ConversationRowMenu
                pinned={task.pinned}
                copyId={task.groupId || `#${task.id}`}
                time={task.updatedAt}
                disabled={busy}
                onRename={() => {
                  setRenameDraft(task.displayName ?? task.title)
                  setRenameTarget({ key, chair: task.chairSlug, taskId: task.id, name: rowTitle })
                }}
                onTogglePin={(pinned) => { void runAction(() => grouptask.pin(task.chairSlug, task.id, pinned)) }}
                onArchive={() => setArchiveTarget({ key, chair: task.chairSlug, taskId: task.id, name: rowTitle })}
                t={t}
              />
            </div>
          )
        })}
        {collabs.memberships.length > 0 || collabs.guestInvites.length > 0 ? (
          <div className="oac-gt-collabs">
            <span className="oac-gt-collabs-title">{t('gtCollabs')}</span>
            {collabs.memberships.map((collab) => (
              <div
                key={`${collab.groupId}:${collab.slug}`}
                role="button"
                tabIndex={0}
                className="oac-a2a-row oac-gt-row oac-conv-row"
                onClick={() => { openCollab(collab.slug, collab.groupId) }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openCollab(collab.slug, collab.groupId)
                  }
                }}
              >
                <span className="oac-a2a-row-main">
                  <span className="oac-gt-row-title">
                    <span className="oac-a2a-row-name">{collab.taskTitle || collab.groupId}</span>
                    <span className="oac-gt-badge oac-gt-openteam">{t('gtOpenTeam')}</span>
                  </span>
                  <span className="oac-gt-row-meta">
                    <span className={collab.status === 'active' ? 'oac-gt-badge oac-gt-status-executing' : 'oac-gt-badge oac-gt-status-cancelled'}>
                      {collab.status === 'active' ? t('gtCollabActive') : t('gtCollabLeft')}
                    </span>
                    <span className="oac-a2a-row-text">{collab.botName}</span>
                  </span>
                </span>
                {collab.activatedAt !== null ? (
                  <span className="oac-a2a-row-time" title={timestampLabel(collab.activatedAt)}>
                    {relativeTimeLabel(collab.activatedAt)}
                  </span>
                ) : null}
              </div>
            ))}
            {collabs.guestInvites
              .filter((invite) => !collabs.memberships.some(
                (collab) => collab.groupId === invite.groupId && collab.slug === invite.slug,
              ))
              .map((invite) => (
                <div key={invite.inviteId} className="oac-a2a-row oac-gt-row oac-gt-guest-invite">
                  <span className="oac-a2a-row-main">
                    <span className="oac-gt-row-title">
                      <span className="oac-a2a-row-name">{invite.taskTitle || invite.groupId}</span>
                      <span className="oac-gt-badge oac-gt-openteam">{t('gtOpenTeam')}</span>
                    </span>
                    <span className="oac-gt-row-meta">
                      <span className="oac-gt-badge">{t(guestInviteStatusKey(invite.status))}</span>
                      <span className="oac-a2a-row-text">{invite.botName}</span>
                    </span>
                  </span>
                  <span className="oac-a2a-row-time" title={timestampLabel(invite.createdAt)}>
                    {relativeTimeLabel(invite.createdAt)}
                  </span>
                </div>
              ))}
          </div>
        ) : null}
      </div>
      {/* Row-menu rename modal. */}
      <Modal
        closeLabel={t('close')}
        open={renameTarget !== null}
        onClose={() => { if (!busy) setRenameTarget(null) }}
        title={t('renameConversationTitle')}
        className="oac-dialog-delete"
        footer={(
          <>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setRenameTarget(null)}>
              {t('guidanceCancel')}
            </Button>
            <Button type="button" variant="primary" disabled={busy} onClick={() => { void submitRename() }}>
              {busy ? t('sending') : t('menuRename')}
            </Button>
          </>
        )}
      >
        <div className="oac-gt-form">
          <label className="oac-gt-form-field">
            <span className="oac-gt-field-label">{t('renameConversationField')}</span>
            <Input
              value={renameDraft}
              disabled={busy}
              autoFocus
              onChange={(event) => setRenameDraft(event.target.value)}
              placeholder={t('renameConversationPlaceholder')}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  if (!busy) void submitRename()
                }
              }}
            />
          </label>
        </div>
      </Modal>
      {/* Group-task archive confirm (IDBots parity: archive asks first). */}
      <Modal
        closeLabel={t('close')}
        open={archiveTarget !== null}
        onClose={() => { if (!busy) setArchiveTarget(null) }}
        title={t('gtArchiveConfirmTitle')}
        className="oac-dialog-delete"
        footer={(
          <>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setArchiveTarget(null)}>
              {t('guidanceCancel')}
            </Button>
            <Button type="button" variant="primary" disabled={busy} onClick={() => { void submitArchive() }}>
              {busy ? t('sending') : t('menuArchive')}
            </Button>
          </>
        )}
      >
        <p className="oac-note">{t('gtArchiveConfirmMessage')}</p>
      </Modal>
    </div>
  )
}

/** The mounted surface: strip always; lists only while their tab is active. */
export function ConvTabs({
  bots,
  list,
  grouptaskList,
  grouptask,
  meta,
  openPrivate,
  openGroupTask,
  openCollab,
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
        <OnlineList bots={bots} list={list} meta={meta} openPrivate={openPrivate} unread={unread} t={t} />
      ) : null}
      {tab === 'group' ? (
        <GroupList
          grouptaskList={grouptaskList}
          grouptask={grouptask}
          openGroupTask={openGroupTask}
          openCollab={openCollab}
          unread={unread}
          t={t}
        />
      ) : null}
    </div>
  )
}
