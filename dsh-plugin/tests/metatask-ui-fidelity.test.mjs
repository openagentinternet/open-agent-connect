import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFile(join(root, rel), 'utf8')

function objectKeys(block) {
  return [...block.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1])
}

test('locale.ts en/zh mt* keys stay in sync', async () => {
  const text = await read('src/client/locale.ts')
  const en = text.slice(text.indexOf('export const en = {'), text.indexOf('export const zh = {'))
  const zh = text.slice(text.indexOf('export const zh = {'), text.indexOf('export type BotsLocaleKey'))
  const enKeys = objectKeys(en).filter((key) => key.startsWith('mt'))
  const zhKeys = objectKeys(zh).filter((key) => key.startsWith('mt'))
  assert.deepEqual(zhKeys.sort(), enKeys.sort())
  // Fidelity-critical copy present in both languages.
  for (const key of ['mtYou', 'mtChainTitle', 'mtStepWinner', 'mtStepLeading', 'mtStatusVerified', 'mtStatusFront', 'mtStatusSettled', 'mtRulesGoldWord', 'mtRulesRaceWord', 'mtLegendRace', 'mtHowToJoin', 'mtMineTitle', 'mtShareEst', 'mtShareSettled', 'mtNodeRubricTitle']) {
    assert.ok(enKeys.includes(key), `en missing ${key}`)
  }
})

