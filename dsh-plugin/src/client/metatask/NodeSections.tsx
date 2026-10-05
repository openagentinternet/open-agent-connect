/**
 * Node requirement sections (F9, competitive) — per node: header (id chip,
 * title, kind, weight, winner/verified/candidates/open status), the numbered
 * acceptance rubric (params.rubric) on the left with the spec/workspace line,
 * candidate rows (identity badge, vote pips, state tag, time) opening the
 * drawer on the right.
 */
import { type ReactNode } from 'react'
import {
  candidateState,
  shortPin,
  type CandidateLike,
  type NodeLike,
} from '../../metatask-logic.js'
import { MtBadge } from './MtBadge.tsx'
import type { IdentityOf } from './ChainView.tsx'
import type { TaskProjection } from './MetataskDetail.tsx'
import type { MetataskBoardLocale } from './MetataskBoard.tsx'

type Mt = MetataskBoardLocale['mt']

const relativeTime = (ms: number, mt: Mt): string => {
  if (!ms) return '—'
  const delta = Date.now() - ms
  const minutes = Math.round(delta / 60_000)
  if (minutes < 1) return mt('mtJustNow')
  if (minutes < 60) return mt('mtMinutesAgo', { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return mt('mtHoursAgo', { count: hours })
  return mt('mtDaysAgo', { count: Math.round(hours / 24) })
}

export function NodeSections(props: {
  mt: Mt
  task: TaskProjection
  byPin: Map<string, CandidateLike>
  winningSet: Set<string> | null
  identityOf: IdentityOf
  rosterIds: Set<string>
  youLabel: string
  onOpenCandidate: (pinId: string) => void
}): ReactNode {
  const { mt, task, byPin, winningSet, identityOf, rosterIds, youLabel, onOpenCandidate } = props

  return (
    <section className="oac-mt-nodesections">
      {Object.values(task.nodeStates)
        .sort((left, right) => (left.id.length !== right.id.length ? left.id.length - right.id.length : left.id < right.id ? -1 : 1))
        .map((node) => {
          const candidates = node.submissions ?? []
          const rubric = Array.isArray(node.params?.rubric)
            ? (node.params.rubric as unknown[]).filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
            : []
          const winnerCand = winningSet ? candidates.find((cand) => winningSet.has(cand.pinId)) : undefined
          const leader = node.submission
          const quorum = Math.max(1, task.policy.verifyQuorum)
          return (
            <div key={node.id} className="oac-mt-nodesection">
              <div className="oac-mt-nodesection-head">
                <span className="oac-mt-stepchip">{node.id}</span>
                <span className="oac-mt-node-title" title={node.title}>{node.title}</span>
                <span className="oac-mt-chip">{node.kind}</span>
                <span className="oac-mt-stepweight">{Math.round((node.weight ?? 0) / 100)}% · {node.weight ?? 0}BP</span>
                {winnerCand
                  ? <span className="oac-mt-badge oac-mt-badge-settled">{mt('mtNodeWinner', { name: identityOf(winnerCand.submitter ?? '').name ?? '' })}</span>
                  : leader && candidates.some((cand) => cand.pinId === leader.pinId && cand.verified && cand.chainValid)
                    ? <span className="oac-mt-badge oac-mt-badge-leadgold">{mt('mtNodeVerified', { name: identityOf(leader.submitter).name ?? '' })}</span>
                    : candidates.length > 0
                      ? <span className="oac-mt-chip">{mt('mtNodeCandidates', { count: candidates.length })}</span>
                      : <span className="oac-mt-chip">{mt('mtNodeOpen')}</span>}
                {node.disputed && <span className="oac-mt-badge oac-mt-badge-rejected">{mt('mtDisputed')}</span>}
              </div>
              <div className="oac-mt-nodesection-body">
                <div className="oac-mt-rubric">
                  <div className="oac-mt-h4">{mt('mtNodeRubricTitle')}</div>
                  {rubric.length > 0
                    ? rubric.map((entry, index) => (
                      <div key={index} className="oac-mt-rubric-item"><span className="oac-mt-rubric-n">{index + 1}</span>{entry}</div>
                    ))
                    : <div className="oac-mt-rubric-item oac-mt-empty-inline">{mt('mtRubricNone')}</div>}
                  {node.specid && <div className="oac-mt-fact">{mt('mtNodeSpec', { spec: shortPin(node.specid) })}</div>}
                </div>
                <div className="oac-mt-node-cands">
                  <div className="oac-mt-h4">{mt('mtNodeCandsTitle', { count: candidates.length })}</div>
                  {candidates.map((cand) => {
                    const state = candidateState(node as unknown as NodeLike, cand as unknown as CandidateLike, byPin, winningSet)
                    const identity = identityOf(cand.submitter)
                    return (
                      <button key={cand.pinId} type="button" className={`oac-mt-node-cand oac-cand-${state}`}
                        onClick={() => { onOpenCandidate(cand.pinId) }}>
                        <MtBadge
                          metaId={cand.submitter}
                          name={identity.name}
                          avatar={identity.avatar}
                          you={rosterIds.has(cand.submitter)}
                          youLabel={youLabel}
                        />
                        <span className="oac-mt-pips">
                          {Array.from({ length: quorum }, (_, index) => (
                            <i key={`p${index}`} className={`oac-pip ${index < cand.passVotes ? 'oac-pip-pass' : ''}`} />
                          ))}
                          {Array.from({ length: cand.failVotes }, (_, index) => (
                            <i key={`f${index}`} className="oac-pip oac-pip-fail" />
                          ))}
                        </span>
                        <span className={`oac-mt-statetag oac-tag-cand-${state}`}>{mt(`mtCand_${state}`)}</span>
                        <span className="oac-mt-dim">{relativeTime(cand.atMs, mt)}</span>
                      </button>
                    )
                  })}
                  {candidates.length === 0 && (
                    <div className="oac-mt-empty-inline">{mt('mtNodeNoCandidates')}</div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
    </section>
  )
}
