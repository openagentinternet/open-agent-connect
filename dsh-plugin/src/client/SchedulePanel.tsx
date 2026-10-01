/**
 * Bots page "Scheduled" section (定时任务) — every local Bot's scheduled
 * tasks in one unified table, styled after the IDBots 跟踪任务 > 定时任务
 * list: a grid table (Title / Bot / Scheduled For / Status / More) with
 * hairline separators, the enable switch and a running spinner in the Status
 * column, and a per-row overflow menu (Run now / Edit / Delete) instead of
 * flat buttons. Clicking a row expands the prompt, run state, and run
 * history in place. This section replaces the Bot editor's per-Bot
 * "Scheduled" tab — management is unified here, no per-Bot filtering.
 *
 * Data flows through the `/oac/api/schedule/*` host routes → the
 * `metabot schedule` CLI verbs (`schedule list --all` for the unified list),
 * so the per-Bot stores stay the single source of truth. Task ids are only
 * unique per Bot store, so every row-level key is `${botSlug}:${taskId}`.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import {
  api,
  scheduleCreate,
  scheduleDelete,
  scheduleListAll,
  scheduleRunNow,
  scheduleRuns,
  scheduleSetEnabled,
  scheduleUpdate,
  type ScheduledRunRow,
  type ScheduledTaskRow,
} from './api.js'
import type { BotRow } from './api.js'
import { sortBotsTwinFirst } from '../bot-order.js'
import { BotAvatar } from './BotAvatar.tsx'
import { IconEllipsisOutline16, IconLoadingOutline16, IconPlusOutline16, IconRefreshOutline16 } from './icons.ts'
import type { BotsLocaleKey } from './locale.js'

type Translate = (key: BotsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

const LIST_POLL_MS = 20_000

type ScheduleKind = 'at' | 'interval' | 'cron'
type Channel = 'auto' | 'host' | 'daemon'

interface FormState {
  botSlug: string
  name: string
  prompt: string
  kind: ScheduleKind
  at: string
  intervalValue: string
  intervalUnit: 'minute' | 'hour' | 'day'
  cron: string
  channel: Channel
}

const EMPTY_FORM: Omit<FormState, 'botSlug'> = {
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

/** Row-level identity: task ids are only unique inside one Bot's store. */
function taskKey(task: ScheduledTaskRow): string {
  return `${task.botSlug}:${task.id}`
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
    return { ...EMPTY_FORM, botSlug: task.botSlug, name: task.name, prompt: task.prompt, channel: task.channel, kind: 'at', at: task.scheduleText.slice(0, 16) }
  }
  if (task.scheduleKind === 'cron') {
    return { ...EMPTY_FORM, botSlug: task.botSlug, name: task.name, prompt: task.prompt, channel: task.channel, kind: 'cron', cron: task.scheduleText }
  }
  // Interval text is display-formatted ("every 2h"); recover minutes best-effort.
  const match = /every (\d+)([mhd])/.exec(task.scheduleText)
  let intervalValue = '1'
  let intervalUnit: 'minute' | 'hour' | 'day' = 'hour'
  if (match) {
    intervalValue = match[1]!
    intervalUnit = match[2] === 'm' ? 'minute' : match[2] === 'd' ? 'day' : 'hour'
  }
  return { ...EMPTY_FORM, botSlug: task.botSlug, name: task.name, prompt: task.prompt, channel: task.channel, kind: 'interval', intervalValue, intervalUnit }
}

