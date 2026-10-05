/**
 * MetaTask board (F1–F3): the task square — lifecycle-badged cards with
 * progress, my-role/my-stats, alerts, the activation notice (boundary <
 * hAct3) and the 广场/我的参与 view toggle. Never acts: the participate
 * control hands the user a prefilled draft, not a write.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  percentOf,
  shortMetaId,
  shortPin,
  taskLifecycleOf,
} from '../../metatask-logic.js'

export interface BoardTask {
  rootPinId: string
  title: string
  brief: string
  publisher: string
  mode: 'tree' | 'competitive'
  taskComplete: boolean
  progress: { total: number; verified: number; claimed: number; open: number; disputed: number; satisfied?: number }
  participantCount: number
  lastActivityMs: number
  freshness: { boundaryBlock: number; evaluatedAtMs: number; eventCount: number }
  myRoles: string[]
  myStats: { claimed: number; submitted: number; verified: number; reviewVotes: number; shareBP: number; estShareBP: number } | null
  settlementFinalized: boolean
}

export interface BoardAlert {
  kind: string
  rootPinId: string
  node: string | null
  detail: string | null
  createdAtMs: number
}

export interface BoardData {
  tasks: BoardTask[]
  alerts: BoardAlert[]
  identities: Record<string, { name: string | null; avatar: string | null }>
  activation: { hAct2: number | null; hAct3: number | null }
  refresh: { lastRefreshAtMs: number | null; lastError: string | null; boundaryBlock: number | null; refreshing: boolean }
}

export type TrackingTranslate = (key: string, vars?: Record<string, string | number>) => string

export interface MetataskBoardLocale {
  mt: TrackingTranslate
}

export interface MetataskApi {
  metataskBoard: (refresh?: boolean) => Promise<unknown>
}

const lifecycleKeyOf = (task: BoardTask): string => {
  const lifecycle = taskLifecycleOf(task)
  return `mtLifecycle${lifecycle.charAt(0).toUpperCase()}${lifecycle.slice(1)}`
}

const nameOf = (board: BoardData, metaId: string): string =>
  board.identities[metaId]?.name || shortMetaId(metaId)

const relativeTime = (ms: number, mt: TrackingTranslate): string => {
  if (!ms) return '—'
  const delta = Date.now() - ms
  const minutes = Math.round(delta / 60_000)
  if (minutes < 1) return mt('mtJustNow')
  if (minutes < 60) return mt('mtMinutesAgo', { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return mt('mtHoursAgo', { count: hours })
  return mt('mtDaysAgo', { count: Math.round(hours / 24) })
}

export function MetataskBoard(
  props: MetataskBoardLocale & MetataskApi & { onOpen: (rootPinId: string) => void },
): ReactNode {
  const { mt, metataskBoard, onOpen } = props
  const [board, setBoard] = useState<BoardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mineOnly, setMineOnly] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (refresh: boolean) => {
    setBusy(true)
    try {
      const data = await metataskBoard(refresh) as BoardData
      setBoard(data)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [metataskBoard])

  useEffect(() => { void load(false) }, [load])
  useEffect(() => {
    const timer = window.setInterval(() => { void load(false) }, 60_000)
    return () => { window.clearInterval(timer) }
  }, [load])

  const tasks = (board?.tasks ?? []).filter((task) => !mineOnly || task.myRoles.length > 0)
  const hAct3 = board?.activation.hAct3 ?? null
  const boundary = board?.refresh.boundaryBlock ?? null
  const activationPending = hAct3 !== null && boundary !== null && boundary < hAct3

  return (
    <div className="oac-mt-board">
      <div className="oac-mt-board-bar">
        <div className="oac-tablist" role="tablist" aria-label={mt('mtBoardViews')}>
          <button type="button" role="tab" className="oac-tab" data-active={!mineOnly ? 'true' : undefined}
            aria-selected={!mineOnly} onClick={() => { setMineOnly(false) }}>{mt('mtViewSquare')}</button>
          <button type="button" role="tab" className="oac-tab" data-active={mineOnly ? 'true' : undefined}
            aria-selected={mineOnly} onClick={() => { setMineOnly(true) }}>{mt('mtViewMine')}</button>
        </div>
        <div className="oac-mt-board-meta">
          {boundary !== null && <span className="oac-mt-chip">{mt('mtBoundary', { block: boundary })}</span>}
          <button type="button" className="oac-btn oac-btn-sm" disabled={busy} onClick={() => { void load(true) }}>
            {busy ? mt('mtRefreshing') : mt('mtRefresh')}
          </button>
        </div>
      </div>

      {activationPending && (
        <div className="oac-mt-notice">{mt('mtActivationNotice', { hAct3: hAct3 as number, boundary: boundary as number })}</div>
      )}
      {board?.refresh.lastError && <div className="oac-mt-notice oac-mt-notice-warn">{mt('mtRefreshError', { message: board.refresh.lastError })}</div>}

      {error && <div className="oac-mt-empty">{mt('mtLoadError', { message: error })}</div>}
      {!error && board && tasks.length === 0 && (
        <div className="oac-mt-empty">{mineOnly ? mt('mtEmptyMine') : mt('mtEmptySquare')}</div>
      )}

      {(board?.alerts ?? []).length > 0 && (
        <div className="oac-mt-alerts">
          {(board?.alerts ?? []).slice(0, 4).map((alert, index) => (
            <div key={`${alert.rootPinId}-${alert.kind}-${index}`} className="oac-mt-alert">
              <span className="oac-mt-alert-kind">{mt(`mtAlert_${alert.kind.replace(/_/g, '_')}`)}</span>
              <span className="oac-mt-alert-node">{alert.node ? `${shortPin(alert.rootPinId)} · ${alert.node}` : shortPin(alert.rootPinId)}</span>
              <button type="button" className="oac-btn oac-btn-sm" onClick={() => { onOpen(alert.rootPinId) }}>
                {mt('mtAlertOpen')}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="oac-mt-cards">
        {tasks.map((task) => {
          const satisfied = task.progress.satisfied ?? task.progress.verified
          return (
            <div key={task.rootPinId} className="oac-mt-card" role="button" tabIndex={0}
              onClick={() => { onOpen(task.rootPinId) }}
              onKeyDown={(event) => { if (event.key === 'Enter') onOpen(task.rootPinId) }}>
              <div className="oac-mt-card-head">
                <span className={`oac-mt-badge oac-mt-badge-${taskLifecycleOf(task)}`}>{mt(lifecycleKeyOf(task))}</span>
                <span className={`oac-mt-mode oac-mt-mode-${task.mode}`}>{task.mode === 'competitive' ? mt('mtModeCompetitive') : mt('mtModeTree')}</span>
                {task.myRoles.length > 0 && (
                  <span className="oac-mt-chip oac-mt-chip-role">{task.myRoles.includes('publisher') ? mt('mtRolePublisher') : mt('mtRoleParticipant')}</span>
                )}
              </div>
              <div className="oac-mt-card-title">{task.title}</div>
              <div className="oac-mt-card-brief">{task.brief}</div>
              <div className="oac-mt-progress">
                <div className="oac-mt-progress-bar">
                  <div className="oac-mt-progress-fill" style={{ width: `${percentOf(satisfied, task.progress.total)}%` }} />
                </div>
                <span className="oac-mt-progress-text">{satisfied}/{task.progress.total}{task.progress.disputed > 0 ? ` · ${mt('mtDisputedCount', { count: task.progress.disputed })}` : ''}</span>
              </div>
              <div className="oac-mt-card-foot">
                <span>{mt('mtPublisher')}: {nameOf(board as BoardData, task.publisher)}</span>
                <span>{mt('mtParticipants', { count: task.participantCount })}</span>
                {task.myStats && (
                  <span>{mt('mtMyStats', { verified: task.myStats.verified, reviews: task.myStats.reviewVotes, share: task.settlementFinalized ? task.myStats.shareBP : task.myStats.estShareBP })}</span>
                )}
                <span className="oac-mt-card-stamp">{relativeTime(task.lastActivityMs, mt)} · {task.freshness.eventCount} {mt('mtEvents')} @{task.freshness.boundaryBlock}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
