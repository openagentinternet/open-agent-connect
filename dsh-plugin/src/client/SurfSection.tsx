/**
 * Bot editor Advanced-tab surf section — DSH port of IDBots' SurfSection +
 * SurfReportsPanel (same controls and copy). The section sits ABOVE the
 * chain & wallet block: rows for the surf-before-dream toggle (opt-in per
 * Bot, immediate effect) and the per-surf on-chain interaction budget, a
 * "Surf now" trigger, and the readable surf report list (IDBots-style run
 * cards: chevron + trigger + start time + status badge, one-line non-zero
 * stats, expandable). Reports render as MARKDOWN so the global
 * browser-links pass turns every pin id / `pin://` URI into a clickable
 * Agent Internet link that opens the right-sidebar Bot Browser (the same
 * mechanism DSH chat uses; a <pre> block would be skipped by it).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, Input, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import {
  surfBudgetSet,
  surfDisable,
  surfEnable,
  surfRunStart,
  surfStatus,
  type SurfRun,
} from './api.js'
import { markdownLabels } from './markdown-labels.ts'
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

/** IDBots parity: only the non-zero parts, joined by '·'. */
function formatRunStats(t: Translate, run: SurfRun): string {
  const parts: string[] = []
  const acted = run.stats.liked + run.stats.commented + run.stats.answered + run.stats.posted + run.stats.challenged
  if (run.stats.fetched > 0) parts.push(t('surfRunStatsFetched', { count: run.stats.fetched }))
  if (run.stats.deepRead > 0) parts.push(t('surfRunStatsRead', { count: run.stats.deepRead }))
  if (run.stats.savedToKb > 0) parts.push(t('surfRunStatsSaved', { count: run.stats.savedToKb }))
  if (acted > 0) parts.push(t('surfRunStatsActed', { count: acted }))
  return parts.join(' · ')
}

function triggerLabel(t: Translate, run: SurfRun): string {
  if (run.trigger === 'manual-chat') return t('surfRunTriggerManualChat')
  if (run.trigger === 'pre-dream') return t('surfRunTriggerPreDream')
  return t('surfRunTriggerManualUi')
}

