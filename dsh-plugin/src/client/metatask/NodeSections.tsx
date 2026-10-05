/**
 * Node requirement sections (F9, competitive) — IDBots MetaTaskNodeSections
 * parity: ONE card per node (no outer wrapper), each with a collapsible
 * header (chevron + id chip + title + kind + weight + head-state tag +
 * disputed tag; nodes without candidates start collapsed), and an expanded
 * two-column body — numbered acceptance rubric (+ spec/workspace line) on
 * the left, candidate rows sorted gold-first on the right (gold rows get
 * the amber tint; a row opens the candidate drawer).
 */
import { useMemo, useRef, useState, type ReactNode } from 'react'
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

/** Row order: gold/verified first, live reviews next, terminal states last. */
const stateRank: Record<string, number> = {
  winner: 0,
  leading: 1,
  inReview: 2,
  optimistic: 3,
  awaitingDeps: 4,
  behind: 5,
  stalled: 6,
  replaced: 7,
  rejected: 8,
}

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

  const nodes = useMemo(
    () =>
      Object.values(task.nodeStates).sort((left, right) =>
        left.id.localeCompare(right.id, undefined, { numeric: true }),
      ),
    [task.nodeStates],
  )

  /** Nodes WITHOUT candidates start collapsed (default computed once per
   * task so refresh pushes never clobber the user's manual toggles). */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const initForRef = useRef<string | null>(null)
  if (initForRef.current !== task.rootPinId) {
    initForRef.current = task.rootPinId
    setCollapsed(new Set(nodes.filter((node) => (node.submissions ?? []).length === 0).map((node) => node.id)))
  }

  const toggle = (nodeId: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  const quorum = Math.max(1, task.policy.verifyQuorum)

  return (
    <section className="oac-mt-nodesections">
      <div className="oac-mt-h3">
        {mt('mtNodeSectionsTitle')}
        <small>{mt('mtNodeSectionsHint')}</small>
      </div>
      {nodes.map((node) => {
        const candidates = [...(node.submissions ?? [])].sort(
          (left, right) =>
            stateRank[candidateState(node as unknown as NodeLike, left as unknown as CandidateLike, byPin, winningSet)]
            - stateRank[candidateState(node as unknown as NodeLike, right as unknown as CandidateLike, byPin, winningSet)],
        )
        const isCollapsed = collapsed.has(node.id)
        const rubric = Array.isArray(node.params?.rubric)
          ? (node.params.rubric as unknown[]).filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          : []
        const workspace = typeof node.params?.workspace === 'string' && node.params.workspace.trim() ? node.params.workspace.trim() : null
        const winnerCand = winningSet ? candidates.find((cand) => winningSet.has(cand.pinId)) : undefined
        const leaderCand = !winnerCand && node.submission
          ? candidates.find((cand) => cand.pinId === node.submission?.pinId && cand.verified && cand.chainValid)
          : undefined
        return (
          <div key={node.id} className="oac-mt-nodesection">
            <button type="button" className="oac-mt-nodesection-head" onClick={() => { toggle(node.id) }}>
              <span className={`oac-mt-chevron ${isCollapsed ? 'oac-mt-chevron-closed' : ''}`} aria-hidden="true" />
              <span className="oac-mt-stepchip">{node.id}</span>
              <span className="oac-mt-nodesection-title" title={node.title}>{node.title}</span>
              <span className="oac-mt-mono oac-mt-dim">{node.kind}</span>
              {node.weight !== null && (
                <span className="oac-mt-stepweight">{Math.round((node.weight ?? 0) / 100)}% · {node.weight}BP</span>
              )}
              {winnerCand
                ? <span className="oac-mt-headtag oac-mt-headtag-winner">{mt('mtNodeWinner', { name: identityOf((winnerCand as { submitter?: string }).submitter ?? '').name ?? '' })}</span>
                : leaderCand
                  ? <span className="oac-mt-headtag oac-mt-headtag-leading">{mt('mtNodeVerified', { name: identityOf(node.submission?.submitter ?? '').name ?? '' })}</span>
                  : candidates.length > 0
                    ? <span className="oac-mt-headtag oac-mt-headtag-competing">{mt('mtNodeCandidates', { count: candidates.length })}</span>
                    : <span className="oac-mt-headtag oac-mt-headtag-open">{mt('mtNodeOpen')}</span>}
              {node.disputed && <span className="oac-mt-headtag oac-mt-headtag-disputed">{mt('mtDisputed')}</span>}
            </button>

            {!isCollapsed && (
              <div className="oac-mt-nodesection-body">
                <div className="oac-mt-rubric">
                  <div className="oac-mt-h4">{mt('mtNodeRubricTitle')}</div>
                  {rubric.length > 0
                    ? rubric.map((entry, index) => (
                      <div key={index} className="oac-mt-rubric-item"><span className="oac-mt-rubric-n">{index + 1}</span>{entry}</div>
                    ))
                    : node.params && Object.keys(node.params).length > 0
                      ? (
                        <details className="oac-mt-params">
                          <summary>{mt('mtNodeParamsJson')}</summary>
                          <pre>{JSON.stringify(node.params, null, 2)}</pre>
                        </details>
                      )
                      : <div className="oac-mt-rubric-item oac-mt-empty-inline">{mt('mtRubricNone')}</div>}
                  {(node.specid || workspace) && (
                    <div className="oac-mt-fact oac-mt-mono oac-mt-dim">
                      {node.specid && <span>spec: {node.specid}</span>}
                      {node.specid && workspace && <span> · </span>}
                      {workspace && <span>workspace: {workspace}</span>}
                    </div>
                  )}
                </div>
                <div className="oac-mt-node-cands">
                  <div className="oac-mt-h4">{mt('mtNodeCandsTitle', { count: candidates.length })}</div>
                  {candidates.map((cand) => {
                    const state = candidateState(node as unknown as NodeLike, cand as unknown as CandidateLike, byPin, winningSet)
                    const gold = state === 'winner' || state === 'leading'
                    const identity = identityOf(cand.submitter)
                    return (
                      <button key={cand.pinId} type="button" title={cand.pinId}
                        className={`oac-mt-node-cand ${gold ? 'oac-mt-node-cand-gold' : ''}`}
                        onClick={() => { onOpenCandidate(cand.pinId) }}>
                        <span className="oac-mt-node-cand-id">
                          <MtBadge
                            metaId={cand.submitter}
                            name={identity.name}
                            avatar={identity.avatar}
                            you={rosterIds.has(cand.submitter)}
                            youLabel={youLabel}
                          />
                          <code className="oac-mt-mono oac-mt-dim">{shortPin(cand.pinId)}</code>
                        </span>
                        <span className="oac-mt-pips">
                          {Array.from({ length: quorum }, (_, index) => (
                            <i key={`p${index}`} className={`oac-pip ${index < cand.passVotes ? 'oac-pip-pass' : ''}`} />
                          ))}
                          {Array.from({ length: cand.failVotes }, (_, index) => (
                            <i key={`f${index}`} className="oac-pip oac-pip-fail" />
                          ))}
                        </span>
                        <span className={`oac-mt-headtag oac-tag-cand-${state}`}>{mt(`mtCand_${state}`)}</span>
                        <span className="oac-mt-dim">{relativeTime(cand.atMs, mt)}</span>
                      </button>
                    )
                  })}
                  {candidates.length === 0 && (
                    <div className="oac-mt-empty-inline">{mt('mtNodeNoCandidates')}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
