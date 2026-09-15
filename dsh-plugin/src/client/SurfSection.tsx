/**
 * Bot editor Advanced-tab surf section — DSH port of IDBots' SurfSection +
 * SurfReportsPanel (same controls, same copy adapted to the host routes):
 * the surf-before-dream toggle (opt-in per Bot, immediate effect), the
 * per-run on-chain interaction budget, a "Surf now" trigger, and the
 * readable surf reports list. The host routes back the `metabot surf` CLI
 * verbs; the running state is seeded from the run store and polled while a
 * run is in flight.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import {
  surfBudgetSet,
  surfDisable,
  surfEnable,
  surfRunStart,
  surfStatus,
  type SurfRun,
} from './api.js'
import type { BotsLocaleKey } from './locale.js'

type Translate = (key: BotsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

const DEFAULT_SURF_INTERACTION_BUDGET = 20
const MAX_SURF_INTERACTION_BUDGET = 100
const RUN_POLL_MS = 15_000

const clampBudget = (raw: string): number | null => {
  const num = Number(raw)
  if (!Number.isFinite(num)) return null
  return Math.min(MAX_SURF_INTERACTION_BUDGET, Math.max(0, Math.round(num)))
}

function formatStartedAt(startedAt: string): string {
  const ms = Date.parse(startedAt)
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : startedAt
}

function firstReportLine(reportMarkdown: string | null): string | null {
  if (!reportMarkdown) return null
  const line = reportMarkdown.split('\n').find((entry) => entry.trim() && !entry.startsWith('#'))
  return line ? line.trim().slice(0, 160) : null
}

export function SurfSection({ bot, t }: { bot: { slug: string }; t: Translate }): ReactNode {
  const [enabled, setEnabled] = useState(false)
  const [budget, setBudget] = useState(String(DEFAULT_SURF_INTERACTION_BUDGET))
  const [loaded, setLoaded] = useState(false)
  const [running, setRunning] = useState(false)
  const [runs, setRuns] = useState<SurfRun[]>([])
  const [settingsError, setSettingsError] = useState('')
  const [nowError, setNowError] = useState('')
  const [nowBusy, setNowBusy] = useState(false)
  const [expandedRun, setExpandedRun] = useState<string | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadStatus = useCallback(async (limit: number) => {
    try {
      const status = await surfStatus(bot.slug, limit)
      setEnabled(status.surfBeforeDreamEnabled)
      setRunning(status.running)
      setRuns(status.runs)
      if (!loaded) setBudget(String(status.interactionBudget))
      setLoaded(true)
      return status.running
    } catch {
      setLoaded(true)
      return false
    }
  }, [bot.slug, loaded])

  // Seed on mount / bot change; poll while a run is in flight so the panel
  // settles live (the daemon owns the run; there is no push channel here).
  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setSettingsError('')
    setNowError('')
    setExpandedRun(null)
    void loadStatus(20)
    const timer = setInterval(() => {
      if (cancelled) return
      void loadStatus(20)
    }, RUN_POLL_MS)
    pollTimerRef.current = timer
    return () => {
      cancelled = true
      clearInterval(timer)
      pollTimerRef.current = null
    }
  }, [bot.slug, loadStatus])

  const handleToggle = () => {
    if (!loaded) return
    const next = !enabled
    setEnabled(next)
    setSettingsError('')
    const revert = (message: string) => {
      setEnabled(!next)
      setSettingsError(message)
    }
    const request = next ? surfEnable(bot.slug) : surfDisable(bot.slug)
    request
      .then((result) => {
        if (next && 'qaSurfRetired' in result && result.qaSurfRetired) {
          setSettingsError(t('surfQaSurfRetired'))
        }
      })
      .catch((error: unknown) => {
        revert(t('surfSettingsError', { message: error instanceof Error ? error.message : String(error) }))
      })
  }

  const handleBudgetCommit = () => {
    const clamped = clampBudget(budget)
    if (clamped === null) {
      setBudget(String(DEFAULT_SURF_INTERACTION_BUDGET))
      setSettingsError(t('surfBudgetInvalid'))
      return
    }
    setBudget(String(clamped))
    surfBudgetSet(bot.slug, clamped).catch((error: unknown) => {
      setSettingsError(t('surfSettingsError', { message: error instanceof Error ? error.message : String(error) }))
    })
  }

  const handleSurfNow = () => {
    if (running || nowBusy) return
    setNowBusy(true)
    setNowError('')
    surfRunStart(bot.slug)
      .then(() => {
        setRunning(true)
        void loadStatus(20)
      })
      .catch((error: unknown) => {
        setNowError(t('surfNowFailed', { message: error instanceof Error ? error.message : String(error) }))
      })
      .finally(() => setNowBusy(false))
  }

  const acted = (run: SurfRun): number =>
    run.stats.liked + run.stats.commented + run.stats.answered + run.stats.posted + run.stats.challenged

  const triggerLabel = (run: SurfRun): string => {
    if (run.trigger === 'manual-chat') return t('surfRunTriggerManualChat')
    if (run.trigger === 'pre-dream') return t('surfRunTriggerPreDream')
    return t('surfRunTriggerManualUi')
  }

  return (
    <div className="oac-form-section" data-slot="oac-surf-section">
      <div className="oac-subsection-title">{t('surfSectionTitle')}</div>
      <p className="oac-hint">{t('surfSectionHint')}</p>
      {settingsError ? <p className="oac-note error">{settingsError}</p> : null}

      <div className="oac-info-row" data-slot="oac-surf-before-dream-row">
        <div className="oac-info-label-wrap">
          <span className="oac-info-label">{t('surfBeforeDreamToggle')}</span>
          <p className="oac-hint">{t('surfBeforeDreamHint')}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          className={`oac-switch${enabled ? ' on' : ''}`}
          disabled={!loaded}
          onClick={handleToggle}
        >
          <span className="oac-switch-track"><span className="oac-switch-thumb" /></span>
        </button>
      </div>

      <div className="oac-info-row" data-slot="oac-surf-budget-row">
        <div className="oac-info-label-wrap">
          <span className="oac-info-label">{t('surfInteractionBudgetLabel')}</span>
          <p className="oac-hint">{t('surfInteractionBudgetHint')}</p>
        </div>
        <Input
          type="number"
          min={0}
          max={MAX_SURF_INTERACTION_BUDGET}
          step={1}
          value={budget}
          style={{ width: 96 }}
          onChange={(event) => setBudget(event.target.value)}
          onBlur={handleBudgetCommit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          }}
        />
      </div>

      <div className="oac-info-row" data-slot="oac-surf-now-row">
        <div className="oac-info-label-wrap" />
        <div className="oac-surf-now-wrap">
          <Button size="sm" onClick={handleSurfNow} disabled={running || nowBusy}>
            {running || nowBusy ? t('surfNowRunning') : t('surfNowButton')}
          </Button>
          {nowError ? <span className="oac-note error">{nowError}</span> : null}
        </div>
      </div>

      <div className="oac-subsection-title" style={{ marginTop: 12 }}>{t('surfReportsTitle')}</div>
      <div className="oac-surf-reports">
        {runs.length === 0 ? (
          <p className="oac-hint">{t('surfReportsEmpty')}</p>
        ) : runs.map((run) => (
          <div key={run.id} className={`oac-surf-run ${run.status}`}>
            <button
              type="button"
              className="oac-surf-run-head"
              onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
            >
              <span className={`oac-surf-run-dot ${run.status}`} aria-hidden />
              <span className="oac-surf-run-meta">
                {formatStartedAt(run.startedAt)} · {triggerLabel(run)}
              </span>
              <span className="oac-surf-run-stats">
                {t('surfStatsLine', {
                  fetched: run.stats.fetched,
                  deepRead: run.stats.deepRead,
                  saved: run.stats.savedToKb,
                  acted: acted(run),
                })}
                {run.stats.tasksScheduled > 0
                  ? ` ${t('surfTasksScheduled', { count: run.stats.tasksScheduled })}`
                  : ''}
              </span>
            </button>
            {run.error ? <p className="oac-note error">{run.error}</p> : null}
            {expandedRun === run.id && run.reportMarkdown ? (
              <pre className="oac-surf-report">{run.reportMarkdown}</pre>
            ) : null}
            {expandedRun === run.id && !run.reportMarkdown && !run.error ? (
              <p className="oac-hint">{firstReportLine(run.reportMarkdown) ?? '—'}</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