export function SurfSection({ bot, t }: { bot: { slug: string }; t: Translate }): ReactNode {
  const [enabled, setEnabled] = useState(false)
  const [budget, setBudget] = useState(String(DEFAULT_SURF_INTERACTION_BUDGET))
  // Loading gate for the switch: closed after the FIRST status read settles
  // (success OR failure) — a failed read (e.g. host routes not loaded yet)
  // must not wedge the toggle disabled forever; the write path is
  // optimistic and reverts on error.
  const [switchLocked, setSwitchLocked] = useState(true)
  const [running, setRunning] = useState(false)
  const [runs, setRuns] = useState<SurfRun[]>([])
  const [settingsError, setSettingsError] = useState('')
  const [settingsNotice, setSettingsNotice] = useState('')
  const [nowError, setNowError] = useState('')
  const [nowBusy, setNowBusy] = useState(false)
  const [expandedRun, setExpandedRun] = useState<string | null>(null)
  const mdLabels = markdownLabels(t)

  const loadStatus = useCallback(async (withLimit: number): Promise<boolean> => {
    try {
      const status = await surfStatus(bot.slug, withLimit)
      setEnabled(status.surfBeforeDreamEnabled)
      setRunning(status.running)
      setRuns(status.runs)
      setBudget(String(status.interactionBudget))
      return status.running
    } catch {
      return false
    } finally {
      setSwitchLocked(false)
    }
  }, [bot.slug])

  // Seed on mount / bot change; poll so the panel settles live (the daemon
  // owns the run; there is no push channel here).
  useEffect(() => {
    setSwitchLocked(true)
    setSettingsError('')
    setSettingsNotice('')
    setNowError('')
    setExpandedRun(null)
    void loadStatus(20)
    const timer = setInterval(() => { void loadStatus(20) }, RUN_POLL_MS)
    return () => { clearInterval(timer) }
  }, [bot.slug, loadStatus])

  const handleToggle = (): void => {
    if (switchLocked) return
    const next = !enabled
    setEnabled(next)
    setSettingsError('')
    setSettingsNotice('')
    const revert = (message: string): void => {
      setEnabled(!next)
      setSettingsError(message)
    }
    const request = next ? surfEnable(bot.slug) : surfDisable(bot.slug)
    request
      .then(async (result) => {
        if (next && 'qaSurfRetired' in result && result.qaSurfRetired) {
          setSettingsNotice(t('surfQaSurfRetired'))
        }
        await loadStatus(20)
      })
      .catch((error: unknown) => {
        revert(t('surfSettingsError', { message: error instanceof Error ? error.message : String(error) }))
      })
  }

  const handleBudgetCommit = (): void => {
    const clamped = clampBudget(budget)
    if (clamped === null) {
      setBudget(String(DEFAULT_SURF_INTERACTION_BUDGET))
      setSettingsError(t('surfBudgetInvalid'))
      return
    }
    setBudget(String(clamped))
    setSettingsError('')
    setSettingsNotice('')
    surfBudgetSet(bot.slug, clamped).catch((error: unknown) => {
      setSettingsError(t('surfSettingsError', { message: error instanceof Error ? error.message : String(error) }))
    })
  }

  const handleSurfNow = (): void => {
    if (running || nowBusy) return
    setNowBusy(true)
    setNowError('')
    surfRunStart(bot.slug)
      .then(async () => {
        await loadStatus(20)
      })
      .catch((error: unknown) => {
        setNowError(t('surfNowFailed', { message: error instanceof Error ? error.message : String(error) }))
      })
      .finally(() => setNowBusy(false))
  }

  return (
    <div className="oac-surf-section" data-slot="oac-surf-section">
      <div className="oac-surf-title">{t('surfSectionTitle')}</div>
      <p className="oac-hint">{t('surfSectionHint')}</p>
      {settingsError ? <p className="oac-note error">{settingsError}</p> : null}
      {settingsNotice ? <p className="oac-note success">{settingsNotice}</p> : null}

      {/* Surf before dream: immediate-effect toggle (IDBots parity). */}
      <div className="oac-surf-row" data-slot="oac-surf-before-dream-row">
        <div className="oac-surf-row-label">
          <span>{t('surfBeforeDreamToggle')}</span>
          <p className="oac-hint">{t('surfBeforeDreamHint')}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t('surfBeforeDreamToggle')}
          className={`oac-switch${enabled ? ' on' : ''}`}
          disabled={switchLocked}
          onClick={handleToggle}
        >
          <span className="oac-switch-track"><span className="oac-switch-thumb" /></span>
        </button>
      </div>

      {/* Interaction budget per surf. */}
      <div className="oac-surf-row" data-slot="oac-surf-budget-row">
        <div className="oac-surf-row-label">
          <span>{t('surfInteractionBudgetLabel')}</span>
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

      {/* Surf now trigger. */}
      <div className="oac-surf-row" data-slot="oac-surf-now-row">
        <div className="oac-surf-row-label" />
        <div className="oac-surf-now-wrap">
          <Button variant="primary" size="sm" onClick={handleSurfNow} disabled={running || nowBusy}>
            {running || nowBusy ? t('surfNowRunning') : t('surfNowButton')}
          </Button>
          {nowError ? <span className="oac-note error">{nowError}</span> : null}
        </div>
      </div>

      <div className="oac-surf-reports-title">{t('surfReportsTitle')}</div>
      <div className="oac-surf-reports">
        {runs.length === 0 ? (
          <p className="oac-hint">{t('surfReportsEmpty')}</p>
        ) : runs.map((run) => (
          <div key={run.id} className={`oac-surf-run ${run.status}`}>
            <button
              type="button"
              className="oac-surf-run-head"
              aria-expanded={expandedRun === run.id}
              onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
            >
              <span className={`oac-surf-chevron${expandedRun === run.id ? ' open' : ''}`} aria-hidden>▸</span>
              <span className="oac-surf-run-trigger">{triggerLabel(t, run)}</span>
              <span className="oac-surf-run-time">{formatStartedAt(run.startedAt)}</span>
              <span className={`oac-surf-run-badge ${run.status}`}>
                {run.status === 'running' ? <span className="oac-surf-run-dot" aria-hidden /> : null}
                {t(run.status === 'running' ? 'surfStatusRunning' : run.status === 'done' ? 'surfStatusDone' : 'surfStatusFailed')}
              </span>
            </button>
            <p className="oac-surf-run-stats">{formatRunStats(t, run) || '—'}</p>
            {expandedRun === run.id && run.error ? (
              <p className="oac-note error">{run.error}</p>
            ) : null}
            {expandedRun === run.id && run.reportMarkdown ? (
              // Markdown (not <pre>): the global browser-links pass wraps
              // bare pin ids and pin:// URIs into Bot Browser links.
              <div className="oac-surf-report-md">
                <MarkdownText text={run.reportMarkdown} labels={mdLabels} />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
