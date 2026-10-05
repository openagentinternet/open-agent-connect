/**
 * MetaTask detail — full-fidelity port of IDBots' MetaTaskDetail: header
 * (title, lifecycle badge, brief, policy facts, publisher identity), the
 * race explainer + chain status line, how-to-join chips (draft handoff only),
 * the local-bot activity strip, deliverables, the chain view (competitive)
 * or classic node rows (tree), node requirement sections, roster + settlement,
 * ignored events, and the candidate drawer. Renderer-only: every state comes
 * from the daemon projection.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  candidatesByPin,
  raceFrontPath,
  raceFrontTip,
  shortMetaId,
  shortPin,
  taskLifecycleOf,
  treeChildrenOf,
  treeSubtreeHasAttention,
} from '../../metatask-logic.js'
import { ChainView, type IdentityOf } from './ChainView.tsx'
import { CandidateDrawer, type DrawerCandidate } from './CandidateDrawer.tsx'
import { Deliverables } from './Deliverables.tsx'
import { MtBadge } from './MtBadge.tsx'
import { NodeSections } from './NodeSections.tsx'
import { RosterSettlement } from './RosterSettlement.tsx'
import { TreeMap } from './TreeMap.tsx'
import { TreeNodeTable } from './TreeNodeTable.tsx'
import type { BoardData, MetataskApi, MetataskBoardLocale } from './MetataskBoard.tsx'

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
  estimation?: { basis: string; shares: { metaId: string; shareBP: number; from: { submittedBP: number; reviewedBP: number } }[] } | null
  freshness: { boundaryBlock: number; evaluatedAtMs: number; eventCount: number; eventSetHash: string; expiryApplied: boolean }
  lastActivityMs: number
  ignoredEvents: { pinId: string; reason: string }[]
}

const relativeTime = (ms: number, mt: (key: string, vars?: Record<string, string | number>) => string): string => {
  if (!ms) return '—'
  const delta = Date.now() - ms
  const minutes = Math.round(delta / 60_000)
  if (minutes < 1) return mt('mtJustNow')
  if (minutes < 60) return mt('mtMinutesAgo', { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return mt('mtHoursAgo', { count: hours })
  return mt('mtDaysAgo', { count: Math.round(hours / 24) })
}

export function MetataskDetail(
  props: MetataskBoardLocale & MetataskApi & {
    mtApi?: { metataskTask: (root: string, refresh?: boolean) => Promise<unknown> }
    root: string
    onBack: () => void
  },
): ReactNode {
  const { mt, root, onBack } = props
  const metataskTask = props.mtApi?.metataskTask ?? props.metataskTask
  const [task, setTask] = useState<TaskProjection | null>(null)
  const [rosterIds, setRosterIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<{ pinId: string } | null>(null)
  const [briefOpen, setBriefOpen] = useState(false)
  // Tree mode: per-node expansion + group collapse, mirroring IDBots
  // (groups with in-flight/disputed descendants default to expanded).
  const [expandedNode, setExpandedNode] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const groupsInitForRef = useRef<string | null>(null)

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
  // The board payload carries the local roster (for the YOU chips); it is
  // cheap (store-cached) and only needed once per detail visit.
  useEffect(() => {
    let alive = true
    void props.metataskBoard(false)
      .then((data) => {
        if (!alive) return
        const board = data as BoardData
        setRosterIds(new Set(board.localRosterMetaIds ?? []))
      })
      .catch(() => { /* roster chips degrade to no-YOU */ })
    return () => { alive = false }
  }, [props.metataskBoard])

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

  // Tree-mode structure helpers (IDBots childrenOf / groups / attention).
  const treeNodes = useMemo(() => Object.values(task?.nodeStates ?? {}), [task])
  const childrenOf = useMemo(() => treeChildrenOf(treeNodes), [treeNodes])
  const rootNode = treeNodes.find((node) => node.parent === null)
  const childIds = useMemo(
    () => new Set(Array.from(childrenOf.values()).flat().map((node) => node.id)),
    [childrenOf],
  )
  const baseChildren = useMemo(() => {
    if (!task) return []
    return rootNode
      ? (childrenOf.get(rootNode.id) ?? []).map((child) => task.nodeStates[child.id]).filter(Boolean)
      : treeNodes.filter((node) => !childIds.has(node.id))
  }, [task, rootNode, childrenOf, treeNodes, childIds])
  const groups = useMemo(
    () => baseChildren.filter((node) => (childrenOf.get(node.id)?.length ?? 0) > 0),
    [baseChildren, childrenOf],
  )
  const groupIdSet = useMemo(() => new Set(groups.map((node) => node.id)), [groups])
  const topLeaves = useMemo(
    () => baseChildren.filter((node) => !(childrenOf.get(node.id)?.length ?? 0)),
    [baseChildren, childrenOf],
  )

  const identityOf = useCallback<IdentityOf>((metaId) => {
    const identity = task?.identities[metaId]
    return { name: identity?.name ?? null, avatar: identity?.avatar ?? null }
  }, [task])

  const nameOf = (metaId: string): string =>
    task?.identities[metaId]?.name || shortMetaId(metaId)

  const youLabel = mt('mtYou')

  if (error) return <div className="oac-mt-empty">{mt('mtLoadError', { message: error })}</div>
  if (!task) return <div className="oac-mt-empty">{mt('mtLoading')}</div>

  // Default group expansion once per task (groups with in-flight or disputed
  // descendants open; quiet groups stay collapsed); refresh pushes must not
  // clobber the user's manual toggles.
  if (groupsInitForRef.current !== task.rootPinId) {
    groupsInitForRef.current = task.rootPinId
    setExpandedGroups(new Set(groups.filter((node) => treeSubtreeHasAttention(childrenOf, node.id)).map((node) => node.id)))
  }

  const toggleGroup = (groupId: string): void => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }
  const toggleNode = (nodeId: string): void => {
    setExpandedNode((prev) => (prev === nodeId ? null : nodeId))
  }
  const scrollToNode = (nodeId: string): void => {
    window.setTimeout(() => {
      document.getElementById(`oac-mt-node-${nodeId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
  }
  const groupOfNode = (nodeId: string): string | null => {
    const node = task.nodeStates[nodeId]
    return node?.parent && groupIdSet.has(node.parent) ? node.parent : null
  }
  const selectNodeFromMap = (nodeId: string, groupId: string | null): void => {
    if (groupId) setExpandedGroups((prev) => new Set(prev).add(groupId))
    setExpandedNode(nodeId)
    scrollToNode(nodeId)
  }

  const { policy, progress } = task
  const lifecycle = mt(`mtLifecycle${taskLifecycleOf({ settlementFinalized: Boolean(task.settlement), taskComplete: task.taskComplete }).charAt(0).toUpperCase()}${taskLifecycleOf({ settlementFinalized: Boolean(task.settlement), taskComplete: task.taskComplete }).slice(1)}`)
  const depths = new Map<string, number>()
  for (const node of Object.values(task.nodeStates)) {
    let depth = 0
    const seen = new Set<string>()
    let cursor: TaskNodeState | undefined = node
    while (cursor) {
      const dep: string | undefined = cursor.deps[0]
      if (!dep || seen.has(cursor.id) || !task.nodeStates[dep]) break
      seen.add(cursor.id)
      cursor = task.nodeStates[dep]
      depth += 1
    }
    depths.set(node.id, depth)
  }
  const chainNodeIds = [...Object.values(task.nodeStates)]
    .filter((node) => {
      const lead = node.submission?.pinId
      if (!lead) return false
      if (winningSet) return winningSet.has(lead)
      return (node.submissions ?? []).some((cand) => cand.pinId === lead && cand.verified && cand.chainValid)
    })
    .sort((left, right) => (depths.get(left.id) ?? 0) - (depths.get(right.id) ?? 0))
    .map((node) => node.id)
  const chainText = chainNodeIds.length > 0 ? chainNodeIds.join(' → ') : '—'
  const raceTip = race ? (byPin.get([...race][0] ?? '') ?? null) : null
  const raceTipNode = raceTip
    ? Object.values(task.nodeStates).find((node) => (node.submissions ?? []).some((cand) => cand.pinId === raceTip.pinId))
    : null
  const frontText = raceTip && raceTipNode && raceTip.submitter
    ? `${raceTipNode.id} · ${nameOf(raceTip.submitter)}`
    : null

  const openNodes = Object.values(task.nodeStates).filter((node) => node.status === 'open')
  const isZh = mt('mtViewSquare') === '任务广场'
  const draftFor = (nodeId?: string) => {
    void props.metataskDraft?.(root, isZh ? 'zh' : 'en').catch(() => { /* handoff is best-effort */ })
    void nodeId
  }

  // Local-bot activity (IDBots mine list): claims, my candidates, my review
  // votes — in-flight first (claimed → submitted → voted → verified).
  const mine = Object.values(task.nodeStates).flatMap((node) => {
    const rows: { key: string; nodeId: string; title: string; kind: string; status: string }[] = []
    if (node.holder && rosterIds.has(node.holder.claimant)) {
      const remainingMs = policy.claimTtlHours * 3_600_000 - (Date.now() - node.holder.sinceMs)
      rows.push({
        key: `${node.id}-claim`,
        nodeId: node.id,
        title: node.title,
        kind: 'claim',
        status: mt('mtMineClaimed', { hours: Math.max(0, Math.ceil(remainingMs / 3_600_000)) }),
      })
    }
    for (const cand of node.submissions ?? []) {
      if (!rosterIds.has(cand.submitter)) continue
      const state = winningSet?.has(cand.pinId) ? 'winner' : cand.verified && cand.chainValid ? 'verified' : cand.failed ? 'rejected' : cand.superseded ? 'replaced' : 'live'
      if (state === 'verified' || state === 'winner') {
        rows.push({ key: cand.pinId, nodeId: node.id, title: node.title, kind: 'sub-verified', status: mt('mtMineVerified') })
      } else if (state !== 'rejected') {
        rows.push({
          key: cand.pinId,
          nodeId: node.id,
          title: node.title,
          kind: `sub-${state}`,
          status: mt('mtMineSubmitted', { votes: cand.passVotes, quorum: Math.max(1, policy.verifyQuorum) }),
        })
      }
    }
    const effective = node.submission
    const localVote = effective ? node.votes.find((vote) => rosterIds.has(vote.voter)) : undefined
    if (localVote) {
      const verdict = localVote.verdict === 'pass' ? mt('mtMineVotedPass') : mt('mtMineVotedFail')
      rows.push({
        key: localVote.pinId,
        nodeId: node.id,
        title: node.title,
        kind: `vote-${localVote.verdict}`,
        status: localVote.counted ? verdict : verdict + mt('mtMineVoteNotCounted', { reason: localVote.ignoreReason ?? '—' }),
      })
    }
    return rows
  })
  const mineOrder: Record<string, number> = { claim: 0, 'sub-live': 1, 'sub-replaced': 1, 'sub-winner': 1, 'sub-verified': 1, 'vote-pass': 2, 'vote-fail': 2 }
  mine.sort((left, right) => (mineOrder[left.kind] ?? 3) - (mineOrder[right.kind] ?? 3))

  const drawerCandidate = drawer
    ? (byPin.get(drawer.pinId) as unknown as DrawerCandidate | undefined) ?? null
    : null
  const drawerNode = drawerCandidate
    ? Object.values(task.nodeStates).find((node) => (node.submissions ?? []).some((cand) => cand.pinId === drawerCandidate.pinId)) ?? null
    : null

  return (
    <div className="oac-mt-detail">
      <div className="oac-mt-detail-head">
        <button type="button" className="oac-mt-back" onClick={onBack}>← {mt('mtBackToBoard')}</button>
        <div className="oac-mt-titleline">
          <span className="oac-mt-title">{task.title}</span>
          <span className={`oac-mt-badge oac-mt-badge-${taskLifecycleOf({ settlementFinalized: Boolean(task.settlement), taskComplete: task.taskComplete })}`}>{lifecycle}</span>
          <span className="oac-mt-chip">{policy.mode === 'competitive' ? mt('mtModeCompetitive') : mt('mtModeTree')}</span>
          {!task.taskComplete && props.metataskDraft && (
            <button type="button" className="oac-mt-btn oac-mt-btn-sm oac-mt-btn-primary oac-mt-head-join"
              onClick={() => { draftFor() }}>
              {mt('mtParticipate')}
            </button>
          )}
        </div>
        <div className="oac-mt-meta">
          <span className="oac-mt-card-pub"><MtBadge metaId={task.publisher} name={identityOf(task.publisher).name} avatar={identityOf(task.publisher).avatar} /></span>
          <span className="oac-mt-sep">·</span>
          <span>{mt('mtProgressVerified', { verified: progress.verified, total: progress.total })}</span>
          {task.lastActivityMs > 0 && (
            <>
              <span className="oac-mt-sep">·</span>
              <span>{mt('mtLastActive', { when: relativeTime(task.lastActivityMs, mt) })}</span>
            </>
          )}
          <span className="oac-mt-sep">·</span>
          <span className="oac-mt-mono">{mt('mtEventCount', { count: task.freshness.eventCount })} @{task.freshness.boundaryBlock}</span>
        </div>
        {task.brief && (
          <p className={`oac-mt-brief ${briefOpen ? '' : 'oac-mt-brief-clamp'}`} onClick={() => { setBriefOpen((value) => !value) }}>
            {task.brief}
          </p>
        )}
      </div>

      {policy.mode === 'competitive' && (
        <div className="oac-mt-sectioncard">
          <Deliverables
            mt={mt}
            task={task}
            identityOf={identityOf}
            byPin={byPin}
            youLabel={youLabel}
            onOpenCandidate={(pinId) => { setDrawer({ pinId }) }}
          />
        </div>
      )}

      {!task.taskComplete && openNodes.length > 0 && (
        <section className="oac-mt-howto">
          <div className="oac-mt-h3">{mt('mtHowToJoin')}</div>
          <p className="oac-mt-dim">
            {policy.mode === 'competitive' ? mt('mtHowToJoinHintCompetitive', { count: openNodes.length }) : mt('mtHowToJoinHintTree', { count: openNodes.length })}
          </p>
          {props.metataskDraft && (
            <div className="oac-mt-openchips">
              {openNodes.slice(0, 8).map((node) => (
                <button key={node.id} type="button" className="oac-mt-openchip" onClick={() => { draftFor(node.id) }}>
                  <code>{node.id}</code> {node.title}
                </button>
              ))}
              {openNodes.length > 8 && <span className="oac-mt-dim">+{openNodes.length - 8}</span>}
            </div>
          )}
        </section>
      )}

      {mine.length > 0 && (
        <section className="oac-mt-mine">
          <div className="oac-mt-h3">{mt('mtMineTitle')}</div>
          <div className="oac-mt-minecard">
            {mine.slice(0, 12).map((row) => (
              <button key={row.key} type="button" className="oac-mt-minerow"
                title={row.title}
                onClick={() => {
                  if (policy.mode === 'tree') {
                    selectNodeFromMap(row.nodeId, groupOfNode(row.nodeId))
                    return
                  }
                  const node = task.nodeStates[row.nodeId]
                  const lead = node?.submission ?? null
                  if (lead) setDrawer({ pinId: lead.pinId })
                }}>
                <i className={`oac-mt-minedot oac-mt-minedot-${row.kind}`} />
                <span className="oac-mt-minenode">{row.nodeId}</span>
                <span className="oac-mt-minetext">{row.title}</span>
                <span className="oac-mt-minestatus">{row.status}</span>
              </button>
            ))}
          </div>
          {mine.length > 12 && <span className="oac-mt-dim">+{mine.length - 12}</span>}
        </section>
      )}
      {mine.length === 0 && rosterIds.size > 0 && (
        <section className="oac-mt-mine oac-mt-sectioncard">
          <div className="oac-mt-h3">{mt('mtMineTitle')}</div>
          <div className="oac-mt-dim">{mt('mtMineEmpty')}</div>
        </section>
      )}

      {policy.mode === 'competitive'
        ? (
          <div className="oac-mt-sectioncard">
            <div className="oac-mt-explainer">
              <b>{mt('mtRulesTitle')}</b>
              <span className="oac-mt-explainer-sep">·</span>
              <span>{mt('mtRulesRace')}</span>
              <span className="oac-mt-explainer-sep">·</span>
              {mt('mtRulesGoldA')}<span className="oac-mt-gold-word">{mt('mtRulesGoldWord')}</span>{mt('mtRulesGoldB')}
              <span className="oac-mt-explainer-sep">·</span>
              {mt('mtRulesRaceA')}<span className="oac-mt-sky-word">{mt('mtRulesRaceWord')}</span>{mt('mtRulesRaceB')}
            </div>
            <div className="oac-mt-statusline">
              <span className="oac-mt-status-item">
                <i className="oac-mt-dot-gold" />
                <b>{mt('mtStatusVerified')}</b>
                <code>{chainText}</code>
                <span className="oac-mt-dim">({chainNodeIds.length}/{Object.keys(task.nodeStates).length})</span>
              </span>
              <span className="oac-mt-status-item">
                <i className="oac-mt-dot-sky" />
                <b>{mt('mtStatusFront')}</b>
                <code className={frontText ? '' : 'oac-mt-dim'}>
                  {frontText ?? (task.taskComplete ? mt('mtStatusSettled') : mt('mtStatusFrontNone'))}
                </code>
              </span>
            </div>
            <ChainView
              mt={mt}
              task={task}
              byPin={byPin}
              winningSet={winningSet}
              race={race}
              identityOf={identityOf}
              rosterIds={rosterIds}
              youLabel={youLabel}
              onOpenCandidate={(pinId) => { setDrawer({ pinId }) }}
            />
          </div>
        )
        : (
          <>
            <div className="oac-mt-sectioncard">
              <div className="oac-mt-rules">{mt('mtRulesTree')}</div>
              <TreeMap
                mt={mt}
                root={rootNode}
                groups={groups}
                topLeaves={topLeaves}
                childrenOf={childrenOf}
                onSelectNode={selectNodeFromMap}
                onToggleGroup={toggleGroup}
              />
            </div>
            <div className="oac-mt-sectioncard">
              <div className="oac-mt-h3">
                {mt('mtNodesTitle')}
                <small>{mt('mtNodesHint')}</small>
              </div>
              <TreeNodeTable
                mt={mt}
                rootNode={rootNode}
                baseChildren={baseChildren}
                childrenOf={childrenOf}
                nodeById={task.nodeStates}
                identityOf={identityOf}
                verifyQuorum={Math.max(1, policy.verifyQuorum)}
                expandedNode={expandedNode}
                expandedGroups={expandedGroups}
                onToggleNode={toggleNode}
                onToggleGroup={toggleGroup}
              />
            </div>
          </>
        )}

      {policy.mode === 'competitive' && (
        <NodeSections
          mt={mt}
          task={task}
          byPin={byPin}
          winningSet={winningSet}
          identityOf={identityOf}
          rosterIds={rosterIds}
          youLabel={youLabel}
          onOpenCandidate={(pinId) => { setDrawer({ pinId }) }}
        />
      )}

      <RosterSettlement mt={mt} task={task} identityOf={identityOf} rosterIds={rosterIds} youLabel={youLabel} />

      {(task.ignoredEvents ?? []).length > 0 && (
        <div className="oac-mt-ignored oac-mt-sectioncard">
          <div className="oac-mt-h3">{mt('mtIgnoredTitle')}</div>
          {task.ignoredEvents.map((entry) => (
            <div key={entry.pinId} className="oac-mt-node-row oac-mt-ignored-row">
              <span className="oac-mt-chip oac-mt-mono">{shortPin(entry.pinId)}</span>
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
          identityOf={identityOf}
          rosterIds={rosterIds}
          youLabel={youLabel}
          winningSet={winningSet}
          onClose={() => { setDrawer(null) }}
          onOpenCandidate={(pinId) => { setDrawer({ pinId }) }}
        />
      )}
    </div>
  )
}
