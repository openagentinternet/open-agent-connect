/**
 * Node requirement sections (F9, competitive): per node — id/kind/weight/
 * state header, the numbered rubric (params.rubric) on the left, the
 * candidate rows (voter pips + state tag + time) opening the drawer.
 */
import { type ReactNode } from 'react'
import {
  candidateState,
  type CandidateLike,
  type NodeLike,
} from '../../metatask-logic.js'
import type { TaskProjection } from './MetataskDetail.tsx'
import type { MetataskBoardLocale } from './MetataskBoard.tsx'

type Mt = MetataskBoardLocale['mt']

export function NodeSections(props: {
  mt: Mt
  task: TaskProjection
  byPin: Map<string, CandidateLike>
  winningSet: Set<string> | null
  nameOf: (metaId: string) => string
  onOpenCandidate: (pinId: string) => void
}): ReactNode {
  const { mt, task, byPin, winningSet, nameOf, onOpenCandidate } = props

  return (
    <div className="oac-mt-nodesections">
      {Object.values(task.nodeStates)
        .sort((left, right) => (left.id.length !== right.id.length ? left.id.length - right.id.length : left.id < right.id ? -1 : 1))
        .map((node) => {
          const rubric = Array.isArray(node.params?.rubric)
            ? (node.params.rubric as unknown[]).filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
            : []
          const winnerPin = task.settlement?.winningChain?.find((pinId) =>
            (node.submissions ?? []).some((cand) => cand.pinId === pinId))
          const leaderName = node.submission ? nameOf(node.submission.submitter) : null
          return (
            <div key={node.id} className="oac-mt-nodesection">
              <div className="oac-mt-nodesection-head">
                <span className="oac-mt-chip oac-mt-chip-node">{node.id}</span>
                <span className="oac-mt-node-title">{node.title}</span>
                <span className="oac-mt-chip">{node.kind}</span>
                <span className="oac-mt-chip">{mt('mtWeightPct', { pct: Math.round((node.weight ?? 0) / 100), bp: node.weight ?? 0 })}</span>
                {node.status === 'verified'
                  ? <span className="oac-mt-badge oac-mt-badge-leading">{winnerPin ? mt('mtNodeWinner', { name: leaderName ?? '' }) : mt('mtNodeVerified', { name: leaderName ?? '' })}</span>
                  : (node.submissions ?? []).length > 0
                    ? <span className="oac-mt-chip">{mt('mtNodeCandidates', { count: (node.submissions ?? []).length })}</span>
                    : <span className="oac-mt-chip">{mt('mtNodeOpen')}</span>}
                {node.disputed && <span className="oac-mt-badge oac-mt-badge-rejected">{mt('mtDisputed')}</span>}
              </div>
              <div className="oac-mt-nodesection-body">
                <div className="oac-mt-rubric">
                  {rubric.length > 0
                    ? rubric.map((entry, index) => (
                      <div key={index} className="oac-mt-rubric-item">{index + 1}. {entry}</div>
                    ))
                    : <div className="oac-mt-rubric-item oac-mt-empty-inline">{mt('mtRubricNone')}</div>}
                  {node.specid && <div className="oac-mt-fact">{mt('mtNodeSpec', { spec: node.specid.slice(0, 10) + '…' })}</div>}
                </div>
                <div className="oac-mt-node-cands">
                  {(node.submissions ?? []).map((cand) => {
                    const state = candidateState(node as unknown as NodeLike, cand as unknown as CandidateLike, byPin, winningSet)
                    const quorum = task.policy.verifyQuorum
                    const pips = Array.from({ length: Math.max(quorum, cand.passVotes) }, (_, index) =>
                      index < cand.passVotes ? 'oac-pip-pass' : index < quorum ? 'oac-pip-open' : 'oac-pip-fail')
                    return (
                      <button key={cand.pinId} type="button" className={`oac-mt-node-cand ${state}`}
                        onClick={() => { onOpenCandidate(cand.pinId) }}>
                        <span>{nameOf(cand.submitter)}</span>
                        <span className="oac-mt-pips">{pips.map((cls, index) => <i key={index} className={`oac-pip ${cls}`} />)}</span>
                        <span className={`oac-mt-badge oac-mt-badge-cand-${state}`}>{mt(`mtCand_${state}`)}</span>
                        <span className="oac-mt-chip">{new Date(cand.atMs).toLocaleDateString()}</span>
                      </button>
                    )
                  })}
                  {(node.submissions ?? []).length === 0 && (
                    <div className="oac-mt-empty-inline">{mt('mtNodeNoCandidates')}</div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
    </div>
  )
}
