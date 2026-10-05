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