export function SchedulePanel({ t }: { t: Translate }): ReactNode {
  const [tasks, setTasks] = useState<ScheduledTaskRow[]>([])
  const [botsBySlug, setBotsBySlug] = useState<ReadonlyMap<string, BotRow>>(new Map())
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tick, setTick] = useState(0)
  // Create/edit form: null = closed; { editing: ScheduledTaskRow | null }.
  const [form, setForm] = useState<{ editing: ScheduledTaskRow | null; value: FormState; busy: boolean; error: string } | null>(null)
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set())
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTaskRow | null>(null)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [menuKey, setMenuKey] = useState<string | null>(null)
  const [runsByKey, setRunsByKey] = useState<Record<string, ScheduledRunRow[]>>({})
  const reloadRef = useRef(0)

  const loadList = useCallback(async (): Promise<void> => {
    const token = ++reloadRef.current
    try {
      const [rows, bots] = await Promise.all([scheduleListAll(), api.list()])
      if (token !== reloadRef.current) return
      rows.sort((left, right) => (left.nextRunAtMs ?? Number.MAX_SAFE_INTEGER)
        - (right.nextRunAtMs ?? Number.MAX_SAFE_INTEGER))
      setTasks(rows)
      setBotsBySlug(new Map(bots.map((bot) => [bot.slug, bot])))
      setError('')
    } catch (cause) {
      if (token !== reloadRef.current) return
      setTasks([])
      setError(errorText(cause))
    } finally {
      if (token === reloadRef.current) setLoaded(true)
    }
  }, [])

  // Poll while the section is mounted; the refresh button bumps tick.
  useEffect(() => {
    void loadList()
    const poll = setInterval(() => { void loadList() }, LIST_POLL_MS)
    return () => clearInterval(poll)
  }, [loadList, tick])

  const withBusy = useCallback(async (key: string, action: () => Promise<void>): Promise<void> => {
    setBusyKeys((prev) => new Set(prev).add(key))
    try {
      await action()
    } finally {
      setBusyKeys((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }, [])

  const handleToggle = (task: ScheduledTaskRow): void => {
    void withBusy(taskKey(task), async () => {
      try {
        await scheduleSetEnabled(task.botSlug, task.id, !task.enabled)
        await loadList()
      } catch (cause) {
        setError(errorText(cause))
      }
    })
  }

  const handleRunNow = (task: ScheduledTaskRow): void => {
    void withBusy(taskKey(task), async () => {
      try {
        await scheduleRunNow(task.botSlug, task.id)
        setNotice(t('schRunNowStarted'))
        await loadList()
      } catch (cause) {
        setError(errorText(cause))
      }
    })
  }

  const handleDelete = (): void => {
    const target = deleteTarget
    if (target === null) return
    void withBusy(taskKey(target), async () => {
      try {
        await scheduleDelete(target.botSlug, target.id)
        setDeleteTarget(null)
        await loadList()
      } catch (cause) {
        setError(errorText(cause))
      }
    })
  }

  const handleExpand = (task: ScheduledTaskRow): void => {
    const key = taskKey(task)
    if (expandedKey === key) {
      setExpandedKey(null)
      return
    }
    setExpandedKey(key)
    if (runsByKey[key]) return
    scheduleRuns(task.botSlug, task.id, 10)
      .then((rows) => { setRunsByKey((prev) => ({ ...prev, [key]: rows })) })
      .catch(() => { setRunsByKey((prev) => ({ ...prev, [key]: [] })) })
  }

  const openCreate = (): void => {
    const first = sortBotsTwinFirst([...botsBySlug.values()])[0]
    setForm({ editing: null, value: { ...EMPTY_FORM, botSlug: first?.slug ?? '' }, busy: false, error: '' })
  }

  const openEdit = (task: ScheduledTaskRow): void => {
    setForm({ editing: task, value: formFromTask(task), busy: false, error: '' })
  }

  const submitForm = (): void => {
    if (!form || form.busy) return
    const value = form.value
    if (!value.botSlug) {
      setForm({ ...form, error: t('schFieldBotRequired') })
      return
    }
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
    const request = form.editing === null
      ? scheduleCreate({ from: value.botSlug, name: value.name.trim(), prompt: value.prompt.trim(), channel: value.channel, ...spec })
      : scheduleUpdate({ from: value.botSlug, id: form.editing.id, name: value.name.trim(), prompt: value.prompt.trim(), channel: value.channel, ...spec })
    request
      .then(async (result) => {
        if (result.task === null) {
          setForm({ ...form, busy: false, error: t('schTaskNotFound') })
          return
        }
        setForm(null)
        setNotice(form.editing === null ? t('schCreated') : t('schSaved'))
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
    <div className="oac-panel">
      <div className="oac-row">
        <h2>{t('tabScheduled')}</h2>
        <div className="oac-actions">
          <Button type="button" icon={<IconRefreshOutline16 />} onClick={() => setTick((value) => value + 1)}>{t('schRefresh')}</Button>
          <Button type="button" variant="primary" icon={<IconPlusOutline16 />} onClick={openCreate}>{t('schNew')}</Button>
        </div>
      </div>
      <p className="oac-bot-intro">{t('schHintAll')}</p>
      {error ? <div className="oac-error" role="alert">{error}</div> : null}
      {notice ? <p className="oac-note success">{notice}</p> : null}

      {form !== null ? (
        <div className="oac-sch-form" data-slot="oac-scheduled-form">
          <div className="oac-sch-form-title">{form.editing === null ? t('schNew') : t('schEdit')}</div>
          {form.editing === null ? (
            <label className="oac-sch-field">
              <span>{t('schFieldBot')}</span>
              <select
                className="oac-sch-select"
                value={form.value.botSlug}
                onChange={(event) => field({ botSlug: event.target.value })}
              >
                {sortBotsTwinFirst([...botsBySlug.values()]).map((bot) => (
                  <option key={bot.slug} value={bot.slug}>{bot.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <div className="oac-sch-field">
              <span>{t('schFieldBot')}</span>
              <span className="oac-muted">{botsBySlug.get(form.value.botSlug)?.name ?? form.value.botSlug}</span>
            </div>
          )}
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
              {form.busy ? (form.editing === null ? t('schCreating') : t('schSaving')) : (form.editing === null ? t('schCreate') : t('schSave'))}
            </Button>
            <Button size="sm" disabled={form.busy} onClick={() => setForm(null)}>{t('schCancel')}</Button>
          </div>
        </div>
      ) : null}

      {!loaded ? (
        <div className="oac-muted">{t('loading')}</div>
      ) : tasks.length === 0 ? (
        <div className="oac-sch-empty">
          <p className="oac-sch-empty-title">{t('schEmptyAll')}</p>
          <p className="oac-sch-empty-hint">{t('schEmptyAllHint')}</p>
        </div>
      ) : (
        <div className="oac-sch-table">
          <div className="oac-sch-th">
            <span>{t('schColTitle')}</span>
            <span>{t('schColBot')}</span>
            <span>{t('schColSchedule')}</span>
            <span>{t('schColStatus')}</span>
            <span className="oac-sch-th-more">{t('schColMore')}</span>
          </div>
          {tasks.map((task) => {
            const key = taskKey(task)
            const busy = busyKeys.has(key)
            const runs = runsByKey[key]
            const expired = task.expiresAt !== null && Date.parse(task.expiresAt) < Date.now()
            const bot = botsBySlug.get(task.botSlug)
            const running = task.runningAtMs !== null
            return (
              <div key={key} className="oac-sch-item">
                <div
                  className="oac-sch-tr"
                  role="button"
                  tabIndex={0}
                  aria-expanded={expandedKey === key}
                  onClick={() => handleExpand(task)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    handleExpand(task)
                  }}
                >
                  <span className="oac-sch-cell-name">
                    <span className={task.enabled ? 'oac-sch-name' : 'oac-sch-name off'}>{task.name || task.id}</span>
                    {task.fromSurf ? <span className="oac-sch-pill surf">{t('schSourceSurf')}</span> : null}
                    {expired ? <span className="oac-sch-pill warn">{t('schExpired')}</span> : null}
                  </span>
                  <span className="oac-sch-cell-bot">
                    {bot === undefined ? null : <BotAvatar name={bot.name} src={bot.avatarDataUrl} className="oac-sch-bot-avatar" />}
                    <span className="oac-sch-bot-name">{bot?.name ?? task.botSlug}</span>
                  </span>
                  <span className="oac-sch-cell-schedule">
                    {task.scheduleKind === 'at' ? task.scheduleText.replace('T', ' ') : task.scheduleText}
                  </span>
                  <span className="oac-sch-cell-status">
                    {running ? <IconLoadingOutline16 className="oac-spin oac-sch-running" /> : null}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={task.enabled}
                      aria-label={`${task.enabled ? t('schDisable') : t('schEnable')}: ${task.name}`}
                      className={task.enabled ? 'oac-switch on' : 'oac-switch'}
                      disabled={busy}
                      onClick={(event) => { event.stopPropagation(); handleToggle(task) }}
                    >
                      <span className="oac-switch-track"><span className="oac-switch-thumb" /></span>
                    </button>
                  </span>
                  <span className="oac-sch-cell-more">
                    <Menu
                      open={menuKey === key}
                      onClose={() => setMenuKey(null)}
                      items={[
                        { id: 'run', label: t('schRunNow'), disabled: running || busy },
                        { id: 'edit', label: t('schEdit') },
                        { type: 'separator', id: 'sep' },
                        { id: 'delete', label: t('schDelete'), danger: true },
                      ]}
                      onSelect={(id) => {
                        setMenuKey(null)
                        if (id === 'run') handleRunNow(task)
                        else if (id === 'edit') openEdit(task)
                        else if (id === 'delete') setDeleteTarget(task)
                      }}
                      align="end"
                      portal
                      anchor={(
                        <button
                          type="button"
                          className="oac-icon-btn"
                          aria-label={t('schColMore')}
                          aria-haspopup="menu"
                          aria-expanded={menuKey === key}
                          onClick={(event) => { event.stopPropagation(); setMenuKey((prev) => (prev === key ? null : key)) }}
                        >
                          <IconEllipsisOutline16 />
                        </button>
                      )}
                    />
                  </span>
                </div>
                {expandedKey === key ? (
                  <div className="oac-sch-row-detail">
                    <div className="oac-sch-detail">
                      <div className="oac-sch-card-meta">
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
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      <Modal
        closeLabel={t('schCancel')}
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t('schDeleteTitle')}
        className="oac-dialog"
        footer={(
          <>
            <Button size="sm" onClick={() => setDeleteTarget(null)}>{t('schCancel')}</Button>
            <Button size="sm" variant="primary" disabled={deleteTarget !== null && busyKeys.has(taskKey(deleteTarget))} onClick={handleDelete}>
              {t('schDeleteConfirm')}
            </Button>
          </>
        )}
      >
        {deleteTarget === null ? null : <p>{t('schDeleteText', { name: deleteTarget.name || deleteTarget.id })}</p>}
      </Modal>
    </div>
  )
}
