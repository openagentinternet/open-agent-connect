/**
 * MetaTask detail (F4 + F6): header with policy facts, the deliverables
 * section (competitive), the race explainer + chain status line, the chain
 * view (competitive) or the classic node table (tree), node requirement
 * sections, roster and settlement tables. Hosts the candidate drawer state.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  candidatesByPin,
  raceFrontPath,
  raceFrontTip,
  shortMetaId,
  shortPin,
} from '../../metatask-logic.js'
import { ChainView } from './ChainView.tsx'
import { CandidateDrawer, type DrawerCandidate } from './CandidateDrawer.tsx'
import { Deliverables } from './Deliverables.tsx'
import { NodeSections } from './NodeSections.tsx'
import { RosterSettlement } from './RosterSettlement.tsx'
import type { MetataskApi, MetataskBoardLocale } from './MetataskBoard.tsx'

export interface TaskNodeState {
  id: string
  parent: string | null
  title: string
  kind: string
  weight: number | null
  params: Record<string, unknown> | null
  specid: string | null
  deps: string[]
  status: string
  disputed: boolean
  holder: { pinId: string; claimant: string; sinceMs: number } | null
  submission: {
    pinId: string
    submitter: string
    atMs: number
    result: Record<string, unknown> | null
    hash: string | null
    contentType: string | null
    attachment: string | null
    parentrefs?: Record<string, string> | null
  } | null
  submissions?: DrawerCandidate[]
  passVotes: number
  failVotes: number
  votes: {
    voter: string
    verdict: string
    pinId: string
    counted: boolean
    ignoreReason: string | null
    semanticCheck: boolean
    failreason: boolean
    targetid: string
    height: number
    timestampMs: number
    failreasonText: string | null
    semanticCheckText: string | null
  }[]
  cycleCount: number
}

export interface TaskProjection {
  rootPinId: string
  title: string
  brief: string
  publisher: string
  tags: string[]
  policy: {
    mode: 'tree' | 'competitive'
    finalNode: string | null
    claimTtlHours: number
    verifyQuorum: number
    verifyWindowHours: number
    rewardSat: number
    challengeTtlDays: number
    submitterShareBP: number
    rosterid: string | null
  }
  nodes: { id: string; deps?: string[] }[]
  amendHead: string
  nodeStates: Record<string, TaskNodeState>
  progress: { total: number; verified: number; claimed: number; open: number; disputed: number; satisfied: number }
  taskComplete: boolean
  participants: { metaId: string; effectiveClaims: number; submissions: number; verifiedContrib: number; reviewVotes: number; reviewCorrect: number; reviewTerminal: number }[]
  identities: Record<string, { name: string | null; avatar: string | null }>
  settlement: {
    shares: { metaId: string; shareBP: number; from: { submittedBP: number; reviewedBP: number } }[]
    unpaidHistory: { node: string; author: string; pinId: string; reason: string }[]
    winningChain?: string[]
    engineAlgoVersion: string
    boundaryBlock: number
  } | null
  freshness: { boundaryBlock: number; evaluatedAtMs: number; eventCount: number; eventSetHash: string; expiryApplied: boolean }
  lastActivityMs: number
  ignoredEvents: { pinId: string; reason: string }[]
}

export function MetataskDetail(
  props: MetataskBoardLocale & MetataskApi & {
    mtApi?: { metataskTask: (root: string, refresh?: boolean) => Promise<unknown> }
    root: string
    onBack: () => void
  },
): ReactNode {
  const { mt, root, onBack } = props
  const metataskTask = props.mtApi?.metataskTask
  const [task, setTask] = useState<TaskProjection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<{ pinId: string } | null>(null)

  const load = useCallback(async () => {
    if (!metataskTask) return
    try {
      setTask(await metataskTask(root) as TaskProjection)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [metataskTask, root])

  useEffect(() => { void load() }, [load])

  const byPin = useMemo(
    () => candidatesByPin(Object.values(task?.nodeStates ?? {})),
    [task],
  )
  const race = useMemo(() => {
    if (!task || task.policy.mode !== 'competitive' || task.taskComplete) return null
    const tip = raceFrontTip(Object.values(task.nodeStates), byPin)
    return tip ? raceFrontPath(tip, byPin) : null
  }, [task, byPin])
  const winningSet = useMemo(
    () => (task?.settlement?.winningChain ? new Set(task.settlement.winningChain) : null),
    [task],
  )

  if (error) return <div className="oac-mt-empty">{mt('mtLoadError', { message: error })}</div>
  if (!task) return <div className="oac-mt-empty">{mt('mtLoading')}</div>

  const { policy, progress } = task
  const verifiedChain = (task.settlement?.winningChain ?? [])
  const nameOf = (metaId: string): string => task.identities[metaId]?.name || shortMetaId(metaId)
  const drawerCandidate = drawer ? byPin.get(drawer.pinId) ?? null : null
  const drawerNode = drawerCandidate
    ? Object.values(task.nodeStates).find((node) => (node.submissions ?? []).some((cand) => cand.pinId === drawerCandidate.pinId)) ?? null
    : null

  return (
    <div className="oac-mt-detail">
      <div className="oac-mt-detail-head">
        <button type="button" className="oac-btn oac-btn-sm" onClick={onBack}>← {mt('mtBackToBoard')}</button>
        <span className="oac-mt-card-title">{task.title}</span>
        <span className="oac-mt-chip">{shortPin(task.rootPinId)}</span>
        <span className="oac-mt-chip">{mt('mtPublisher')}: {nameOf(task.publisher)}</span>
        <span className="oac-mt-chip">{progress.verified}/{progress.total} {mt('mtVerified')}</span>
        <span className="oac-mt-chip">{task.freshness.eventCount} {mt('mtEvents')} @{task.freshness.boundaryBlock}</span>
      </div>
      <div className="oac-mt-policy">
        {mt('mtPolicyFacts', {
          quorum: policy.verifyQuorum,
          sigma: policy.submitterShareBP,
          reward: policy.rewardSat,
          mode: policy.mode === 'competitive' ? mt('mtModeCompetitive') : mt('mtModeTree'),
          final: policy.finalNode ?? '—',
        })}
      </div>

      {task.policy.mode === 'competitive' && (
        <Deliverables mt={mt} task={task} nameOf={nameOf} byPin={byPin} onOpenCandidate={(pinId) => { setDrawer({ pinId }) }} />
      )}

      <div className="oac-mt-rules" data-mode={policy.mode}>
        {policy.mode === 'competitive' ? mt('mtRulesCompetitive') : mt('mtRulesTree')}
      </div>
      <div className="oac-mt-chainline">
        {task.taskComplete
          ? <span className="oac-mt-chainline-gold">● {mt('mtVerifiedChain', { count: verifiedChain.length })} {mt('mtSettled')}</span>
          : race
            ? (
              <span>
                <span className="oac-mt-chainline-gold">● {mt('mtVerifiedChain', { count: progress.satisfied })}</span>
                <span className="oac-mt-chainline-sky"> ● {mt('mtRaceFront', { bot: nameOf((byPin.get([...race][0] ?? '')?.submitter ?? '')) })}</span>
              </span>
            )
            : <span>● {mt('mtVerifiedChain', { count: progress.satisfied })}</span>}
      </div>

      {policy.mode === 'competitive'
        ? (
          <ChainView
            mt={mt}
            task={task}
            byPin={byPin}
            winningSet={winningSet}
            race={race}
            onOpenCandidate={(pinId) => { setDrawer({ pinId }) }}
          />
        )
        : (
          <div className="oac-mt-nodetable">
            {Object.values(task.nodeStates).map((node) => (
              <div key={node.id} className="oac-mt-node-row">
                <span className={`oac-mt-dot oac-mt-dot-${node.status}`} />
                <span className="oac-mt-node-id">{node.id}</span>
                <span className="oac-mt-node-title">{node.title}</span>
                <span className="oac-mt-chip">{node.status}{node.disputed ? ` · ${mt('mtDisputed')}` : ''}</span>
                <span className="oac-mt-chip">{mt('mtWeight', { weight: node.weight ?? 0 })}</span>
                <span className="oac-mt-chip">{node.holder ? nameOf(node.holder.claimant) : node.submission ? nameOf(node.submission.submitter) : '—'}</span>
              </div>
            ))}
          </div>
        )}

      {policy.mode === 'competitive' && (
        <NodeSections mt={mt} task={task} byPin={byPin} winningSet={winningSet} nameOf={nameOf} onOpenCandidate={(pinId) => { setDrawer({ pinId }) }} />
      )}

      <RosterSettlement mt={mt} task={task} nameOf={nameOf} />

      {(task.ignoredEvents ?? []).length > 0 && (
        <div className="oac-mt-ignored">
          <div className="oac-mt-section-title">{mt('mtIgnoredTitle')}</div>
          {task.ignoredEvents.map((entry) => (
            <div key={entry.pinId} className="oac-mt-node-row oac-mt-ignored-row">
              <span className="oac-mt-chip">{shortPin(entry.pinId)}</span>
              <span>{mt(`mtIgnored_${entry.reason}`) !== `mtIgnored_${entry.reason}` ? mt(`mtIgnored_${entry.reason}`) : entry.reason}</span>
            </div>
          ))}
        </div>
      )}

      {drawerCandidate && drawerNode && (
        <CandidateDrawer
          mt={mt}
          task={task}
          node={drawerNode}
          cand={drawerCandidate}
          byPin={byPin}
          nameOf={nameOf}
          winningSet={winningSet}
          onClose={() => { setDrawer(null) }}
          onOpenCandidate={(pinId) => { setDrawer({ pinId }) }}
        />
      )}
    </div>
  )
}
