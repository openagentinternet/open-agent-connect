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
})

test('the A2A panel store carries a one-shot navigation target', async () => {
  const store = await readFile(join(root, 'src/client/a2a-panel-store.ts'), 'utf8')
  assert.match(store, /openOn\(target: A2APanelTarget\)/)
  assert.match(store, /consumeTarget\(\)/)
  // close() drops an unconsumed target so a stale one never re-applies later.
  assert.match(store, /open \|\| this\.inner\.getSnapshot\(\)\.target !== null/)
})

test('the mounted lists keep locale coverage in both dictionaries', async () => {
  const locale = await readFile(join(root, 'src/client/locale-conversations.ts'), 'utf8')
  for (const key of ['convTabStripLabel', 'convTabLocal', 'convTabOnline', 'convTabGroup']) {
    const occurrences = locale.split(`${key}:`).length - 1
    assert.equal(occurrences, 2, `${key} must exist in both en and zh dictionaries`)
  }
})
