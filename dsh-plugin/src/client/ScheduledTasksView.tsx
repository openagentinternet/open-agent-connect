/**
 * A2A panel "Scheduled" tab — the scheduled-task list surface (IDBots-style
 * card list, same chrome as the Group Tasks tab). One card per task: name,
 * surf-handoff provenance pill, enable switch, schedule + channel + next/last
 * fire, last status with consecutive-error warnings, Run now / Enable /
 * Disable actions, and an expandable prompt + run history section. The list
 * covers every local Bot (a chip row filters); tasks created by
 * `create_scheduled_task` inside surf runs are marked as surf handoffs.
 * Data flows through the `/oac/api/schedule/*` host routes → the
 * `metabot schedule` CLI verbs (the per-Bot store is the source of truth).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ScheduledRunRow,
  ScheduledTaskRow,
} from './api.js'
import type { BotRow } from './api.js'
import { BotAvatar } from './BotAvatar.tsx'
import type { ConversationsLocaleKey } from './locale-conversations.ts'

type Translate = (key: ConversationsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

const LIST_POLL_MS = 20_000

export interface ScheduledTaskInjectedApi {
  list: (from: string) => Promise<ScheduledTaskRow[]>
  runs: (from: string, id: string, limit?: number) => Promise<ScheduledRunRow[]>
  setEnabled: (from: string, id: string, enabled: boolean) => Promise<ScheduledTaskRow | null>
  runNow: (from: string, id: string) => Promise<void>
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function formatTime(ms: number | null, t: Translate): string {
  if (ms === null) return t('schNever')
  const date = new Date(ms)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : t('schNever')
}

function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return ''
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${Math.round(ms / 3_600_000)}h`
}

function scheduleKindLabel(task: ScheduledTaskRow): string {
  if (task.scheduleKind === 'cron') return task.scheduleText
  if (task.scheduleKind === 'at') return task.scheduleText.replace('T', ' ')
  return task.scheduleText
}

export function ScheduledTasksView({
  bots,
  defaultSlug,
  schedule,
  t,
}: {
  bots: BotRow[]
  defaultSlug: string
  schedule: ScheduledTaskInjectedApi
  t: Translate
}): ReactNode {
  // '' = every local Bot; otherwise one Bot's tasks.
  const [filter, setFilter] = useState('')
  const [tasks, setTasks] = useState<ScheduledTaskRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set())
  const [notice, setNotice] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [runsByTask, setRunsByTask] = useState<Record<string, ScheduledRunRow[]>>({})
  const [runsBusy, setRunsBusy] = useState(false)
  const reloadRef = useRef(0)

  const loadList = useCallback(async (): Promise<void> => {
    const token = ++reloadRef.current
    try {
      const slugs = filter ? [filter] : bots.map((bot) => bot.slug)
      const rows = (await Promise.all(slugs.map((slug) => schedule.list(slug)))).flat()
      if (token !== reloadRef.current) return
      rows.sort((left, right) => (right.nextRunAtMs ?? Number.MAX_SAFE_INTEGER)
        - (left.nextRunAtMs ?? Number.MAX_SAFE_INTEGER))
      setTasks(rows)
      setError('')
    } catch (cause) {
      if (token !== reloadRef.current) return
      setTasks([])
      setError(errorText(cause))
    } finally {
      if (token === reloadRef.current) setLoaded(true)
    }
  }, [filter, bots, schedule])

  // Initial load + bot-list driven filter default; poll while mounted.
  useEffect(() => {
    void loadList()
    const poll = setInterval(() => { void loadList() }, LIST_POLL_MS)
    return () => clearInterval(poll)
  }, [loadList, tick])

  const withBusy = useCallback(async (id: string, action: () => Promise<void>): Promise<void> => {
    setBusyIds((prev) => new Set(prev).add(id))
    try {
      await action()
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [])

  const handleToggle = (task: ScheduledTaskRow): void => {
    void withBusy(task.id, async () => {
      try {
        await schedule.setEnabled(task.botSlug, task.id, !task.enabled)
        await loadList()
      } catch (cause) {
        setError(errorText(cause))
      }
    })
  }

  const handleRunNow = (task: ScheduledTaskRow): void => {
    void withBusy(task.id, async () => {
      try {
        await schedule.runNow(task.botSlug, task.id)
        setNotice(t('schRunNowStarted'))
        await loadList()
      } catch (cause) {
        setError(errorText(cause))
      }
    })
  }

  const handleExpand = (task: ScheduledTaskRow): void => {
    if (expandedId === task.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(task.id)
    if (runsByTask[task.id]) return
    setRunsBusy(true)
    schedule.runs(task.botSlug, task.id, 10)
      .then((rows) => { setRunsByTask((prev) => ({ ...prev, [task.id]: rows })) })
      .catch(() => { setRunsByTask((prev) => ({ ...prev, [task.id]: [] })) })
      .finally(() => { setRunsBusy(false) })
  }

  const botBySlug = new Map(bots.map((bot) => [bot.slug, bot]))
  const visible = filter ? tasks.filter((task) => task.botSlug === filter) : tasks

  return (
    <div className="oac-sch-view" aria-label={t('schTitle')}>
      <div className="oac-sch-toolbar">
        <div className="oac-sch-filters" role="tablist" aria-label={t('schAll')}>
          <button
            type="button"
            role="tab"
            className="oac-tab"
            data-active={filter === ''}
            onClick={() => setFilter('')}
          >
            {t('schAll')}
          </button>
          {bots.map((bot) => (
            <button
              key={bot.slug}
              type="button"
              role="tab"
              className="oac-tab"
              data-active={filter === bot.slug}
              onClick={() => setFilter(bot.slug)}
            >
              {bot.name || bot.slug}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setTick((value) => value + 1)}>{t('schRefresh')}</Button>
      </div>
      <p className="oac-hint oac-sch-hint">{t('schHint')}</p>
      {error ? <p className="oac-note error">{error}</p> : null}
      {notice ? <p className="oac-note success">{notice}</p> : null}

      {!loaded ? (
        <p className="oac-hint">…</p>
      ) : visible.length === 0 ? (
        <p className="oac-hint">{t('schEmpty')}</p>
      ) : (
        <div className="oac-sch-list">
          {visible.map((task) => {
            const bot = botBySlug.get(task.botSlug)
            const busy = busyIds.has(task.id)
            const runs = runsByTask[task.id]
            const expired = task.expiresAt !== null && Date.parse(task.expiresAt) < Date.now()
            return (
              <div key={`${task.botSlug}:${task.id}`} className={`oac-sch-card ${task.enabled ? '' : 'off'}`}>
                <div className="oac-sch-card-head">
                  <button type="button" className="oac-sch-card-title" onClick={() => handleExpand(task)}>
                    <BotAvatar name={bot?.name ?? task.botSlug} src={bot?.avatarDataUrl} className="oac-a2a-bot-avatar" />
                    <span className="oac-sch-name">{task.name || task.id}</span>
                    {task.fromSurf ? <span className="oac-sch-pill surf">{t('schSourceSurf')}</span> : null}
                    {expired ? <span className="oac-sch-pill warn">{t('schExpired')}</span> : null}
                    {!task.enabled ? <span className="oac-sch-pill">{t('schDisabled')}</span> : null}
                  </button>
                  <div className="oac-sch-actions">
                    <Button size="sm" disabled={busy} onClick={() => handleRunNow(task)}>{t('schRunNow')}</Button>
                    <Button size="sm" disabled={busy} onClick={() => handleToggle(task)}>
                      {task.enabled ? t('schDisable') : t('schEnable')}
                    </Button>
                  </div>
                </div>
                <div className="oac-sch-card-meta">
                  <span className="oac-sch-schedule">{scheduleKindLabel(task)}</span>
                  <span className="oac-sch-channel">{t(task.channel === 'host' ? 'schChannelHost' : task.channel === 'daemon' ? 'schChannelDaemon' : 'schChannelAuto')}</span>
                  <span className={`oac-sch-dot ${task.lastStatus ?? 'none'}`} aria-hidden />
                  <span className="oac-sch-times">
                    {t('schNextRun', { time: formatTime(task.nextRunAtMs, t) })}
                    {' · '}
                    {t('schLastRun', { time: formatTime(task.lastRunAtMs, t) })}
                  </span>
                  {task.consecutiveErrors > 0 ? (
                    <span className="oac-sch-pill warn">{t('schConsecutiveErrors', { count: task.consecutiveErrors })}</span>
                  ) : null}
                </div>
                {task.lastError ? <p className="oac-note error">{task.lastError}</p> : null}
                {expandedId === task.id ? (
                  <div className="oac-sch-detail">
                    <details>
                      <summary>{t('schPrompt')}</summary>
                      <pre className="oac-sch-prompt">{task.prompt}</pre>
                    </details>
                    <div className="oac-sch-runs">
                      <div className="oac-sch-runs-title">{t('schRuns')}</div>
                      {runsBusy && !runs ? (
                        <p className="oac-hint">…</p>
                      ) : !runs || runs.length === 0 ? (
                        <p className="oac-hint">{t('schRunsEmpty')}</p>
                      ) : (
                        <>
                          {runs.map((run) => (
                            <div key={run.id} className="oac-sch-run">
                              <span className={`oac-sch-dot ${run.status}`} aria-hidden />
                              <span className="oac-sch-run-meta">
                                {new Date(run.startedAt).toLocaleString()}
                                {' · '}
                                {t(run.trigger === 'manual' ? 'schRunTriggerManual' : 'schRunTriggerScheduled')}
                                {run.executor ? ` · ${run.executor}` : ''}
                                {run.durationMs !== null ? ` · ${formatDuration(run.durationMs)}` : ''}
                              </span>
                              {run.error ? <span className="oac-note error">{run.error}</span> : null}
                            </div>
                          ))}
                          <p className="oac-hint">{t('schRunsCount', { count: runs.length })}</p>
                        </>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
