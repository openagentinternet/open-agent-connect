/**
 * Tree structure overview (tree mode) — IDBots MetaTaskTreeMap port: the root
 * chip on top, one card per aggregate group with a dot grid of its children,
 * and loose dots for leaves hanging directly under the root. Dot color =
 * node status, amber ring = disputed. Clicking a group card toggles it in the
 * node list below; clicking a dot jumps to that node and expands it.
 */
import { type ReactNode } from 'react'
import { treeSubtreeStats, type TreeNodeLike } from '../../metatask-logic.js'

type Mt = (key: string, vars?: Record<string, string | number>) => string

export function TreeMap(props: {
  mt: Mt
  root: TreeNodeLike | undefined
  groups: TreeNodeLike[]
  topLeaves: TreeNodeLike[]
  childrenOf: Map<string, TreeNodeLike[]>
  onSelectNode: (nodeId: string, groupId: string | null) => void
  onToggleGroup: (groupId: string) => void
}): ReactNode {
  const { mt, root, groups, topLeaves, childrenOf, onSelectNode, onToggleGroup } = props
  if (!root) return null
  return (
    <section className="oac-mt-treemap">
      <div className="oac-mt-h3">
        {mt('mtTreeMap')}
        <small>{mt('mtTreeMapHint')}</small>
      </div>
      <div className="oac-mt-treemap-card">
        <div className="oac-mt-treemap-rootrow">
          <button type="button" className="oac-mt-treemap-root" onClick={() => { onSelectNode(root.id, null) }}>
            <i className={`oac-tm-dot ${dotClass(root)}`} />
            <span className="oac-mt-mono">{root.id}</span>
            <span className="oac-mt-treemap-roottitle">{root.title}</span>
          </button>
        </div>
        {(groups.length > 0 || topLeaves.length > 0) && <div className="oac-mt-treemap-stem" />}
        <div className="oac-mt-treemap-groups">
          {groups.map((group) => {
            const stats = treeSubtreeStats(childrenOf, group.id)
            return (
              <div key={group.id} className="oac-mt-treemap-group">
                <button type="button" className="oac-mt-treemap-grouphead" onClick={() => { onToggleGroup(group.id) }}>
                  <span className="oac-mt-treemap-grouprow">
                    <span className="oac-mt-mono oac-mt-treemap-groupid">{group.id}</span>
                    <span className="oac-mt-dim oac-mt-treemap-groupstats">{stats.verified}/{stats.total}</span>
                  </span>
                  <span className="oac-mt-treemap-grouptitle" title={group.title}>{group.title}</span>
                </button>
                <div className="oac-mt-treemap-dots">
                  {(childrenOf.get(group.id) ?? []).map((child) => (
                    <button key={child.id} type="button" title={`${child.id} · ${child.title}`}
                      className={`oac-tm-dot oac-tm-dot-sm ${dotClass(child)}`}
                      onClick={() => { onSelectNode(child.id, group.id) }} />
                  ))}
                </div>
              </div>
            )
          })}
          {topLeaves.length > 0 && (
            <div className="oac-mt-treemap-group oac-mt-treemap-leaves">
              <div className="oac-mt-treemap-dots oac-mt-treemap-dots-wide">
                {topLeaves.map((leaf) => (
                  <button key={leaf.id} type="button" title={`${leaf.id} · ${leaf.title}`}
                    className={`oac-tm-dot oac-tm-dot-sm ${dotClass(leaf)}`}
                    onClick={() => { onSelectNode(leaf.id, null) }} />
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="oac-mt-treemap-legend">
          <span><i className="oac-tm-dot oac-tm-dot-open" />{mt('mtStatusOpen')}</span>
          <span><i className="oac-tm-dot oac-tm-dot-claimed" />{mt('mtStatusClaimed')}</span>
          <span><i className="oac-tm-dot oac-tm-dot-verified" />{mt('mtStatusVerified')}</span>
          <span><i className="oac-tm-dot oac-tm-dot-open oac-tm-dot-disputed" />{mt('mtDisputed')}</span>
        </div>
      </div>
    </section>
  )
}

const dotClass = (node: TreeNodeLike): string => {
  const tone = node.status === 'verified'
    ? 'oac-tm-dot-verified'
    : node.status === 'claimed'
      ? 'oac-tm-dot-claimed'
      : 'oac-tm-dot-open'
  return node.disputed ? `${tone} oac-tm-dot-disputed` : tone
}
