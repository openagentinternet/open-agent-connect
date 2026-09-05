import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconSendOutline16,
  IconWarningOutline16,
  Input,
  MarkdownText,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import {
  timestampLabel,
  txidPreview,
  type BotRow,
  type GroupTaskDetailPayload,
  type GroupTaskHealthPayload,
  type GroupTaskListTab,
  type GroupTaskMemberRow,
  type GroupTaskMessageRow,
  type GroupTaskStaffingProposalRow,
  type GroupTaskSummaryRow,
  type OpenTeamCollabRow,
  type OpenTeamCollabsPayload,
  type OpenTeamGuestInviteRow,
} from './api.ts'
import { BotAvatar, BotAvatarButton } from './BotAvatar.tsx'
import { CopyIconButton } from './CopyIconButton.tsx'
import { relativeTimeLabel } from '../relative-time.ts'
import type { ConversationsLocaleKey } from './locale-conversations.ts'
import { markdownLabels } from './markdown-labels.ts'

type Translate = (key: ConversationsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

export interface GroupTaskInjectedApi {
  list: (tab: GroupTaskListTab, includeArchived: boolean) => Promise<GroupTaskSummaryRow[]>
  detail: (chair: string, taskId: number) => Promise<GroupTaskDetailPayload>
  create: (input: {
    title: string
    goal: string
    acceptanceCriteria?: string
    workerSlugs?: string[]
    chairSlug?: string
  }) => Promise<{ chairSlug: string; taskId: number }>
  post: (chair: string, taskId: number, input: { content: string; asSlug?: string; asOwner?: boolean }) => Promise<unknown>
  close: (
    chair: string,
    taskId: number,
    input: { outcome: 'done' | 'cancelled'; rating?: number; ratingComment?: string; reason?: string },
  ) => Promise<unknown>
  reopen: (chair: string, taskId: number, reason?: string) => Promise<unknown>
  kick: (chair: string, taskId: number, member: { slug?: string; globalMetaId?: string }, reason?: string) => Promise<unknown>
  rename: (chair: string, taskId: number, displayName: string) => Promise<unknown>
  pin: (chair: string, taskId: number, pinned: boolean) => Promise<unknown>
  archive: (chair: string, taskId: number, archived: boolean) => Promise<unknown>
  invite: (
    chair: string,
    taskId: number,
    input: { globalMetaId: string; name?: string; requiredSkills?: string[]; allowReinvite?: boolean },
  ) => Promise<unknown>
  collabs: () => Promise<OpenTeamCollabsPayload>
  collabMessages: (slug: string, groupId: string) => Promise<{ collab: OpenTeamCollabRow; messages: GroupTaskMessageRow[] }>
  health: () => Promise<GroupTaskHealthPayload>
  staffingList: () => Promise<GroupTaskStaffingProposalRow[]>
  staffingDecide: (chair: string, proposalId: number, decision: 'confirm' | 'revise' | 'skip') => Promise<unknown>
  staffingCreate: (proposalId: number) => Promise<{ taskId: number; pendingRemoteSeats: number }>
}

const DETAIL_POLL_MS = 15_000

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function taskLabel(task: { displayName: string | null; title: string }): string {
  return task.displayName?.trim() || task.title
}

function statusKey(status: GroupTaskSummaryRow['status']): ConversationsLocaleKey {
  switch (status) {
    case 'planning': return 'gtStatusPlanning'
    case 'executing': return 'gtStatusExecuting'
    case 'review': return 'gtStatusReview'
    case 'done': return 'gtStatusDone'
    case 'cancelled': return 'gtStatusCancelled'
  }
}

function workStatusKey(workStatus: GroupTaskMemberRow['workStatus']): ConversationsLocaleKey {
  switch (workStatus) {
    case 'working': return 'gtWorkWorking'
    case 'idle': return 'gtWorkIdle'
    case 'timeout': return 'gtWorkTimeout'
    case 'error': return 'gtWorkError'
    default: return 'gtWorkUnknown'
  }
}

function guestInviteStatusKey(status: OpenTeamGuestInviteRow['status']): ConversationsLocaleKey {
  switch (status) {
    case 'accepted': return 'gtGuestInviteAccepted'
    case 'declined': return 'gtGuestInviteDeclined'
    case 'skipped': return 'gtGuestInviteSkipped'
    case 'expired': return 'gtGuestInviteExpired'
    default: return 'gtGuestInviteInvited'
  }
}

function StatusBadge({ status, t }: { status: GroupTaskSummaryRow['status']; t: Translate }): ReactNode {
  return <span className={`oac-gt-badge oac-gt-status-${status}`}>{t(statusKey(status))}</span>
}

/** One row in the left task list: pin marker, title, badges, members, time. */
function TaskListRow({
  task,
  active,
  onSelect,
  t,
}: {
  task: GroupTaskSummaryRow
  active: boolean
  onSelect: () => void
  t: Translate
}): ReactNode {
  return (
    <button
      type="button"
      className={active ? 'oac-a2a-row oac-gt-row active' : 'oac-a2a-row oac-gt-row'}
      onClick={onSelect}
    >
      <span className="oac-a2a-row-main">
        <span className="oac-gt-row-title">
          {task.pinned ? <span className="oac-gt-pin-mark" title={t('gtPinned')}>★</span> : null}
          <span className="oac-a2a-row-name">{taskLabel(task)}</span>
          {task.openTeam ? <span className="oac-gt-badge oac-gt-openteam">{t('gtOpenTeam')}</span> : null}
        </span>
        <span className="oac-gt-row-meta">
          <StatusBadge status={task.status} t={t} />
          <span className="oac-a2a-row-text">{t('gtMemberCount', { count: task.memberCount })}</span>
        </span>
      </span>
      <span className="oac-a2a-row-time" title={timestampLabel(task.updatedAt)}>
        {relativeTimeLabel(task.updatedAt)}
      </span>
    </button>
  )
}

/** Star rating input/display (1-5). */
function Stars({ value, onChange }: { value: number; onChange?: (value: number) => void }): ReactNode {
  return (
    <span className="oac-gt-stars">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          className={star <= value ? 'oac-gt-star on' : 'oac-gt-star'}
          disabled={!onChange}
          onClick={() => onChange?.(star)}
        >
          ★
        </button>
      ))}
    </span>
  )
}

