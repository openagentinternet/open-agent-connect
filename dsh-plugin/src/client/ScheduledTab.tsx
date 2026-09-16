/**
 * Bot editor "Scheduled" tab — this Bot's scheduled tasks (the same store
 * `metabot schedule *` manages): the readable list plus full manual
 * management. One card per task — name with surf-handoff provenance pill
 * (create_scheduled_task inside a MetaWeb surf run writes the marker
 * description), enable state, schedule + channel + next/last fire, last
 * status with consecutive-error warnings, expandable prompt and run history,
 * Run now / Enable / Disable / Edit / Delete actions, and a create/edit form
 * (name, prompt, at | interval | cron schedule, channel). Data flows through
 * the `/oac/api/schedule/*` host routes → the `metabot schedule` CLI verbs,
 * so the per-Bot store stays the single source of truth.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import {
  scheduleCreate,
  scheduleDelete,
  scheduleList,
  scheduleRunNow,
  scheduleRuns,
  scheduleSetEnabled,
  scheduleUpdate,
  type ScheduledRunRow,
  type ScheduledTaskRow,
} from './api.js'
import type { BotsLocaleKey } from './locale.js'

type Translate = (key: BotsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

const LIST_POLL_MS = 20_000

type ScheduleKind = 'at' | 'interval' | 'cron'
type Channel = 'auto' | 'host' | 'daemon'

interface FormState {
  name: string
  prompt: string
  kind: ScheduleKind
  at: string
  intervalValue: string
  intervalUnit: 'minute' | 'hour' | 'day'
  cron: string
  channel: Channel
}

const EMPTY_FORM: FormState = {
  name: '',
  prompt: '',
  kind: 'at',
  at: '',
  intervalValue: '1',
  intervalUnit: 'hour',
  cron: '',
  channel: 'auto',
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

const INTERVAL_UNIT_MS: Record<'minute' | 'hour' | 'day', number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
}

function formToSpec(form: FormState): { at?: string; everyMs?: number; cron?: string } | { error: string } {
  if (form.kind === 'at') {
    const value = form.at.trim()
    if (!value) return { error: 'at datetime is required.' }
    if (/z$/i.test(value)) return { error: 'at must be a LOCAL datetime without a timezone suffix.' }
    if (!Number.isFinite(Date.parse(value))) return { error: 'at is not a parseable datetime.' }
    return { at: value }
  }
  if (form.kind === 'interval') {
    const value = Number(form.intervalValue)
    if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
      return { error: 'interval value must be a positive integer.' }
    }
    const everyMs = value * INTERVAL_UNIT_MS[form.intervalUnit]
    if (everyMs < 60_000) return { error: 'interval must be at least 1 minute.' }
    return { everyMs }
  }
  const cron = form.cron.trim()
  if (!cron) return { error: 'cron expression is required.' }
  if (cron.split(/\s+/).length !== 5) return { error: 'cron must be a 5-field expression.' }
  return { cron }
}

function formFromTask(task: ScheduledTaskRow): FormState {
  if (task.scheduleKind === 'at') {
    return { ...EMPTY_FORM, name: task.name, prompt: task.prompt, channel: task.channel, kind: 'at', at: task.scheduleText.slice(0, 16) }
  }
  if (task.scheduleKind === 'cron') {
    return { ...EMPTY_FORM, name: task.name, prompt: task.prompt, channel: task.channel, kind: 'cron', cron: task.scheduleText }
  }
  // Interval text is display-formatted ("every 2h"); recover minutes best-effort.
  const match = /every (\d+)([mhd])/.exec(task.scheduleText)
  let intervalValue = '1'
  let intervalUnit: 'minute' | 'hour' | 'day' = 'hour'
  if (match) {
    intervalValue = match[1]!
    intervalUnit = match[2] === 'm' ? 'minute' : match[2] === 'd' ? 'day' : 'hour'
  }
  return { ...EMPTY_FORM, name: task.name, prompt: task.prompt, channel: task.channel, kind: 'interval', intervalValue, intervalUnit }
}

export function ScheduledTab({ bot, t }: { bot: { slug: string }; t: Translate }): ReactNode {
  const [tasks, setTasks] = useState<ScheduledTaskRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tick, setTick] = useState(0)
  // Create/edit form: null = closed; { editingId: string | null }.
  const [form, setForm] = useState<{ editingId: string | null; value: FormState; busy: boolean; error: string } | null>(null)
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set())
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [runsByTask, setRunsByTask] = useState<Record<string, ScheduledRunRow[]>>({})
  const reloadRef = useRef(0)

  const loadList = useCallback(async (): Promise<void> => {
    const token = ++reloadRef.current
    try {
      const rows = await scheduleList(bot.slug)
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
  }, [bot.slug])

  // Reload on bot change; poll while the tab is mounted.
  useEffect(() => {
    setLoaded(false)
    setExpandedId(null)
    setConfirmDeleteId(null)
    void loadList()
    const poll = setInterval(() => { void loadList() }, LIST_POLL_MS)
    return () => clearInterval(poll)
  }, [loadList])

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
        await scheduleSetEnabled(bot.slug, task.id, !task.enabled)
        await loadList()
      } catch (cause) {
        setError(errorText(cause))
      }
    })
  }

  const handleRunNow = (task: ScheduledTaskRow): void => {
    void withBusy(task.id, async () => {
      try {
        await scheduleRunNow(bot.slug, task.id)
        setNotice(t('schRunNowStarted'))
        await loadList()
      } catch (cause) {
        setError(errorText(cause))
      }
    })
  }

  const handleDelete = (task: ScheduledTaskRow): void => {
    void withBusy(task.id, async () => {
      try {
        await scheduleDelete(bot.slug, task.id)
        setConfirmDeleteId(null)
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
    scheduleRuns(bot.slug, task.id, 10)
      .then((rows) => { setRunsByTask((prev) => ({ ...prev, [task.id]: rows })) })
      .catch(() => { setRunsByTask((prev) => ({ ...prev, [task.id]: [] })) })
  }

  const openCreate = (): void => {
    setForm({ editingId: null, value: { ...EMPTY_FORM }, busy: false, error: '' })
  }

  const openEdit = (task: ScheduledTaskRow): void => {
    setForm({ editingId: task.id, value: formFromTask(task), busy: false, error: '' })
  }

  const submitForm = (): void => {
    if (!form || form.busy) return
    const value = form.value
    if (!value.name.trim() || !value.prompt.trim()) {
      setForm({ ...form, error: t('schNamePromptRequired') })
      return
    }
    const spec = formToSpec(value)
    if ('error' in spec) {
      setForm({ ...form, error: spec.error })
      return
    }
    setForm({ ...form, busy: true, error: '' })
    const request = form.editingId === null
      ? scheduleCreate({ from: bot.slug, name: value.name.trim(), prompt: value.prompt.trim(), channel: value.channel, ...spec })
      : scheduleUpdate({ from: bot.slug, id: form.editingId, name: value.name.trim(), prompt: value.prompt.trim(), channel: value.channel, ...spec })
    request
      .then(async (result) => {
        if (result.task === null) {
          setForm({ ...form, busy: false, error: t('schTaskNotFound') })
          return
        }
        setForm(null)
        setNotice(form.editingId === null ? t('schCreated') : t('schSaved'))
        await loadList()
      })
      .catch((cause: unknown) => {
        setForm({ ...form, busy: false, error: errorText(cause) })
      })
  }

  const field = (patch: Partial<FormState>): void => {
    setForm((prev) => (prev === null ? prev : { ...prev, value: { ...prev.value, ...patch }, error: '' }))
  }

  return (
    <div className="oac-sch-tab" data-slot="oac-scheduled-tab">
      <p className="oac-hint">{t('schHint')}</p>
      {error ? <p className="oac-note error">{error}</p> : null}
      {notice ? <p className="oac-note success">{notice}</p> : null}

      <div className="oac-sch-toolbar">
        <Button size="sm" variant="primary" onClick={openCreate}>{t('schNew')}</Button>
        <Button size="sm" onClick={() => setTick((value) => value + 1)}>{t('schRefresh')}</Button>
      </div>
      {/* refresh tick drives a reload without remounting the poll */}
      <ScheduleReloadSignal tick={tick} onTick={loadList} />

      {form !== null ? (
        <div className="oac-sch-form" data-slot="oac-scheduled-form">
          <div className="oac-sch-form-title">{form.editingId === null ? t('schNew') : t('schEdit')}</div>
          <label className="oac-sch-field">
            <span>{t('schFieldName')}</span>
            <Input value={form.value.name} onChange={(event) => field({ name: event.target.value })} />
          </label>
          <label className="oac-sch-field">
            <span>{t('schFieldPrompt')}</span>
            <textarea
              className="oac-sch-textarea"
              rows={5}
              value={form.value.prompt}
              onChange={(event) => field({ prompt: event.target.value })}
            />
          </label>
          <div className="oac-sch-field">
            <span>{t('schFieldSchedule')}</span>
            <div className="oac-sch-kind-row" role="tablist">
              {(['at', 'interval', 'cron'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="tab"
                  className="oac-tab"
                  data-active={form.value.kind === kind}
                  onClick={() => field({ kind })}
                >
                  {t(kind === 'at' ? 'schScheduleAt' : kind === 'interval' ? 'schScheduleInterval' : 'schScheduleCron')}
                </button>
              ))}
            </div>
            {form.value.kind === 'at' ? (
              <Input
                type="datetime-local"
                value={form.value.at}
                onChange={(event) => field({ at: event.target.value })}
              />
            ) : form.value.kind === 'interval' ? (
              <div className="oac-sch-interval-row">
                <Input
                  type="number"
                  min={1}
                  step={1}
                  style={{ width: 90 }}
                  value={form.value.intervalValue}
                  onChange={(event) => field({ intervalValue: event.target.value })}
                />
                <select
                  className="oac-sch-select"
                  value={form.value.intervalUnit}
                  onChange={(event) => field({ intervalUnit: event.target.value as 'minute' | 'hour' | 'day' })}
                >
                  <option value="minute">{t('schIntervalMinute')}</option>
                  <option value="hour">{t('schIntervalHour')}</option>
                  <option value="day">{t('schIntervalDay')}</option>
                </select>
              </div>
            ) : (
              <Input
                placeholder="*/30 * * * *"
                value={form.value.cron}
                onChange={(event) => field({ cron: event.target.value })}
              />
            )}
          </div>
          <label className="oac-sch-field">
            <span>{t('schFieldChannel')}</span>
            <select
              className="oac-sch-select"
              value={form.value.channel}
              onChange={(event) => field({ channel: event.target.value as Channel })}
            >
              <option value="auto">{t('schChannelAuto')}</option>
              <option value="host">{t('schChannelHost')}</option>
              <option value="daemon">{t('schChannelDaemon')}</option>
            </select>
          </label>
          {form.error ? <p className="oac-note error">{form.error}</p> : null}
          <div className="oac-sch-form-actions">
            <Button size="sm" variant="primary" disabled={form.busy} onClick={submitForm}>
              {form.busy ? (form.editingId === null ? t('schCreating') : t('schSaving')) : (form.editingId === null ? t('schCreate') : t('schSave'))}
            </Button>
            <Button size="sm" disabled={form.busy} onClick={() => setForm(null)}>{t('schCancel')}</Button>
          </div>
        </div>
      ) : null}

      {!loaded ? (
        <p className="oac-hint">…</p>
      ) : tasks.length === 0 ? (
        <p className="oac-hint">{t('schEmpty')}</p>
      ) : (
        <div className="oac-sch-list">
          {tasks.map((task) => {
            const busy = busyIds.has(task.id)
            const runs = runsByTask[task.id]
            const expired = task.expiresAt !== null && Date.parse(task.expiresAt) < Date.now()
            return (
              <div key={task.id} className={`oac-sch-card ${task.enabled ? '' : 'off'}`}>
                <div className="oac-sch-card-head">
                  <button type="button" className="oac-sch-card-title" onClick={() => handleExpand(task)}>
                    <span className={`oac-sch-dot ${task.lastStatus ?? 'none'}`} aria-hidden />
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
                    <Button size="sm" disabled={busy} onClick={() => openEdit(task)}>{t('schEdit')}</Button>
                    {confirmDeleteId === task.id ? (
                      <Button size="sm" variant="primary" disabled={busy} onClick={() => handleDelete(task)}>
                        {t('schDeleteConfirm')}
                      </Button>
                    ) : (
                      <Button size="sm" disabled={busy} onClick={() => setConfirmDeleteId(task.id)}>{t('schDelete')}</Button>
                    )}
                  </div>
                </div>
                <div className="oac-sch-card-meta">
                  <span className="oac-sch-schedule">{task.scheduleKind === 'at' ? task.scheduleText.replace('T', ' ') : task.scheduleText}</span>
                  <span className="oac-sch-channel">{t(task.channel === 'host' ? 'schChannelHost' : task.channel === 'daemon' ? 'schChannelDaemon' : 'schChannelAuto')}</span>
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
                      {!runs ? (
                        <p className="oac-hint">…</p>
                      ) : runs.length === 0 ? (
                        <p className="oac-hint">{t('schRunsEmpty')}</p>
                      ) : (
                        runs.map((run) => (
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
                        ))
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

/** Imperative reload hook for the refresh button (keeps the poll effect stable). */
function ScheduleReloadSignal({ tick, onTick }: { tick: number; onTick: () => Promise<void> }): null {
  const lastRef = useRef(tick)
  useEffect(() => {
    if (tick !== lastRef.current) {
      lastRef.current = tick
      void onTick()
    }
  }, [tick, onTick])
  return null
}
