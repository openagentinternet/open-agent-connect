/**
 * Tree-mode branch node table — IDBots MetaTaskDetail NodeRow/NodeExpanded
 * port: every node is a collapsed row; a row with children carries a group
 * collapse toggle, and clicking the row expands the branch's definition
 * (kind / spec / params JSON), the effective submission (submitter identity,
 * result payload, hash, attachment) and the review votes. Rows carry
 * `id="oac-mt-node-<id>"` so the TreeMap dots and the mine feed can scroll to
 * and expand them. Renderer-only: all state comes from the projection.
 */
import { type ReactNode } from 'react'
import { treeSubtreeStats, type TreeNodeLike } from '../../metatask-logic.js'
import { MtBadge } from './MtBadge.tsx'
import type { IdentityOf } from './ChainView.tsx'
import type { TaskNodeState } from './MetataskDetail.tsx'

type Mt = (key: string, vars?: Record<string, string | number>) => string

const prettyJson = (value: unknown): string => JSON.stringify(value, null, 2)

export function TreeNodeTable(props: {
  mt: Mt
  rootNode: TaskNodeState | undefined
  baseChildren: TaskNodeState[]
  childrenOf: Map<string, TreeNodeLike[]>
  nodeById: Record<string, TaskNodeState>
  identityOf: IdentityOf
  verifyQuorum: number
  expandedNode: string | null
  expandedGroups: Set<string>
  onToggleNode: (nodeId: string) => void
  onToggleGroup: (groupId: string) => void
}): ReactNode {
  const {
    mt, rootNode, baseChildren, childrenOf, nodeById, identityOf,
    verifyQuorum, expandedNode, expandedGroups, onToggleNode, onToggleGroup,
  } = props

  const nodeChildrenOf = (id: string): TaskNodeState[] =>
    (childrenOf.get(id) ?? [])
      .map((child) => nodeById[child.id])
      .filter((child): child is TaskNodeState => Boolean(child))

  const statusLabel = (status: string): string => {
    const key = `mtStatus_${status}`
    const label = mt(key)
    return label === key ? status : label
  }

  const renderVotes = (node: TaskNodeState): ReactNode => {
    if (node.votes.length === 0) return null
    return (
      <div>
        <div className="oac-mt-treeblock-title">{mt('mtNodeVotes')}</div>
        <div className="oac-mt-treevotes">
          {node.votes.map((vote) => (
            <div key={vote.pinId} className="oac-mt-treevote">
              <MtBadge metaId={vote.voter} name={identityOf(vote.voter).name} avatar={identityOf(vote.voter).avatar} />
              <span className={`oac-mt-badge oac-mt-badge-verdict-${vote.verdict}`}>{vote.verdict}</span>
              {!vote.counted && (
                <span className="oac-mt-dim">{mt('mtNotCounted', { reason: vote.ignoreReason ?? '—' })}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  const renderExpanded = (node: TaskNodeState): ReactNode => {
    const submission = node.submission
    return (
      <div className="oac-mt-treeexpanded">
        <div>
          <div className="oac-mt-treeblock-title">{mt('mtNodeTaskDef')}</div>
          <div className="oac-mt-treedef">
            <span className="oac-mt-mono">{node.kind}</span>
            {node.specid && <span className="oac-mt-treespec">spec: <span className="oac-mt-mono">{node.specid}</span></span>}
          </div>
          {node.params && Object.keys(node.params).length > 0 && (
            <pre className="oac-mt-treepre">{prettyJson(node.params)}</pre>
          )}
        </div>
        {submission ? (
          <div>
            <div className="oac-mt-treeblock-title">
              {mt('mtNodeSubmissionBy')}
              <MtBadge metaId={submission.submitter} name={identityOf(submission.submitter).name} avatar={identityOf(submission.submitter).avatar} />
              <span className="oac-mt-mono oac-mt-dim" title={submission.pinId}>{submission.pinId.slice(0, 18)}…</span>
            </div>
            {submission.result && (
              <pre className="oac-mt-treepre">{prettyJson(submission.result)}</pre>
            )}
            <div className="oac-mt-treemeta">
              {submission.hash && (
                <span className="oac-mt-mono" title={submission.hash}>hash {submission.hash.slice(0, 24)}…</span>
              )}
              {submission.attachment && (
                <span className="oac-mt-mono" title={submission.attachment}>attachment {submission.attachment.slice(0, 48)}</span>
              )}
            </div>
          </div>
        ) : (
          <div className="oac-mt-dim">{mt('mtNodeNoSubmissionYet')}</div>
        )}
        {renderVotes(node)}
      </div>
    )
  }

  const renderRow = (node: TaskNodeState, depth: number): ReactNode => {
    const children = nodeChildrenOf(node.id)
    const isGroup = children.length > 0
    const collapsed = !expandedGroups.has(node.id)
    return (
      <div key={node.id}>
        <div id={`oac-mt-node-${node.id}`} className="oac-mt-treerow">
          {isGroup && (
            <button type="button" className="oac-mt-treechevron" title={mt('mtGroupToggleTip')}
              onClick={() => { onToggleGroup(node.id) }}>
              {collapsed ? '▸' : '▾'}
            </button>
          )}
          <button type="button" className="oac-mt-treerow-main" title={mt('mtNodeExpandTip')}
            onClick={() => { onToggleNode(node.id) }}>
            <span className="oac-mt-treerow-lead">
              <span className="oac-mt-mono oac-mt-treerow-id">{node.id}</span>
              <span className="oac-mt-treerow-title" title={node.title}>{node.title}</span>
              {node.weight !== null && (
                <span className="oac-mt-dim oac-mt-treerow-weight">{(node.weight / 100).toFixed(2)}%</span>
              )}
              {isGroup && (() => {
                const stats = treeSubtreeStats(childrenOf, node.id)
                return stats.total > 0
                  ? <span className="oac-mt-dim oac-mt-treerow-weight">{stats.verified}/{stats.total}</span>
                  : null
              })()}
            </span>
            <span className={`oac-mt-nodestatus oac-mt-nodestatus-${node.status}`}>
              {statusLabel(node.status)}{node.disputed ? ` · ${mt('mtDisputed')}` : ''}
            </span>
            {node.holder && (
              <span className="oac-mt-treerow-holder">
                <MtBadge metaId={node.holder.claimant} name={identityOf(node.holder.claimant).name} avatar={identityOf(node.holder.claimant).avatar} />
              </span>
            )}
            <span className="oac-mt-dim oac-mt-treerow-votes">
              {node.passVotes}/{verifyQuorum}{node.failVotes > 0 ? ` ·${node.failVotes}✗` : ''}
            </span>
            <span className="oac-mt-treechevron oac-mt-treechevron-dim">{expandedNode === node.id ? '▾' : '▸'}</span>
          </button>
        </div>
        {expandedNode === node.id && renderExpanded(node)}
        {isGroup && !collapsed && (
          <div className="oac-mt-treechildren">
            {children.map((child) => renderRow(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="oac-mt-treetable">
      {rootNode && (
        <div>
          {renderRow(rootNode, 0)}
        </div>
      )}
      {baseChildren.map((node) => renderRow(node, 0))}
    </div>
  )
}