test('MetaTask components render identity badges (avatars + names) via MtBadge', async () => {
  const chain = await read('src/client/metatask/ChainView.tsx')
  assert.match(chain, /import \{ MtBadge \}/)
  assert.match(chain, /<MtBadge/)
  assert.match(chain, /oac-mt-stepchip/)           // per-node step header chip
  assert.match(chain, /mtStepWinner|mtStepLeading/) // status words
  const drawer = await read('src/client/metatask/CandidateDrawer.tsx')
  assert.match(drawer, /MtBadge/)
  assert.doesNotMatch(drawer, /submitter\.slice\(/)
  const nodes = await read('src/client/metatask/NodeSections.tsx')
  assert.match(nodes, /MtBadge/)
  const roster = await read('src/client/metatask/RosterSettlement.tsx')
  assert.match(roster, /MtBadge/)
  const deliverables = await read('src/client/metatask/Deliverables.tsx')
  assert.match(deliverables, /MtBadge/)
  const board = await read('src/client/metatask/MetataskBoard.tsx')
  assert.match(board, /MtBadge/)
  assert.match(board, /localRosterMetaIds/)
  assert.match(board, /oac-mt-btn-primary/)
  const detail = await read('src/client/metatask/MetataskDetail.tsx')
  assert.match(detail, /oac-mt-statusline/)
  assert.match(detail, /oac-mt-explainer/)
  assert.match(detail, /mtHowToJoin/)
})

test('MtBadge resolves avatars through the daemon proxy with an initial-disc fallback', async () => {
  const badge = await read('src/client/metatask/MtBadge.tsx')
  assert.match(badge, /resolveAvatarUrl/)
  assert.match(badge, /oac-mt-badge-initial/)
  assert.match(badge, /oac-mt-you/)
})

test('TRACKING_CSS carries the fidelity layer (width lift, step header, state tags, flow edges)', async () => {
  const styles = await read('src/client/styles.ts')
  assert.match(styles, /:has\(\.oac-track-shell\)/)
  assert.match(styles, /oac-mt-stepchip/)
  assert.match(styles, /oac-tag-solid-gold/)
  assert.match(styles, /oac-tag-cand-rejected/)
  assert.match(styles, /oac-mt-flow/)
  assert.match(styles, /oac-mt-badge-avatar/)
  assert.match(styles, /oac-mt-btn-primary/)
  assert.match(styles, /prefers-reduced-motion/)
})

test('board cards carry a visible border + radius + hover (IDBots card parity)', async () => {
  const styles = await read('src/client/styles.ts')
  assert.match(styles, /\.oac-mt-card \{[^}]*border: 1px solid/)
  assert.match(styles, /\.oac-mt-card \{[^}]*border-radius: 12px/)
  assert.match(styles, /\.oac-mt-card:hover/)
})

test('detail root is the drawer positioning context; the drawer body is the right-side panel', async () => {
  const styles = await read('src/client/styles.ts')
  assert.match(styles, /\.oac-mt-detail \{[^}]*position: relative/)
  assert.match(styles, /\.oac-mt-detail \.oac-gt-drawer \{[^}]*inset: 0/)
  assert.match(styles, /\.oac-mt-detail \.oac-gt-drawer-body \{[^}]*margin-left: auto/)
  assert.match(styles, /\.oac-mt-detail \.oac-gt-drawer-body \{[^}]*width: min\(460px, 94%\)/)
  assert.match(styles, /oac-mt-drawer-in/)
  // No gray dimming over the page; the veil is a transparent click-catcher
  // and the panel itself is opaque (real DSH surface token).
  assert.match(styles, /\.oac-mt-detail \.oac-gt-drawer-veil \{[^}]*background: transparent/)
  assert.match(styles, /\.oac-mt-detail \.oac-gt-drawer-body \{[^}]*background: var\(--dsw-alias-bg-layer-1\)/)
})

test('TRACKING_CSS uses real DSH theme tokens (no dead --dsw-alias variables)', async () => {
  const styles = await read('src/client/styles.ts')
  const tracking = styles.slice(styles.indexOf('export const TRACKING_CSS'))
  for (const dead of ['--dsw-alias-fill-card', '--dsw-alias-line-border-card', '--dsw-alias-brand-standard', '--dsw-alias-fill-secondary', '--dsw-alias-fill-prompt']) {
    assert.ok(!tracking.includes(dead), `TRACKING_CSS still uses dead token ${dead}`)
  }
})

test('detail blocks are carded; roster/settlement render as full-width styled tables', async () => {
  const styles = await read('src/client/styles.ts')
  assert.match(styles, /oac-mt-sectioncard/)
  assert.match(styles, /oac-mt-tablewrap/)
  assert.match(styles, /\.oac-mt-table \{ width: 100%/)
  assert.match(styles, /oac-mt-minecard/)
  assert.match(styles, /oac-mt-pending/)
})

test('chain view re-glues edges on horizontal scroll and sizes the SVG to the content box', async () => {
  const chain = await read('src/client/metatask/ChainView.tsx')
  assert.match(chain, /addEventListener\('scroll', redraw/)
  assert.match(chain, /scrollWidth/)
  assert.match(chain, /scrollHeight/)
  // IDBots geometry: the SVG is a child of the w-max columns canvas, so the
  // overlay scrolls literally with the cards and cannot drift.
  assert.match(chain, /className="oac-mt-columns" ref=\{canvasRef\}/)
  const columnsOpen = chain.indexOf('className="oac-mt-columns"')
  const svgOpen = chain.indexOf('className="oac-mt-edges"')
  assert.ok(svgOpen > columnsOpen, 'svg must render INSIDE the columns canvas')
})

test('detail header: back button on its own row, IDBots meta line', async () => {
  const styles = await read('src/client/styles.ts')
  assert.match(styles, /\.oac-mt-detail-head \{[^}]*flex-direction: column/)
  assert.match(styles, /oac-mt-back/)
  assert.match(styles, /oac-mt-meta/)
  const detail = await read('src/client/metatask/MetataskDetail.tsx')
  assert.match(detail, /className="oac-mt-back"/)
  assert.match(detail, /className="oac-mt-meta"/)
  assert.match(detail, /mtProgressVerified/)
})

test('node sections: collapsible per-node cards (IDBots structure, no outer wrapper)', async () => {
  const nodes = await read('src/client/metatask/NodeSections.tsx')
  assert.match(nodes, /oac-mt-nodesection-head/)
  assert.match(nodes, /oac-mt-chevron/)
  assert.match(nodes, /useState<Set<string>>/)
  const styles = await read('src/client/styles.ts')
  assert.match(styles, /oac-mt-headtag-winner/)
  assert.match(styles, /oac-mt-node-cand-gold/)
  const detail = await read('src/client/metatask/MetataskDetail.tsx')
  assert.doesNotMatch(detail, /<div className="oac-mt-sectioncard">\s*<NodeSections/)
})

test('daemon serves merged identities: task/board handlers stamp the freshest store identities', async () => {
  const handlers = await read('../src/daemon/metataskHandlers.ts')
  assert.match(handlers, /withFreshIdentities/)
  assert.match(handlers, /ensureBoardIdentities/)
  const store = await read('../src/core/metatask/store.ts')
  assert.match(store, /withFreshIdentities\(projection/)
  assert.match(store, /ensureIdentities\(metaIds/)
})

test('candidate drawer renders the IDBots detail-v2 sections (facts, review votes, receipts)', async () => {
  const drawer = await read('src/client/metatask/CandidateDrawer.tsx')
  assert.match(drawer, /oac-mt-factrow/)
  assert.match(drawer, /mtReviewsTitle/)
  assert.match(drawer, /mtFailreasonLabel/)
  assert.match(drawer, /mtSemanticLabel/)
  assert.match(drawer, /mtReceipts/)
  assert.match(drawer, /mtSubLine/)
  assert.match(drawer, /mtParentrefsNone/)
})

test('tree-mode detail ports the IDBots structure map and expandable branch node table', async () => {
  const logic = await read('src/metask-logic.ts').catch(() => null) ?? await read('src/metatask-logic.ts')
  assert.match(logic, /treeChildrenOf/)
  assert.match(logic, /treeSubtreeStats/)
  assert.match(logic, /treeSubtreeHasAttention/)
  const treeMap = await read('src/client/metatask/TreeMap.tsx')
  assert.match(treeMap, /oac-mt-treemap-root/)
  assert.match(treeMap, /oac-mt-treemap-group/)
  assert.match(treeMap, /oac-tm-dot-verified/)
  assert.match(treeMap, /oac-mt-treemap-legend/)
  const table = await read('src/client/metatask/TreeNodeTable.tsx')
  assert.match(table, /oac-mt-node-\$\{node\.id\}/)
  assert.match(table, /mtNodeTaskDef/)
  assert.match(table, /mtNodeSubmissionBy/)
  assert.match(table, /mtNodeVotes/)
  assert.match(table, /oac-mt-nodestatus-\$\{node\.status\}/)
  const detail = await read('src/client/metatask/MetataskDetail.tsx')
  assert.match(detail, /<TreeMap/)
  assert.match(detail, /<TreeNodeTable/)
  assert.match(detail, /selectNodeFromMap/)
  const styles = await read('src/client/styles.ts')
  assert.match(styles, /oac-mt-treemap-card/)
  assert.match(styles, /oac-mt-treetable/)
  assert.match(styles, /oac-mt-treeexpanded/)
})

test('participate draft route reaches the CLI bridge (metatask/draft)', async () => {
  const routes = await read('src/metatask-routes.ts')
  assert.match(routes, /metatask\/draft/)
  assert.match(routes, /metatask', 'draft', '--root'/)
})