/**
 * Group Task surface inside the A2A panel: task list on the left, task detail
 * (info, members, deliverables, checkpoint banner, transcript, composer) on
 * the right — the OAC port of the IDBots Bot Home group-task page.
 * `createSignal` increments when the panel header's New button is pressed.
 */
export function GroupTaskView({
  bots,
  gt,
  t,
  createSignal,
  onOpenBotPage,
}: {
  bots: BotRow[]
  gt: GroupTaskInjectedApi
  t: Translate
  createSignal: number
  /** Open one participant's Bot page in the right-sidebar Bot Browser. */
  onOpenBotPage?: (globalMetaId: string) => void
}): ReactNode {
  // Default to the full list (all statuses, like the IDBots sidebar group
  // tab); the active/done/cancelled tabs remain available in the filter.
  const [filter, setFilter] = useState<GroupTaskListTab>('all')
  const [tasks, setTasks] = useState<GroupTaskSummaryRow[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ chair: string; taskId: number } | null>(null)
  const [detail, setDetail] = useState<GroupTaskDetailPayload | null>(null)
  const [detailStatus, setDetailStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [detailError, setDetailError] = useState<string | null>(null)
  const [actionNote, setActionNote] = useState<string | null>(null)
  const [infoNote, setInfoNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  const mdLabels = useMemo(() => markdownLabels(t), [t])

  // Composer — the owner speaks as the owner (IDBots parity: no sender select).
  const [draft, setDraft] = useState('')

  // Create modal
  const [createOpen, setCreateOpen] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newGoal, setNewGoal] = useState('')
  const [newAcceptance, setNewAcceptance] = useState('')
  const [newChair, setNewChair] = useState('')
  const [newWorkers, setNewWorkers] = useState<string[]>([])

  // Close modal
  const [closeOpen, setCloseOpen] = useState(false)
  const [closeOutcome, setCloseOutcome] = useState<'done' | 'cancelled'>('done')
  const [closeRating, setCloseRating] = useState(5)
  const [closeComment, setCloseComment] = useState('')

  // Kick confirm modal
  const [kickTarget, setKickTarget] = useState<GroupTaskMemberRow | null>(null)

  // Rename modal
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')

  // OpenTeam: guest-side collaborations (memberships + received invites)
  const [collabs, setCollabs] = useState<OpenTeamCollabsPayload>({ memberships: [], guestInvites: [] })
  const [health, setHealth] = useState<GroupTaskHealthPayload | null>(null)
  const [staffing, setStaffing] = useState<GroupTaskStaffingProposalRow[] | null>(null)
  const [selectedCollab, setSelectedCollab] = useState<{ slug: string; groupId: string } | null>(null)
  const [collabDetail, setCollabDetail] = useState<{ collab: OpenTeamCollabRow; messages: GroupTaskMessageRow[] } | null>(null)
  const [collabStatus, setCollabStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [collabError, setCollabError] = useState<string | null>(null)

  // OpenTeam: invite-remote modal (chair side)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteGmid, setInviteGmid] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteSkills, setInviteSkills] = useState('')

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastCreateSignal = useRef(createSignal)

  const reload = useCallback((): void => setTick((value) => value + 1), [])

  useEffect(() => {
    if (createSignal !== lastCreateSignal.current) {
      lastCreateSignal.current = createSignal
      setCreateError(null)
      setCreateOpen(true)
    }
  }, [createSignal])

  // Task list follows the filter; keep the previous rows on screen during
  // reloads so the list does not flash.
  useEffect(() => {
    let current = true
    void gt.list(filter, filter === 'all').then(
      (rows) => {
        if (!current) return
        setTasks(rows)
        setListError(null)
        setSelected((value) => {
          if (value && rows.some((row) => row.chairSlug === value.chair && row.id === value.taskId)) return value
          const first = rows[0]
          return first ? { chair: first.chairSlug, taskId: first.id } : null
        })
      },
      (cause: unknown) => {
        if (!current) return
        setListError(errorText(cause))
        setTasks([])
      },
    )
    return () => { current = false }
  }, [gt, filter, tick])

  // Guest-side collaborations refresh with the list (failures leave the
  // section hidden rather than surfacing an error).
  useEffect(() => {
    let current = true
    void gt.collabs().then(
      (payload) => { if (current) setCollabs(payload) },
      () => { if (current) setCollabs({ memberships: [], guestInvites: [] }) },
    )
    return () => { current = false }
  }, [gt, tick])

  // Preflight banner: chair/owner/listener prerequisites plus the recent
  // engine log, refreshed with the list so silent failures become visible.
  useEffect(() => {
    let current = true
    void gt.health().then(
      (payload) => { if (current) setHealth(payload) },
      () => { if (current) setHealth(null) },
    )
    return () => { current = false }
  }, [gt, tick])

  // Staffing slates awaiting the owner gate (propose comes from the
  // twin/CLI; the card is the owner's confirm surface).
  useEffect(() => {
    let current = true
    void gt.staffingList().then(
      (rows) => { if (current) setStaffing(rows) },
      () => { if (current) setStaffing(null) },
    )
    return () => { current = false }
  }, [gt, tick])

  const loadCollab = useCallback(async (target: { slug: string; groupId: string }, silent = false): Promise<void> => {
    if (!silent) {
      setCollabStatus('loading')
      setCollabError(null)
    }
    try {
      const data = await gt.collabMessages(target.slug, target.groupId)
      setCollabDetail(data)
      setCollabStatus('ready')
    } catch (cause) {
      if (!silent) {
        setCollabError(errorText(cause))
        setCollabStatus('error')
      }
    }
  }, [gt])

  useEffect(() => {
    if (!selectedCollab) {
      setCollabDetail(null)
      setCollabStatus('idle')
      return
    }
    void loadCollab(selectedCollab)
    const poll = setInterval(() => { void loadCollab(selectedCollab, true) }, DETAIL_POLL_MS)
    return () => clearInterval(poll)
  }, [selectedCollab, loadCollab])

  const loadDetail = useCallback(async (target: { chair: string; taskId: number }, silent = false): Promise<void> => {
    if (!silent) {
      setDetailStatus('loading')
      setDetailError(null)
    }
    try {
      const data = await gt.detail(target.chair, target.taskId)
      setDetail(data)
      setDetailStatus('ready')
    } catch (cause) {
      if (!silent) {
        setDetailError(errorText(cause))
        setDetailStatus('error')
      }
    }
  }, [gt])

  useEffect(() => {
    if (!selected) {
      setDetail(null)
      setDetailStatus('idle')
      return
    }
    setActionNote(null)
    setInfoNote(null)
    void loadDetail(selected)
    pollRef.current = setInterval(() => { void loadDetail(selected, true) }, DETAIL_POLL_MS)
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [selected, loadDetail])

  const runAction = useCallback(async (work: () => Promise<unknown>, refreshList = true): Promise<boolean> => {
    setBusy(true)
    setActionNote(null)
    try {
      await work()
      if (selected) await loadDetail(selected, true)
      if (refreshList) reload()
      return true
    } catch (cause) {
      setActionNote(`${t('gtActionFailed')} ${errorText(cause)}`)
      return false
    } finally {
      setBusy(false)
    }
  }, [selected, loadDetail, reload, t])

  const onSend = async (): Promise<void> => {
    const content = draft.trim()
    if (!selected || !content || busy) return
    const sent = await runAction(() => gt.post(selected.chair, selected.taskId, { content, asOwner: true }), false)
    if (sent) setDraft('')
  }

  const onCreate = async (): Promise<void> => {
    const title = newTitle.trim()
    const goal = newGoal.trim()
    if (!title || !goal || createBusy) return
    setCreateBusy(true)
    setCreateError(null)
    try {
      const created = await gt.create({
        title,
        goal,
        acceptanceCriteria: newAcceptance.trim() || undefined,
        workerSlugs: newWorkers.length > 0 ? newWorkers : undefined,
        chairSlug: newChair || undefined,
      })
      setCreateOpen(false)
      setNewTitle('')
      setNewGoal('')
      setNewAcceptance('')
      setNewWorkers([])
      setFilter('active')
      setSelected({ chair: created.chairSlug, taskId: created.taskId })
      reload()
    } catch (cause) {
      setCreateError(`${t('gtCreateFailed')} ${errorText(cause)}`)
    } finally {
      setCreateBusy(false)
    }
  }

  const onCloseTask = async (): Promise<void> => {
    if (!selected) return
    const input = closeOutcome === 'done'
      ? { outcome: closeOutcome, rating: closeRating, ratingComment: closeComment.trim() || undefined }
      : { outcome: closeOutcome, reason: closeComment.trim() || undefined }
    const done = await runAction(() => gt.close(selected.chair, selected.taskId, input))
    if (done) setCloseOpen(false)
  }

  const onKick = async (): Promise<void> => {
    if (!selected || !kickTarget) return
    const member = kickTarget.slug ? { slug: kickTarget.slug } : { globalMetaId: kickTarget.globalMetaId ?? '' }
    const done = await runAction(() => gt.kick(selected.chair, selected.taskId, member))
    if (done) setKickTarget(null)
  }

  const onRename = async (): Promise<void> => {
    if (!selected) return
    const done = await runAction(() => gt.rename(selected.chair, selected.taskId, renameDraft.trim()))
    if (done) setRenameOpen(false)
  }

  const onInvite = async (): Promise<void> => {
    const globalMetaId = inviteGmid.trim()
    if (!selected || !globalMetaId || inviteBusy) return
    setInviteBusy(true)
    setInviteError(null)
    try {
      const requiredSkills = inviteSkills.split(',').map((entry) => entry.trim()).filter(Boolean)
      await gt.invite(selected.chair, selected.taskId, {
        globalMetaId,
        name: inviteName.trim() || undefined,
        requiredSkills: requiredSkills.length > 0 ? requiredSkills : undefined,
      })
      setInviteOpen(false)
      setInviteGmid('')
      setInviteName('')
      setInviteSkills('')
      setInfoNote(t('gtInviteSent'))
    } catch (cause) {
      setInviteError(`${t('gtInviteFailed')} ${errorText(cause)}`)
    } finally {
      setInviteBusy(false)
    }
  }

  const decideStaffing = useCallback(async (
    proposal: GroupTaskStaffingProposalRow,
    decision: 'confirm' | 'revise' | 'skip',
  ): Promise<void> => {
    const ok = await runAction(() => gt.staffingDecide(proposal.chairSlug, proposal.id, decision), true)
    if (ok) {
      setInfoNote(t(decision === 'confirm'
        ? 'gtStaffingConfirmed'
        : decision === 'skip' ? 'gtStaffingSkipped' : 'gtStaffingReopened'))
    }
  }, [gt, runAction, t])

  const createFromStaffing = useCallback(async (proposal: GroupTaskStaffingProposalRow): Promise<void> => {
    const created = await runAction(async () => gt.staffingCreate(proposal.id), true)
    if (created) setInfoNote(t('gtStaffingCreated'))
  }, [gt, runAction, t])

  const terminal = detail !== null && (detail.status === 'done' || detail.status === 'cancelled')
  const twinBot = bots.find((bot) => bot.botType === 'twin') ?? null

  const healthWarnings: string[] = []
  if (health) {
    if (!health.chairSlug) healthWarnings.push(t('gtHealthNoChair', { reason: health.chairReason ?? '' }))
    if (!health.ownerPresent) healthWarnings.push(t('gtHealthNoOwner'))
    if (!health.simplemsgListenerEnabled) healthWarnings.push(t('gtHealthListenerOff'))
  }
  const healthDetail = health?.engineLogLines.length
    ? health.engineLogLines.join('\n')
    : null

  const pendingSlate = staffing?.find((row) => row.createdTaskId === null
    && (row.status === 'pending' || row.status === 'confirmed' || row.status === 'skip_authorized')) ?? null

  return (
    <div className="oac-a2a-body">
      <div className="oac-a2a-list">
        <div className="oac-a2a-list-head">
          <select
            className="oac-input oac-input-select"
            value={filter}
            aria-label={t('gtFilterAll')}
            onChange={(event) => setFilter(event.target.value as GroupTaskListTab)}
          >
            <option value="active">{t('gtFilterActive')}</option>
            <option value="done">{t('gtFilterDone')}</option>
            <option value="cancelled">{t('gtFilterCancelled')}</option>
            <option value="all">{t('gtFilterAll')}</option>
          </select>
          <Button type="button" variant="outline" size="sm" icon={<IconRefreshOutline16 />} onClick={reload}>
            {t('gtRefresh')}
          </Button>
        </div>
        {health !== null
          ? (
            <p
              className={healthWarnings.length > 0 ? 'oac-note error' : 'oac-note saving'}
              title={healthDetail ?? t('gtHealthOkDetail', {
                chair: health.chairSlug ?? '',
                active: health.activeTasks,
                total: health.totalTasks,
              })}
            >
              {healthWarnings.length > 0
                ? healthWarnings.join(' · ')
                : t('gtHealthOk', { chair: health.chairSlug ?? '', active: health.activeTasks })}
            </p>
          )
          : null}
        {pendingSlate !== null
          ? (
            <div className="oac-gt-staffing">
              <div className="oac-gt-staffing-title">
                <span>{t('gtStaffingTitle')}</span>
                <span className="oac-a2a-row-name">{pendingSlate.title}</span>
                {pendingSlate.status !== 'pending'
                  ? <span className="oac-gt-badge oac-gt-status-executing">{t('gtStaffingReady')}</span>
                  : null}
              </div>
              {pendingSlate.seats.map((seat) => (
                <div className="oac-gt-staffing-seat" key={`${seat.role}:${seat.candidateName}`}>
                  <span className="oac-gt-badge">{seat.role}</span>
                  <span className="oac-a2a-row-name">{seat.candidateName}</span>
                  <span className="oac-a2a-row-text">{seat.source === 'remote' ? t('gtRemote') : t('gtLocalSeat')}</span>
                  {seat.reason ? <span className="oac-a2a-row-text">· {seat.reason}</span> : null}
                </div>
              ))}
              <div className="oac-gt-staffing-actions">
                {pendingSlate.status === 'pending'
                  ? (
                    <>
                      <Button type="button" variant="primary" size="sm" disabled={busy} onClick={() => { void decideStaffing(pendingSlate, 'confirm') }}>
                        {t('gtStaffingConfirm')}
                      </Button>
                      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { void decideStaffing(pendingSlate, 'revise') }}>
                        {t('gtStaffingRevise')}
                      </Button>
                      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { void decideStaffing(pendingSlate, 'skip') }}>
                        {t('gtStaffingSkip')}
                      </Button>
                    </>
                  )
                  : (
                    <Button type="button" variant="primary" size="sm" disabled={busy} onClick={() => { void createFromStaffing(pendingSlate) }}>
                      {t('gtStaffingCreate')}
                    </Button>
                  )}
              </div>
            </div>
          )
          : null}
        {listError ? <p className="oac-note error">{listError}</p> : null}
        <div className="oac-a2a-list-rows">
          {tasks === null ? <p className="oac-note saving">{t('gtLoading')}</p> : null}
          {tasks !== null && tasks.length === 0 ? <p className="oac-note">{t('gtEmpty')}</p> : null}
          {tasks?.map((task) => (
            <TaskListRow
              key={`${task.chairSlug}:${task.id}`}
              task={task}
              active={selectedCollab === null && selected?.chair === task.chairSlug && selected.taskId === task.id}
              onSelect={() => {
                setSelectedCollab(null)
                setSelected({ chair: task.chairSlug, taskId: task.id })
              }}
              t={t}
            />
          ))}
          {collabs.memberships.length > 0 || collabs.guestInvites.length > 0 ? (
            <div className="oac-gt-collabs">
              <span className="oac-gt-collabs-title">{t('gtCollabs')}</span>
              {collabs.memberships.map((collab) => (
                <button
                  key={`${collab.groupId}:${collab.slug}`}
                  type="button"
                  className={
                    selectedCollab?.groupId === collab.groupId && selectedCollab.slug === collab.slug
                      ? 'oac-a2a-row oac-gt-row active'
                      : 'oac-a2a-row oac-gt-row'
                  }
                  onClick={() => setSelectedCollab({ slug: collab.slug, groupId: collab.groupId })}
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
                </button>
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
      </div>
      <div className="oac-a2a-thread">
        {selectedCollab !== null ? (
          <>
            {collabStatus === 'idle' || collabStatus === 'loading' ? (
              <div className="oac-gt-placeholder"><span className="oac-note saving">{t('gtLoading')}</span></div>
            ) : null}
            {collabStatus === 'error' ? (
              <div className="oac-gt-placeholder"><span className="oac-note error">{collabError ?? t('gtError')}</span></div>
            ) : null}
            {collabStatus === 'ready' && collabDetail !== null ? (() => {
              const collab = collabDetail.collab
              const guestBot = bots.find((bot) => bot.slug === collab.slug)
              const guestGmid = (guestBot?.globalMetaId ?? '').toLowerCase()
              return (
                <>
                  <div className="oac-a2a-thread-head oac-gt-head">
                    <div className="oac-gt-head-main">
                      <strong>{collab.taskTitle || collab.groupId}</strong>
                      <span className="oac-gt-head-badges">
                        <span className="oac-gt-badge oac-gt-openteam">{t('gtOpenTeam')}</span>
                        <span className={collab.status === 'active'
                          ? 'oac-gt-badge oac-gt-status-executing'
                          : 'oac-gt-badge oac-gt-status-cancelled'}
                        >
                          {collab.status === 'active' ? t('gtCollabActive') : t('gtCollabLeft')}
                        </span>
                      </span>
                    </div>
                  </div>
                  <div className="oac-gt-detail">
                    <section className="oac-gt-section">
                      {collab.goalSummary ? (
                        <div className="oac-gt-field">
                          <span className="oac-gt-field-label">{t('gtGoal')}</span>
                          <p className="oac-gt-field-value">{collab.goalSummary}</p>
                        </div>
                      ) : null}
                      <p className="oac-note">
                        {t('gtCollabBy', { name: collab.inviterName ?? collab.inviterGlobalMetaId })}
                        {' · '}
                        {t('gtCollabReadonly')}
                      </p>
                    </section>
                    <section className="oac-gt-section oac-gt-transcript">
                      <span className="oac-gt-field-label">{t('gtTranscript')}</span>
                      {collabDetail.messages.length === 0 ? <p className="oac-note">{t('gtNoMessages')}</p> : null}
                      {collabDetail.messages.map((message) => {
                        const isMarkdown = message.contentType === 'text/markdown'
                        const ownMessage = guestGmid !== ''
                          && (message.senderGlobalMetaId ?? '').toLowerCase() === guestGmid
                        const senderName = message.senderName ?? message.senderGlobalMetaId ?? '?'
                        return (
                          <div
                            key={message.pinId ?? `idx-${message.index}`}
                            className="oac-a2a-msg oac-a2a-msg-peer oac-gt-msg"
                          >
                            {message.senderGlobalMetaId && onOpenBotPage
                              ? (
                                <BotAvatarButton
                                  name={senderName}
                                  src={message.senderAvatar ?? undefined}
                                  className="oac-a2a-msg-avatar"
                                  label={`${t('openBotPage')}: ${senderName}`}
                                  onClick={() => onOpenBotPage(message.senderGlobalMetaId ?? '')}
                                />
                              )
                              : (
                                <BotAvatar
                                  name={senderName}
                                  src={message.senderAvatar ?? undefined}
                                  className="oac-a2a-msg-avatar"
                                />
                              )}
                            <div className="oac-a2a-msg-body">
                              <div className="oac-a2a-msg-head">
                                <span className="oac-a2a-msg-name">
                                  {senderName}
                                  {ownMessage ? <span className="oac-gt-badge oac-gt-chair">{t('gtYourBot')}</span> : null}
                                </span>
                                <span className="oac-a2a-msg-meta">
                                  {message.txid ? (
                                    <span className="oac-a2a-msg-txid">
                                      <span className="oac-a2a-msg-txid-text">txid: {txidPreview(message.txid)}</span>
                                      <CopyIconButton
                                        value={message.txid}
                                        label={`${t('copyTxid')}: ${message.txid}`}
                                        copiedLabel={t('copied')}
                                      />
                                    </span>
                                  ) : null}
                                  <span className="oac-a2a-msg-time" title={timestampLabel(message.timestamp)}>
                                    {relativeTimeLabel(message.timestamp)}
                                  </span>
                                </span>
                              </div>
                              <div className="oac-a2a-bubble oac-a2a-bubble-peer">
                                {isMarkdown
                                  ? <MarkdownText text={message.content} labels={mdLabels} />
                                  : <span className="oac-a2a-msg-text">{message.content}</span>}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </section>
                  </div>
                </>
              )
            })() : null}
          </>
        ) : (
          <>
        {detailStatus === 'idle' ? (
          <div className="oac-gt-placeholder"><span className="oac-note">{t('gtSelectTask')}</span></div>
        ) : null}
        {detailStatus === 'loading' ? (
          <div className="oac-gt-placeholder"><span className="oac-note saving">{t('gtLoading')}</span></div>
        ) : null}
        {detailStatus === 'error' ? (
          <div className="oac-gt-placeholder"><span className="oac-note error">{detailError ?? t('gtError')}</span></div>
        ) : null}
        {detailStatus === 'ready' && detail !== null ? (
          <>
            <div className="oac-a2a-thread-head oac-gt-head">
              <div className="oac-gt-head-main">
                <strong>{taskLabel(detail)}</strong>
                <span className="oac-gt-head-badges">
                  <StatusBadge status={detail.status} t={t} />
                  {detail.openTeam ? <span className="oac-gt-badge oac-gt-openteam">{t('gtOpenTeam')}</span> : null}
                  {detail.stall && !terminal ? (
                    <span className="oac-gt-badge oac-gt-stall"><IconWarningOutline16 size={12} />{t('gtStall')}</span>
                  ) : null}
                  {detail.rating !== null ? <Stars value={detail.rating} /> : null}
                </span>
              </div>
              <div className="oac-gt-head-actions">
                {!terminal ? (
                  <>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setCloseOutcome('done')
                        setCloseRating(5)
                        setCloseComment('')
                        setCloseOpen(true)
                      }}
                    >
                      {t('gtAccept')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="oac-danger-outline"
                      disabled={busy}
                      onClick={() => {
                        setCloseOutcome('cancelled')
                        setCloseComment('')
                        setCloseOpen(true)
                      }}
                    >
                      {t('gtCancelTask')}
                    </Button>
                  </>
                ) : null}
                {detail.status === 'review' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => { void runAction(() => gt.reopen(detail.chairSlug, detail.id)) }}
                  >
                    {t('gtReopen')}
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="oac-gt-detail">
              {actionNote ? <p className="oac-note error">{actionNote}</p> : null}
              {infoNote ? <p className="oac-note">{infoNote}</p> : null}
              <section className="oac-gt-section">
                <div className="oac-gt-field">
                  <span className="oac-gt-field-label">{t('gtGoal')}</span>
                  <p className="oac-gt-field-value">{detail.goal}</p>
                </div>
                {detail.acceptanceCriteria ? (
                  <div className="oac-gt-field">
                    <span className="oac-gt-field-label">{t('gtAcceptance')}</span>
                    <p className="oac-gt-field-value">{detail.acceptanceCriteria}</p>
                  </div>
                ) : null}
                <div className="oac-gt-local-actions">
                  <button
                    type="button"
                    className="oac-a2a-guidance-toggle"
                    onClick={() => {
                      setRenameDraft(detail.displayName ?? '')
                      setRenameOpen(true)
                    }}
                  >
                    {t('gtRename')}
                  </button>
                  <button
                    type="button"
                    className="oac-a2a-guidance-toggle"
                    disabled={busy}
                    onClick={() => { void runAction(() => gt.pin(detail.chairSlug, detail.id, !detail.pinned)) }}
                  >
                    {detail.pinned ? t('gtUnpin') : t('gtPin')}
                  </button>
                  <button
                    type="button"
                    className="oac-a2a-guidance-toggle"
                    disabled={busy}
                    onClick={() => { void runAction(() => gt.archive(detail.chairSlug, detail.id, detail.archivedAt == null)) }}
                  >
                    {detail.archivedAt == null ? t('gtArchive') : t('gtUnarchive')}
                  </button>
                </div>
              </section>
              <section className="oac-gt-section">
                <span className="oac-gt-field-label">
                  {t('gtMembers')}
                  {!terminal ? (
                    <button
                      type="button"
                      className="oac-a2a-guidance-toggle oac-gt-invite-toggle"
                      disabled={busy}
                      onClick={() => {
                        setInviteError(null)
                        setInviteOpen(true)
                      }}
                    >
                      {t('gtInviteRemote')}
                    </button>
                  ) : null}
                </span>
                <ul className="oac-gt-members">
                  {detail.members.map((member) => {
                    const bot = member.slug ? bots.find((row) => row.slug === member.slug) : undefined
                    const name = member.displayName ?? bot?.name ?? member.slug ?? member.globalMetaId ?? '?'
                    return (
                      <li key={member.id} className="oac-gt-member">
                        <BotAvatar name={name} src={member.avatar ?? bot?.avatarDataUrl} className="oac-gt-member-avatar" />
                        <span className="oac-gt-member-main">
                          <span className="oac-gt-member-name">
                            {name}
                            {member.role === 'chair' ? <span className="oac-gt-badge oac-gt-chair">{t('gtChair')}</span> : null}
                            {member.slug == null ? <span className="oac-gt-badge oac-gt-openteam">{t('gtRemote')}</span> : null}
                          </span>
                          <span className={`oac-gt-member-work oac-gt-work-${member.workStatus}`}>
                            {t(workStatusKey(member.workStatus))}
                          </span>
                        </span>
                        {member.role !== 'chair' && !terminal ? (
                          <button
                            type="button"
                            className="oac-gt-member-kick"
                            disabled={busy}
                            onClick={() => setKickTarget(member)}
                          >
                            {t('gtKick')}
                          </button>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </section>
              {detail.deliverables.length > 0 ? (
                <section className="oac-gt-section">
                  <span className="oac-gt-field-label">{t('gtDeliverables')}</span>
                  <ul className="oac-gt-deliverables">
                    {detail.deliverables.map((row) => (
                      <li key={row.id} className="oac-gt-deliverable">
                        <span className={`oac-gt-badge oac-gt-deliverable-${row.status}`}>{row.status}</span>
                        {row.kind ? <span className="oac-gt-deliverable-kind">{row.kind}</span> : null}
                        {row.uri ? <code className="oac-gt-deliverable-uri">{row.uri}</code> : null}
                        <span className="oac-a2a-row-time" title={timestampLabel(row.createdAt)}>
                          {relativeTimeLabel(row.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {detail.openCheckpointSummary && !terminal ? (
                <section className="oac-gt-checkpoint">
                  <span className="oac-gt-checkpoint-title">
                    <IconWarningOutline16 size={14} />
                    {t('gtCheckpointOpen')}
                  </span>
                  <p className="oac-gt-field-value">{detail.openCheckpointSummary}</p>
                  <span className="oac-gt-checkpoint-hint">{t('gtCheckpointHint')}</span>
                </section>
              ) : null}
              <section className="oac-gt-section oac-gt-transcript">
                <span className="oac-gt-field-label">{t('gtTranscript')}</span>
                {detail.messages.length === 0 ? <p className="oac-note">{t('gtNoMessages')}</p> : null}
                {detail.messages.map((message) => {
                  const isMarkdown = message.contentType === 'text/markdown'
                  const senderName = message.senderSuspect
                    ? t('gtSuspectSender')
                    : (message.senderName ?? message.senderGlobalMetaId ?? '?')
                  return (
                    <div key={message.pinId ?? `idx-${message.index}`} className="oac-a2a-msg oac-a2a-msg-peer oac-gt-msg">
                      {!message.senderSuspect && message.senderGlobalMetaId && onOpenBotPage
                        ? (
                          <BotAvatarButton
                            name={senderName}
                            src={message.senderAvatar ?? undefined}
                            className="oac-a2a-msg-avatar"
                            label={`${t('openBotPage')}: ${senderName}`}
                            onClick={() => onOpenBotPage(message.senderGlobalMetaId ?? '')}
                          />
                        )
                        : (
                          <BotAvatar
                            name={senderName}
                            src={message.senderSuspect ? undefined : (message.senderAvatar ?? undefined)}
                            className="oac-a2a-msg-avatar"
                          />
                        )}
                      <div className="oac-a2a-msg-body">
                        <div className="oac-a2a-msg-head">
                          <span className={message.senderSuspect ? 'oac-a2a-msg-name oac-gt-suspect' : 'oac-a2a-msg-name'}>
                            {senderName}
                          </span>
                          <span className="oac-a2a-msg-meta">
                            {message.txid ? (
                              <span className="oac-a2a-msg-txid">
                                <span className="oac-a2a-msg-txid-text">txid: {txidPreview(message.txid)}</span>
                                <CopyIconButton
                                  value={message.txid}
                                  label={`${t('copyTxid')}: ${message.txid}`}
                                  copiedLabel={t('copied')}
                                />
                              </span>
                            ) : null}
                            <span className="oac-a2a-msg-time" title={timestampLabel(message.timestamp)}>
                              {relativeTimeLabel(message.timestamp)}
                            </span>
                          </span>
                        </div>
                        <div className="oac-a2a-bubble oac-a2a-bubble-peer">
                          {isMarkdown
                            ? <MarkdownText text={message.content} labels={mdLabels} />
                            : <span className="oac-a2a-msg-text">{message.content}</span>}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </section>
            </div>
            {!terminal ? (
              <div className="oac-a2a-composer">
                <div className="oac-a2a-composer-row">
                  <Input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={t('gtMessagePlaceholder')}
                    onKeyDown={(event) => {
                      // Enter sends — but never while an IME composition is
                      // open (Chinese/Japanese candidates commit with Enter).
                      if (event.key === 'Enter' && !event.shiftKey
                        && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        if (!busy) void onSend()
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="primary"
                    icon={<IconSendOutline16 />}
                    disabled={busy || !draft.trim()}
                    onClick={() => { void onSend() }}
                  >
                    {busy ? t('gtWorking') : t('send')}
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
          </>
        )}
      </div>

      <Modal
        closeLabel={t('close')}
        open={createOpen}
        onClose={() => { if (!createBusy) setCreateOpen(false) }}
        title={t('gtCreateTitle')}
        className="oac-dialog"
        footer={(
          <>
            <Button type="button" variant="outline" disabled={createBusy} onClick={() => setCreateOpen(false)}>
              {t('gtCancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              icon={<IconPlusOutline16 />}
              disabled={createBusy || !newTitle.trim() || !newGoal.trim()}
              onClick={() => { void onCreate() }}
            >
              {createBusy ? t('gtWorking') : t('gtCreate')}
            </Button>
          </>
        )}
      >
        <div className="oac-gt-form">
          {createError ? <p className="oac-note error">{createError}</p> : null}
          {createBusy ? <p className="oac-note saving">{t('gtCreating')}</p> : null}
          <label className="oac-gt-form-field">
            <span className="oac-gt-field-label">{t('gtFieldTitle')}</span>
            <Input
              value={newTitle}
              disabled={createBusy}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder={t('gtFieldTitlePlaceholder')}
            />
          </label>
          <label className="oac-gt-form-field">
            <span className="oac-gt-field-label">{t('gtFieldGoal')}</span>
            <textarea
              className="oac-input oac-gt-textarea"
              value={newGoal}
              disabled={createBusy}
              rows={3}
              onChange={(event) => setNewGoal(event.target.value)}
              placeholder={t('gtFieldGoalPlaceholder')}
            />
          </label>
          <label className="oac-gt-form-field">
            <span className="oac-gt-field-label">{t('gtFieldAcceptance')}</span>
            <textarea
              className="oac-input oac-gt-textarea"
              value={newAcceptance}
              disabled={createBusy}
              rows={2}
              onChange={(event) => setNewAcceptance(event.target.value)}
              placeholder={t('gtFieldAcceptancePlaceholder')}
            />
          </label>
          <label className="oac-gt-form-field">
            <span className="oac-gt-field-label">{t('gtFieldChair')}</span>
            <select
              className="oac-input oac-input-select"
              value={newChair}
              disabled={createBusy}
              onChange={(event) => setNewChair(event.target.value)}
            >
              <option value="">
                {twinBot ? `${twinBot.name} ${t('gtTwinDefault')}` : t('gtTwinDefault')}
              </option>
              {bots.map((bot) => (
                <option key={bot.slug} value={bot.slug}>{bot.name}</option>
              ))}
            </select>
          </label>
          <div className="oac-gt-form-field">
            <span className="oac-gt-field-label">{t('gtFieldWorkers')}</span>
            <div className="oac-gt-worker-picks">
              {bots
                .filter((bot) => bot.slug !== (newChair || twinBot?.slug))
                .map((bot) => (
                  <label key={bot.slug} className="oac-gt-worker-pick">
                    <input
                      type="checkbox"
                      disabled={createBusy}
                      checked={newWorkers.includes(bot.slug)}
                      onChange={(event) => {
                        setNewWorkers((value) => event.target.checked
                          ? [...value, bot.slug]
                          : value.filter((slug) => slug !== bot.slug))
                      }}
                    />
                    <BotAvatar name={bot.name} src={bot.avatarDataUrl} className="oac-gt-member-avatar" />
                    <span>{bot.name}</span>
                  </label>
                ))}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        closeLabel={t('close')}
        open={closeOpen}
        onClose={() => { if (!busy) setCloseOpen(false) }}
        title={closeOutcome === 'done' ? t('gtAccept') : t('gtCancelTask')}
        className="oac-dialog-delete"
        footer={(
          <>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setCloseOpen(false)}>
              {t('gtCancel')}
            </Button>
            <Button type="button" variant="primary" disabled={busy} onClick={() => { void onCloseTask() }}>
              {busy ? t('gtWorking') : t('gtConfirm')}
            </Button>
          </>
        )}
      >
        <div className="oac-gt-form">
          {closeOutcome === 'done' ? (
            <div className="oac-gt-form-field">
              <span className="oac-gt-field-label">{t('gtRating')}</span>
              <Stars value={closeRating} onChange={setCloseRating} />
            </div>
          ) : null}
          <label className="oac-gt-form-field">
            <span className="oac-gt-field-label">{t('gtRatingComment')}</span>
            <textarea
              className="oac-input oac-gt-textarea"
              value={closeComment}
              disabled={busy}
              rows={2}
              onChange={(event) => setCloseComment(event.target.value)}
            />
          </label>
        </div>
      </Modal>

      <Modal
        closeLabel={t('close')}
        open={kickTarget !== null}
        onClose={() => { if (!busy) setKickTarget(null) }}
        title={t('gtKick')}
        className="oac-dialog-delete"
        footer={(
          <>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setKickTarget(null)}>
              {t('gtCancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              className="oac-danger-outline"
              disabled={busy}
              onClick={() => { void onKick() }}
            >
              {busy ? t('gtWorking') : t('gtConfirm')}
            </Button>
          </>
        )}
      >
        <p className="oac-dialog-body">
          {t('gtKickConfirm', {
            name: kickTarget?.displayName ?? kickTarget?.slug ?? kickTarget?.globalMetaId ?? '?',
          })}
        </p>
      </Modal>

      <Modal
        closeLabel={t('close')}
        open={inviteOpen}
        onClose={() => { if (!inviteBusy) setInviteOpen(false) }}
        title={t('gtInviteRemote')}
        className="oac-dialog"
        footer={(
          <>
            <Button type="button" variant="outline" disabled={inviteBusy} onClick={() => setInviteOpen(false)}>
              {t('gtCancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={inviteBusy || !inviteGmid.trim()}
              onClick={() => { void onInvite() }}
            >
              {inviteBusy ? t('gtWorking') : t('gtInviteSend')}
            </Button>
          </>
        )}
      >
        <div className="oac-gt-form">
          {inviteError ? <p className="oac-note error">{inviteError}</p> : null}
          <label className="oac-gt-form-field">
            <span className="oac-gt-field-label">{t('gtInviteGmid')}</span>
            <Input
              value={inviteGmid}
              disabled={inviteBusy}
              onChange={(event) => setInviteGmid(event.target.value)}
              placeholder={t('gtInviteGmidPlaceholder')}
            />
          </label>
          <label className="oac-gt-form-field">
            <span className="oac-gt-field-label">{t('gtInviteName')}</span>
            <Input
              value={inviteName}
              disabled={inviteBusy}
              onChange={(event) => setInviteName(event.target.value)}
            />
          </label>
          <label className="oac-gt-form-field">
            <span className="oac-gt-field-label">{t('gtInviteSkills')}</span>
            <Input
              value={inviteSkills}
              disabled={inviteBusy}
              onChange={(event) => setInviteSkills(event.target.value)}
            />
          </label>
        </div>
      </Modal>

      <Modal
        closeLabel={t('close')}
        open={renameOpen}
        onClose={() => { if (!busy) setRenameOpen(false) }}
        title={t('gtRename')}
        className="oac-dialog-delete"
        footer={(
          <>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setRenameOpen(false)}>
              {t('gtCancel')}
            </Button>
            <Button type="button" variant="primary" disabled={busy} onClick={() => { void onRename() }}>
              {busy ? t('gtWorking') : t('gtConfirm')}
            </Button>
          </>
        )}
      >
        <div className="oac-gt-form">
          <Input
            value={renameDraft}
            disabled={busy}
            onChange={(event) => setRenameDraft(event.target.value)}
            placeholder={t('gtRenamePlaceholder')}
          />
        </div>
      </Modal>
    </div>
  )
}
