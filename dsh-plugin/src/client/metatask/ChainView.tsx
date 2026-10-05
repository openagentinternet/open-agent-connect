/**
 * Chain view (F7, competitive only) — full-fidelity port of IDBots'
 * MetaTaskChainView: ONE COLUMN PER NODE (deps-depth ordered, never merged),
 * step headers with status words + weights, candidate cards with identity
 * badges / state tags / vote pips / YOU chips, the SVG bezier edge layer
 * (gold verified chain, blue race front with flow animation, violet
 * optimistic, gray otherwise), per-step empty invitations, and the full
 * legend. Card click opens the candidate drawer.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  candidateState,
  percentOf,
  shortPin,
  type CandidateLike,
  type NodeLike,
} from '../../metatask-logic.js'
import { MtBadge } from './MtBadge.tsx'
import type { TaskNodeState, TaskProjection } from './MetataskDetail.tsx'
import type { MetataskBoardLocale } from './MetataskBoard.tsx'

type Mt = MetataskBoardLocale['mt']

export type IdentityOf = (metaId: string) => { name: string | null; avatar: string | null }

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

const tagClass: Record<string, string> = {
  winner: 'oac-tag-solid-gold',
  leading: 'oac-tag-solid-gold',
  behind: 'oac-tag-line-emerald',
  inReview: 'oac-tag-line-sky',
  awaitingDeps: 'oac-tag-line-violet',
  optimistic: 'oac-tag-line-violet',
  replaced: 'oac-tag-line-slate',
  rejected: 'oac-tag-line-red',
  stalled: 'oac-tag-line-slate',
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

const Pips = (props: { pass: number; fail: number; quorum: number }): ReactNode => (
  <span className="oac-mt-pips" title={`${props.pass}/${props.quorum} · ${props.fail}`}>
    {Array.from({ length: Math.max(props.quorum, 1) }, (_, index) => (
      <i key={`p${index}`} className={`oac-pip ${index < props.pass ? 'oac-pip-pass' : ''}`} />
    ))}
    {Array.from({ length: props.fail }, (_, index) => (
      <i key={`f${index}`} className="oac-pip oac-pip-fail" />
    ))}
  </span>
)

export function ChainView(props: {
  mt: Mt
  task: TaskProjection
  byPin: Map<string, CandidateLike>
  winningSet: Set<string> | null
  race: Set<string> | null
  identityOf: IdentityOf
  rosterIds: Set<string>
  youLabel: string
  onOpenCandidate: (pinId: string) => void
}): ReactNode {
  const { mt, task, byPin, winningSet, race, identityOf, rosterIds, youLabel, onOpenCandidate } = props
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [edgePaths, setEdgePaths] = useState<{ d: string; tone: string }[]>([])

  // Topological deps depth (entry nodes = 0). The engine guarantees acyclicity;
  // the guard only keeps a malformed payload from recursing.
  const depths = useMemo(() => {
    const states = task.nodeStates
    const memo = new Map<string, number>()
    const visit = (id: string, stack: Set<string>): number => {
      const hit = memo.get(id)
      if (hit !== undefined) return hit
      if (stack.has(id)) return 0
      stack.add(id)
      let depth = 0
      for (const dep of states[id]?.deps ?? []) {
        if (states[dep]) depth = Math.max(depth, visit(dep, stack) + 1)
      }
      stack.delete(id)
      memo.set(id, depth)
      return depth
    }
    for (const id of Object.keys(states)) visit(id, new Set())
    return memo
  }, [task])

  const terminalId = task.policy.finalNode && task.nodeStates[task.policy.finalNode]
    ? task.policy.finalNode
    : null

  // One column per node, depth-ordered, natural id within a depth.
  const columns = useMemo(
    () =>
      [...Object.values(task.nodeStates)].sort((left, right) => {
        const dl = depths.get(left.id) ?? 0
        const dr = depths.get(right.id) ?? 0
        if (dl !== dr) return dl - dr
        return left.id.localeCompare(right.id, undefined, { numeric: true })
      }),
    [task, depths],
  )

  const stepWord = (node: TaskNodeState): { text: string; gold: boolean } => {
    const candidates = node.submissions ?? []
    const winnerCand = winningSet
      ? candidates.find((cand) => winningSet.has(cand.pinId))
      : undefined
    const identity = winnerCand ? identityOf(winnerCand.submitter) : null
    if (winnerCand) {
      return { text: mt('mtStepWinner', { name: identity?.name ?? winnerCand.submitter.slice(0, 8) }), gold: true }
    }
    if (node.submission && candidates.some((cand) => cand.pinId === node.submission?.pinId && cand.verified && cand.chainValid)) {
      const ident = identityOf(node.submission.submitter)
      return { text: mt('mtStepLeading', { name: ident?.name ?? node.submission.submitter.slice(0, 8) }), gold: true }
    }
    if (candidates.some((cand) => cand.verified && cand.chainValid)) {
      return { text: mt('mtStepVerified'), gold: false }
    }
    const optimistic = candidates.filter((cand) => {
      const state = candidateState(node as unknown as NodeLike, cand as unknown as CandidateLike, byPin, winningSet)
      return state === 'optimistic' || state === 'awaitingDeps'
    })
    if (candidates.length > 0 && optimistic.length === candidates.length) {
      return { text: mt('mtStepOptimistic', { count: candidates.length }), gold: false }
    }
    if (candidates.length > 0) return { text: mt('mtStepCompeting', { count: candidates.length }), gold: false }
    return { text: mt('mtStepOpen'), gold: false }
  }

  const redraw = () => {
    const container = containerRef.current
    if (!container) return
    const rectOf = (pinId: string): DOMRect | null =>
      container.querySelector(`[data-cand-pin="${CSS.escape(pinId)}"]`)?.getBoundingClientRect() ?? null
    const base = container.getBoundingClientRect()
    const paths: { d: string; tone: string }[] = []
    for (const node of Object.values(task.nodeStates)) {
      for (const cand of node.submissions ?? []) {
        for (const parentPin of Object.values(cand.parentrefs ?? {})) {
          const from = rectOf(parentPin)
          const to = rectOf(cand.pinId)
          if (!from || !to) continue
          const x1 = from.right - base.left
          const y1 = from.top + from.height / 2 - base.top
          const x2 = to.left - base.left
          const y2 = to.top + to.height / 2 - base.top
          const mid = (x1 + x2) / 2
          const parentState = byPin.get(parentPin)
            ? candidateState(
                node as unknown as NodeLike,
                byPin.get(parentPin) as unknown as CandidateLike,
                byPin,
                winningSet,
              )
            : null
          const candState = candidateState(node as unknown as NodeLike, cand as unknown as CandidateLike, byPin, winningSet)
          const gold = winningSet
            ? winningSet.has(parentPin) && winningSet.has(cand.pinId)
            : parentState === 'leading' && candState === 'leading'
          const onRace = !gold && race !== null && race.has(parentPin) && race.has(cand.pinId)
          const opt = !gold && !onRace && (candState === 'optimistic' || candState === 'awaitingDeps')
          paths.push({
            d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
            tone: gold ? 'oac-edge-gold' : onRace ? 'oac-edge-race' : opt ? 'oac-edge-optimistic' : 'oac-edge-gray',
          })
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
    window.addEventListener('resize', redraw)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', redraw)
    }
  })

  const raceTipId = useMemo(() => {
    if (!race) return null
    for (const pin of race) {
      let referenced = false
      for (const other of race) {
        if (other === pin) continue
        const cand = byPin.get(other)
        if (cand && Object.values(cand.parentrefs ?? {}).includes(pin)) { referenced = true; break }
      }
      if (!referenced) return pin
    }
    return null
  }, [race, byPin])

  return (
    <section className="oac-mt-chainview">
      <h3 className="oac-mt-h3">
        {mt('mtChainTitle')}
        <small>{mt('mtChainHint')}</small>
      </h3>
      <div className="oac-mt-chainview-scroll" ref={containerRef}>
        <svg className="oac-mt-edges" aria-hidden="true">
          {edgePaths.map((edge, index) => (
            <path key={index} d={edge.d} className={`oac-edge ${edge.tone}`} />
          ))}
        </svg>
        <div className="oac-mt-columns">
          {columns.map((node) => {
            const word = stepWord(node)
            const isTerminal = node.id === terminalId
            const hasVerified = (node.submissions ?? []).some((cand) => cand.verified && cand.chainValid)
            const ruleClass = word.gold
              ? isTerminal ? 'oac-mt-rule-gold' : 'oac-mt-rule-goldgrad'
              : hasVerified ? 'oac-mt-rule-done' : isTerminal ? 'oac-mt-rule-finish' : 'oac-mt-rule-idle'
            return (
              <div key={node.id} className="oac-mt-col">
                <div className="oac-mt-stephead">
                  <div className="oac-mt-stephead-row">
                    <span className={`oac-mt-stepchip ${isTerminal ? 'oac-mt-stepchip-finish' : ''}`}>
                      {isTerminal ? mt('mtStepFinish', { id: node.id }) : node.id}
                    </span>
                    <span className="oac-mt-steptitle" title={node.title}>{node.title}</span>
                  </div>
                  <div className="oac-mt-stepmeta">
                    <span className={word.gold ? 'oac-mt-stepword-gold' : 'oac-mt-stepword'}>{word.text}</span>
                    {node.weight !== null && (
                      <span className="oac-mt-stepweight">{percentOf(node.weight, 10000)}% · {node.weight}BP</span>
                    )}
                  </div>
                  <div className={`oac-mt-rule ${ruleClass}`} />
                </div>

                {(node.submissions ?? []).length === 0 && (
                  <div className="oac-mt-cand oac-cand-emptybox">{mt('mtChainEmptyStep')}</div>
                )}
                {(node.submissions ?? []).map((cand) => {
                  const state = candidateState(node as unknown as NodeLike, cand as unknown as CandidateLike, byPin, winningSet)
                  const onRaceLine = race !== null && race.has(cand.pinId) && state === 'inReview'
                  const isTip = raceTipId !== null && cand.pinId === raceTipId
                  const identity = identityOf(cand.submitter)
                  return (
                    <button
                      key={cand.pinId}
                      type="button"
                      data-cand-pin={cand.pinId}
                      title={cand.pinId}
                      className={`oac-mt-cand ${stateClass[state]} ${onRaceLine ? 'oac-cand-onrace' : ''}`}
                      onClick={() => { onOpenCandidate(cand.pinId) }}
                    >
                      <span className={`oac-mt-statetag ${isTip ? 'oac-tag-solid-sky' : tagClass[state]}`}>
                        {isTip ? mt('mtRaceTip') : mt(`mtCand_${state}`)}
                      </span>
                      <MtBadge
                        metaId={cand.submitter}
                        name={identity.name}
                        avatar={identity.avatar}
                        you={rosterIds.has(cand.submitter)}
                        youLabel={youLabel}
                      />
                      <span className="oac-mt-cand-meta">
                        <code>{shortPin(cand.pinId)}</code>
                        <span>{relativeTime(cand.atMs, mt)}</span>
                        <Pips pass={cand.passVotes} fail={cand.failVotes} quorum={Math.max(1, task.policy.verifyQuorum)} />
                      </span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      <div className="oac-mt-legend">
        {winningSet && <span><i className="oac-lg oac-lg-winner" />{mt('mtLegendWinner')}</span>}
        <span><i className="oac-lg oac-lg-gold" />{mt('mtLegendLeading')}</span>
        <span><i className="oac-lg oac-lg-emerald" />{mt('mtLegendBehind')}</span>
        <span><i className="oac-lg oac-lg-sky-dash" />{mt('mtLegendInReview')}</span>
        {race !== null && <span><i className="oac-lg oac-lg-sky" />{mt('mtLegendRace')}</span>}
        <span><i className="oac-lg oac-lg-violet" />{mt('mtLegendOptimistic')}</span>
        <span><i className="oac-lg oac-lg-replaced" />{mt('mtLegendReplaced')}</span>
        <span><i className="oac-lg oac-lg-rejected" />{mt('mtLegendRejected')}</span>
        <span>
          <i className="oac-pip oac-pip-pass" /><i className="oac-pip" />
          {mt('mtLegendVotes', { quorum: task.policy.verifyQuorum })}
        </span>
      </div>
    </section>
  )
}
