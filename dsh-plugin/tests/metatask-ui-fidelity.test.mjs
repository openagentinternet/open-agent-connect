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

test('participate draft route reaches the CLI bridge (metatask/draft)', async () => {
  const routes = await read('src/metatask-routes.ts')
  assert.match(routes, /metatask\/draft/)
  assert.match(routes, /metatask', 'draft', '--root'/)
})
