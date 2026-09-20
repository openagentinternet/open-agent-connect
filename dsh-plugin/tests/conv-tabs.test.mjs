import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const plugin = await import('../lib/index.js')

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
  }
}

test('isConvTab accepts exactly the three tabs', () => {
  assert.equal(plugin.isConvTab?.('local'), true)
  assert.equal(plugin.isConvTab?.('online'), true)
  assert.equal(plugin.isConvTab?.('group'), true)
  assert.equal(plugin.isConvTab?.('Local'), false)
  assert.equal(plugin.isConvTab?.('a2a'), false)
  assert.equal(plugin.isConvTab?.(null), false)
  assert.equal(plugin.isConvTab?.(undefined), false)
})

test('parseGroupTaskKey reads <chair>:<taskId> and rejects everything else', () => {
  assert.deepEqual(plugin.parseGroupTaskKey?.('bob:12'), { chair: 'bob', taskId: 12 })
  assert.deepEqual(plugin.parseGroupTaskKey?.('twin-bot:104'), { chair: 'twin-bot', taskId: 104 })
  assert.equal(plugin.parseGroupTaskKey?.('bob'), null)
  assert.equal(plugin.parseGroupTaskKey?.('bob:'), null)
  assert.equal(plugin.parseGroupTaskKey?.(':12'), null)
  assert.equal(plugin.parseGroupTaskKey?.('bob:zero'), null)
  assert.equal(plugin.parseGroupTaskKey?.('bob:0'), null)
  assert.equal(plugin.parseGroupTaskKey?.('bob:-3'), null)
  assert.equal(plugin.parseGroupTaskKey?.(''), null)
})

test('the conversation tabs mount anchors on the slot renderer wrapper and fails safe', async () => {
  const mount = await readFile(join(root, 'src/client/conv-tab-mount.ts'), 'utf8')
  // The anchor is the slot machinery's own data-slot attribute (stable across
  // themes/builds, not hashed CSS) — never a structural climb or class name.
  assert.match(mount, /\[data-slot="sidebar\.workspaces"\]/)
  // The official region is hidden by one namespaced html class, never
  // unmounted or re-hosted.
  assert.match(mount, /CONV_TABS_ACTIVE_CLASS/)
  // Fail-safe paths: missing anchor releases the host and drops the class;
  // a component crash releases through the ErrorBoundary; the rail state
  // resets the tab to local so the official rail icons can show.
  assert.match(mount, /if \(host !== null\) release\(\)/)
  assert.match(mount, /classList\.remove\(CONV_TABS_ACTIVE_CLASS\)/)
  assert.match(mount, /ConvTabsBoundary/)
  assert.match(mount, /store\.setTab\('local'\)/)
  // Duplicate-proof: orphaned hosts are swept before every attach.
  assert.match(mount, /querySelectorAll\(`\[\$\{CONV_TAB_HOST_MARK\}\]`\)/)
  assert.match(mount, /stray\.remove\(\)/)
  // The host never goes display:none (a zero-width box could never un-rail);
  // it collapses to height 0 + hidden so its width keeps tracking.
  assert.match(mount, /height = rail \? '0px' : ''/)
  assert.doesNotMatch(mount, /display = 'none'/)
})

test('the tab strip renders three tabs and hides the official region only via the html class', async () => {
  const css = await readFile(join(root, 'src/client/styles.ts'), 'utf8')
  assert.match(css, /html\.oac-conv-tabs-active \[data-slot="sidebar\.workspaces"\] \{ display: none/)
  const component = await readFile(join(root, 'src/client/ConvTabs.tsx'), 'utf8')
  // Rows navigate (open the A2A overlay on the target) — they never render
  // threads in the sidebar column.
  assert.match(component, /openPrivate\(from, row\.peerGlobalMetaId\)/)
  assert.match(component, /openGroupTask\(key\)/)
  assert.match(component, /prefetchAvatars/)
  assert.match(component, /resolveAvatarUrl/)
})

test('the A2A panel store carries a one-shot navigation target', async () => {
  const store = await readFile(join(root, 'src/client/a2a-panel-store.ts'), 'utf8')
  assert.match(store, /openOn\(target: A2APanelTarget\)/)
  assert.match(store, /consumeTarget\(\)/)
  // close() drops an unconsumed target so a stale one never re-applies later.
  assert.match(store, /open \|\| this\.inner\.getSnapshot\(\)\.target !== null/)
  // Round 2: collab navigation + the create-task form of the grouptask target.
  assert.match(store, /\| \{ mode: 'collab'; slug: string; groupId: string \}/)
})

test('the A2A panel is a pure reading pane (no header, no mode tabs, no list)', async () => {
  const panel = await readFile(join(root, 'src/client/A2AConversation.tsx'), 'utf8')
  assert.doesNotMatch(panel, /oac-a2a-header/)
  assert.doesNotMatch(panel, /oac-gt-mode-tabs/)
  assert.doesNotMatch(panel, /oac-a2a-list/)
  assert.doesNotMatch(panel, /ConversationRowMenu/)
  // Detail-only group view + collab/crate targets flow through the signals.
  assert.match(panel, /hideList/)
  assert.match(panel, /openCollabSignal=\{gtCollab\}/)
  assert.match(panel, /setGtCreateSignal\(\(value\) => value \+ 1\)/)
  // Nothing auto-selects: with the lists on the left, selection arrives only
  // by navigation (the empty hint shows otherwise).
  assert.match(panel, /pickOnlineLeft/)
  assert.doesNotMatch(panel, /rows\[0\]\?\.peerGlobalMetaId \?\? ''/)
})

test('GroupTaskView hides its list and shows the pick-left hint in detail-only mode', async () => {
  const view = await readFile(join(root, 'src/client/GroupTaskView.tsx'), 'utf8')
  assert.match(view, /hideList\?: boolean/)
  assert.match(view, /if \(hideList === true\) return null/)
  assert.match(view, /pickTaskLeft/)
  assert.match(view, /openCollabSignal\?: \{ slug: string; groupId: string; seq: number \} \| null/)
})

test('the left lists carry the row menus, staffing slate, collabs, and the create button', async () => {
  const tabs = await readFile(join(root, 'src/client/ConvTabs.tsx'), 'utf8')
  // IDBots hover menu on both lists (rename/pin/archive ride it).
  assert.match(tabs, /ConversationRowMenu/)
  assert.match(tabs, /grouptask\.rename\(/)
  assert.match(tabs, /grouptask\.archive\(/)
  // Group archive asks first (IDBots parity).
  assert.match(tabs, /gtArchiveConfirmTitle/)
  // The 群任务 tab owns the health note, staffing slate, collabs, and +.
  assert.match(tabs, /gtHealthNoChair/)
  assert.match(tabs, /staffingDecide/)
  assert.match(tabs, /openCollab\(collab\.slug, collab\.groupId\)/)
  assert.match(tabs, /openGroupTask\(''\)/)
  // Private row menus keep the UI-meta verbs the panel used to carry.
  assert.match(tabs, /meta\(from, peer, patch\)|applyConversationMeta/)
})

test('the mounted lists keep locale coverage in both dictionaries', async () => {
  const locale = await readFile(join(root, 'src/client/locale-conversations.ts'), 'utf8')
  for (const key of ['convTabStripLabel', 'convTabLocal', 'convTabOnline', 'convTabGroup', 'pickOnlineLeft', 'pickTaskLeft']) {
    const occurrences = locale.split(`${key}:`).length - 1
    assert.equal(occurrences, 2, `${key} must exist in both en and zh dictionaries`)
  }
})
