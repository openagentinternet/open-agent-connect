/**
 * Chain view (F7, competitive only): columns by deps depth, one card per
 * candidate, SVG bezier edges along parentrefs — gold for the verified/winner
 * chain, sky dashed-flow for the race front, violet dotted for optimistic,
 * gray otherwise. Card click opens the candidate drawer. Honors
 * prefers-reduced-motion (the dash-flow animation pauses).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  candidateState,
  type CandidateLike,
  type NodeLike,
} from '../../metatask-logic.js'
import type { TaskNodeState, TaskProjection } from './MetataskDetail.tsx'
import type { MetataskBoardLocale } from './MetataskBoard.tsx'

type Mt = MetataskBoardLocale['mt']

const depthOf = (node: TaskNodeState, states: Record<string, TaskNodeState>): number => {
  let depth = 0
  let cursor: TaskNodeState | undefined = node
  const seen = new Set<string>()
  while (cursor) {
    const dep = cursor.deps[0]
    if (!dep || seen.has(cursor.id)) break
    seen.add(cursor.id)
    cursor = states[dep]
    depth += 1
  }
  return depth
}

const stateClass: Record<string, string> = {
  winner: 'oac-cand-winner',
  leading: 'oac-cand-leading',
  behind: 'oac-cand-behind',
  inReview: 'oac-cand-inreview',
  awaitingDeps: 'oac-cand-awaiting',
  optimistic: 'oac-cand-optimistic',
  replaced: 'oac-cand-replaced',
  rejected: 'oac-cand-rejected',
  stalled: 'oac-cand-stalled',
}

export function ChainView(props: {
  mt: Mt
  task: TaskProjection
  byPin: Map<string, CandidateLike>
  winningSet: Set<string> | null
  race: Set<string> | null
  onOpenCandidate: (pinId: string) => void
}): ReactNode {
  const { mt, task, byPin, winningSet, race, onOpenCandidate } = props
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [edgePaths, setEdgePaths] = useState<{ d: string; tone: string }[]>([])

  const columns = useMemo(() => {
    const states = task.nodeStates
    const byDepth = new Map<number, TaskNodeState[]>()
    for (const node of Object.values(states)) {
      const depth = depthOf(node, states)
      const list = byDepth.get(depth) ?? []
      list.push(node)
      byDepth.set(depth, list)
    }
    return Array.from(byDepth.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([depth, nodes]) => [depth, nodes.sort((left, right) => (left.id < right.id ? -1 : 1))] as const)
  }, [task])

  // Redraw the SVG edge layer from measured card rects (data-cand-pin).
  const redraw = () => {
    const container = containerRef.current
    if (!container) return
    const rectOf = (pinId: string): DOMRect | null =>
      container.querySelector(`[data-cand-pin="${CSS.escape(pinId)}"]`)?.getBoundingClientRect() ?? null
    const base = container.getBoundingClientRect()
    const paths: { d: string; tone: string }[] = []
    for (const node of Object.values(task.nodeStates)) {
      for (const cand of node.submissions ?? []) {
        for (const [dep, parentPin] of Object.entries(cand.parentrefs ?? {})) {
          void dep
          const from = rectOf(parentPin)
          const to = rectOf(cand.pinId)
          if (!from || !to) continue
          const x1 = from.right - base.left
          const y1 = from.top + from.height / 2 - base.top
          const x2 = to.left - base.left
          const y2 = to.top + to.height / 2 - base.top
          const mid = (x1 + x2) / 2
          const parent = byPin.get(parentPin)
          const onWinning = winningSet?.has(parentPin) && winningSet.has(cand.pinId)
          const onRace = race?.has(parentPin) && race.has(cand.pinId)
          const tone = onWinning || (parent?.chainValid && cand.chainValid && winningSet?.has(cand.pinId))
            ? 'oac-edge-gold'
            : onRace
              ? 'oac-edge-race'
              : cand.parentrefs && Object.keys(cand.parentrefs).length > 0 && parent && !parent.chainValid
                ? 'oac-edge-optimistic'
                : 'oac-edge-gray'
          paths.push({ d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`, tone })
        }
      }
    }
    setEdgePaths(paths)
  }

  useEffect(() => {
    redraw()
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => { redraw() })
    observer.observe(container)
    return () => { observer.disconnect() }
  }) // re-run on every render: data changes resize the columns

  return (
    <div className="oac-mt-chainview">
      <div className="oac-mt-chainview-scroll" ref={containerRef}>
        {edgePaths.length > 0 && (
          <svg className="oac-mt-edges" aria-hidden="true">
            {edgePaths.map((edge, index) => (
              <path key={index} d={edge.d} className={`oac-edge ${edge.tone}`} />
            ))}
          </svg>
        )}
        <div className="oac-mt-columns">
          {columns.map(([depth, nodes]) => (
            <div key={depth} className="oac-mt-column">
              <div className="oac-mt-column-label">{mt('mtChainStep', { depth })}</div>
              {nodes.flatMap((node) =>
                (node.submissions ?? []).map((cand) => {
                  const state = candidateState(node as unknown as NodeLike, cand as unknown as CandidateLike, byPin, winningSet)
                  const onRace = race?.has(cand.pinId) ?? false
                  const tip = onRace && race ? isTip(cand.pinId, race, byPin) : false
                  return (
                    <button
                      key={cand.pinId}
                      type="button"
                      data-cand-pin={cand.pinId}
                      className={`oac-mt-cand ${stateClass[state]} ${onRace ? 'oac-cand-onrace' : ''}`}
                      onClick={() => { onOpenCandidate(cand.pinId) }}
                    >
                      <div className="oac-mt-cand-node">{node.id} · {node.title}</div>
                      <div className="oac-mt-cand-sub">{cand.submitter.slice(0, 10)}… · {mt(`mtCand_${state}`)}{tip ? ` · ${mt('mtRaceTip')}` : ''}</div>
                      <div className="oac-mt-cand-votes">
                        {[...(cand.votes ?? [])].length > 0
                          ? mt('mtVotesPips', { pass: cand.passVotes ?? 0, fail: cand.failVotes ?? 0, quorum: task.policy.verifyQuorum })
                          : mt('mtNoVotes')}
                      </div>
                    </button>
                  )
                }),
              )}
              {nodes.every((node) => (node.submissions ?? []).length === 0) && (
                <button type="button" className="oac-mt-cand oac-cand-empty" onClick={() => { onOpenCandidate('') }}>
                  {mt('mtChainEmptyStep')}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="oac-mt-legend">
        <span className="oac-mt-legend-gold">● {mt('mtLegendGold')}</span>
        <span className="oac-mt-legend-sky">● {mt('mtLegendSky')}</span>
        <span className="oac-mt-legend-violet">● {mt('mtLegendViolet')}</span>
        <span className="oac-mt-legend-gray">● {mt('mtLegendGray')}</span>
      </div>
    </div>
  )
}

/** The race tip is the path member no other path member references. */
const isTip = (pinId: string, race: Set<string>, byPin: Map<string, CandidateLike>): boolean => {
  for (const pin of race) {
    const cand = byPin.get(pin)
    if (cand && Object.values(cand.parentrefs ?? {}).includes(pinId) && pin !== pinId) return false
  }
  return true
}
