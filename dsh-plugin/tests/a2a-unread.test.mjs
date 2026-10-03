import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const plugin = await import('../lib/index.js')

test('diffGroupTasks reports moved and new tasks, drops vanished ones', () => {
  const { next, updates } = plugin.diffGroupTasks(
    { 'bob:1': 100, 'bob:2': 200, 'gone:9': 50 },
    [
      { chairSlug: 'bob', id: 1, updatedAt: 100 },
      { chairSlug: 'bob', id: 2, updatedAt: 250 },
      { chairSlug: 'amy', id: 7, updatedAt: 10 },
    ],
  )
  assert.deepEqual(next, { 'bob:1': 100, 'bob:2': 250, 'amy:7': 10 })
  assert.deepEqual(updates, [
    { key: 'bob:2', updatedAt: 250 },
    { key: 'amy:7', updatedAt: 10 },
  ])
})

test('diffGroupTasks skips rows without a finite updatedAt', () => {
  const { next, updates } = plugin.diffGroupTasks({}, [
    { chairSlug: 'bob', id: 1, updatedAt: Number.NaN },
    { chairSlug: 'bob', id: 2, updatedAt: 5 },
  ])
  assert.deepEqual(next, { 'bob:2': 5 })
  assert.deepEqual(updates, [{ key: 'bob:2', updatedAt: 5 }])
})

test('applyGroupUpdate marks first sight (the host prime keeps connect quiet)', () => {
  const state = plugin.applyGroupUpdate(plugin.EMPTY_UNREAD, { key: 'bob:1', updatedAt: 500 }, false)
  assert.deepEqual(state.group, { 'bob:1': 500 })
  assert.deepEqual(state.groupSeen, { 'bob:1': 500 })
})

test('applyGroupUpdate marks newer updates and stays read while viewing', () => {
  let state = plugin.applyGroupUpdate(plugin.EMPTY_UNREAD, { key: 'bob:1', updatedAt: 500 }, false)
  state = plugin.applyGroupUpdate(state, { key: 'bob:1', updatedAt: 600 }, false)
  assert.deepEqual(state.group, { 'bob:1': 600 })
  state = plugin.applyGroupUpdate(state, { key: 'bob:1', updatedAt: 700 }, true)
  assert.deepEqual(state.group, {})
  assert.deepEqual(state.groupSeen, { 'bob:1': 700 })
})

test('applyGroupUpdate ignores stale repeats', () => {
  let state = plugin.applyGroupUpdate(plugin.EMPTY_UNREAD, { key: 'bob:1', updatedAt: 500 }, false)
  state = plugin.applyGroupUpdate(state, { key: 'bob:1', updatedAt: 400 }, false)
  assert.deepEqual(state.group, { 'bob:1': 500 })
  assert.deepEqual(state.groupSeen, { 'bob:1': 500 })
})

test('privateRowStatus: seed, change, current', () => {
  let state = plugin.EMPTY_UNREAD
  assert.equal(plugin.privateRowStatus(state, 'bob:p', 10), 'seeded')
  state = plugin.seedPrivateSeen(state, 'bob:p', 10)
  assert.equal(plugin.privateRowStatus(state, 'bob:p', 10), 'current')
  assert.equal(plugin.privateRowStatus(state, 'bob:p', 11), 'changed')
  assert.equal(plugin.privateRowStatus(state, 'bob:p', 9), 'current')
  assert.equal(plugin.privateRowStatus(state, 'bob:p', Number.NaN), 'current')
})

test('applyPrivateLatest: inbound marks, local-only never lights a badge', () => {
  let state = plugin.EMPTY_UNREAD
  state = plugin.seedPrivateSeen(state, 'bob:p', 10)
  state = plugin.applyPrivateLatest(state, 'bob:p', 20, false)
  assert.deepEqual(state.private, { 'bob:p': 20 })
  state = plugin.applyPrivateLatest(state, 'bob:p', 30, true)
  assert.deepEqual(state.private, {})
  assert.deepEqual(state.privateSeen, { 'bob:p': 30 })
})

test('hasAnyUnread drives the entry dot', () => {
  assert.equal(plugin.hasAnyUnread(plugin.EMPTY_UNREAD), false)
  assert.equal(plugin.hasAnyUnread({ ...plugin.EMPTY_UNREAD, private: { 'bob:p': 1 } }), true)
  assert.equal(plugin.hasAnyUnread({ ...plugin.EMPTY_UNREAD, group: { 'bob:1': 1 } }), true)
})

test('clearGroupMark/clearPrivateMark clear the mark without mutating a frozen snapshot', () => {
  // dsh-client-store deep-freezes every snapshot, so the clear path must copy
  // every map it writes — an in-place *Seen assignment threw
  // "Cannot assign to read only property '<chair>:<taskId>'" and crashed the
  // panel render for any task carrying an unread mark.
  const state = Object.freeze({
    private: Object.freeze({ 'bob:p1': 20 }),
    group: Object.freeze({ 'bob:302': 500 }),
    privateSeen: Object.freeze({ 'bob:p1': 10 }),
    groupSeen: Object.freeze({ 'bob:302': 400 }),
  })
  const afterGroup = plugin.clearGroupMark(state, 'bob:302')
  assert.deepEqual(afterGroup.group, {})
  assert.deepEqual(afterGroup.groupSeen, { 'bob:302': 500 })
  const afterPrivate = plugin.clearPrivateMark(state, 'bob:p1')
  assert.deepEqual(afterPrivate.private, {})
  assert.deepEqual(afterPrivate.privateSeen, { 'bob:p1': 20 })
  assert.deepEqual(state.group, { 'bob:302': 500 }, 'input snapshot untouched')
  assert.deepEqual(state.private, { 'bob:p1': 20 }, 'input snapshot untouched')
  assert.equal(plugin.clearGroupMark(state, 'bob:999'), null)
  assert.equal(plugin.clearPrivateMark(state, 'bob:none'), null)
})

test('client clear paths delegate to the pure mark-clearing helpers', async () => {
  const feed = await readFile(join(root, 'src/client/a2a-unread-store.ts'), 'utf8')
  assert.match(feed, /clearPrivateMark/)
  assert.match(feed, /clearGroupMark/)
  assert.doesNotMatch(feed, /\.groupSeen\[key\] =/)
  assert.doesNotMatch(feed, /\.privateSeen\[key\] =/)
})

test('chat watcher is push-only: no polling loop, store paths filtered by pattern', async () => {
  const watcher = await readFile(join(root, 'src/chat-watcher.ts'), 'utf8')
  assert.match(watcher, /watch\(/)
  assert.match(watcher, /private-conversations-changed/)
  assert.match(watcher, /group-task-update/)
  assert.ok(watcher.includes('\\.runtime\\/a2a\\/chat-'), 'a2a store path filter present')
  assert.ok(watcher.includes('\\.runtime\\/grouptask\\/'), 'grouptask store path filter present')
  // The non-recursive fallback must watch the store dirs under their real
  // on-disk names (the core's a2aRoot is the uppercase A2A).
  assert.ok(watcher.includes("'.runtime/A2A'"), 'fallback watches the uppercase a2a store dir')
  // The watcher must resolve the profiles root through the core layout:
  // normalizeSystemHomeDir returns the SYSTEM home — joining 'profiles' onto
  // it watches a directory that does not exist (round-1 live bug).
  assert.match(watcher, /localProfilesRoot\(\)/)
  assert.doesNotMatch(watcher, /join\(home, 'profiles'\)/)
  // The group baseline primes at stream start so connect marks nothing.
  assert.match(watcher, /groupPrimed/)
  // The 2026-09-07 polling badge must stay dead.
  assert.doesNotMatch(watcher, /setInterval\(\s*\(\)\s*=>\s*\{\s*void poll/)
})

test('watch filters classify the real on-disk store paths (uppercase core a2aRoot)', () => {
  // The core writes private conversations to <slug>/.runtime/A2A/chat-*.json
  // (state/paths.ts a2aRoot, uppercase since the first store commit). A
  // case-pinned lowercase filter dropped every private store event, so the
  // 线上对话 tab badge never lit while 群任务 (lowercase grouptask dir) did.
  assert.equal(plugin.PRIVATE_FILE.exec('bob/.runtime/A2A/chat-id1-id2.json')?.[1], 'bob')
  assert.ok(plugin.PRIVATE_FILE.test('bob/.runtime/a2a/chat-id1-id2.json'), 'lowercase variant still matches')
  assert.ok(!plugin.PRIVATE_FILE.test('bob/.runtime/A2A/other.json'), 'non-chat files stay out')
  assert.ok(!plugin.PRIVATE_FILE.test('bob/.runtime/A2A/chat-id1-id2.json.bak'), 'suffix variants stay out')
  assert.ok(plugin.GROUP_FILE.test('bob/.runtime/grouptask/state.json'))
  assert.ok(!plugin.GROUP_FILE.test('bob/.runtime/grouptasks/state.json'), 'similar dirs stay out')
})

test('localProfilesRoot resolves through resolveMetabotManagerLayout, never a bare home join', async () => {
  const localRead = await readFile(join(root, 'src/local-read.ts'), 'utf8')
  assert.match(localRead, /resolveMetabotManagerLayout/)
  assert.match(localRead, /profilesRoot/)
  assert.doesNotMatch(localRead, /join\(.*'profiles'\)/)
})

test('client rides one all-events stream at apply scope; the polling badge flag is gone', async () => {
  const feed = await readFile(join(root, 'src/client/a2a-unread-store.ts'), 'utf8')
  assert.match(feed, /\/oac\/api\/chat\/events\/all/)
  assert.match(feed, /private-conversations-changed/)
  assert.match(feed, /group-task-update/)
  // The apply scope starts the feed so the panellist glyph dot works no
  // matter which main panel is selected.
  const index = await readFile(join(root, 'src/client/index.ts'), 'utf8')
  assert.match(index, /unreadController\.start\(\)/)
  // The panellist glyph renders the dot from the shared feed.
  const glyph = await readFile(join(root, 'src/client/A2APanelGlyph.tsx'), 'utf8')
  assert.match(glyph, /hasAnyUnread\(state\)/)
  assert.match(glyph, /oac-unread-dot/)
  const panel = await readFile(join(root, 'src/client/A2AConversation.tsx'), 'utf8')
  assert.doesNotMatch(panel, /UNREAD_BADGE_ENABLED/)
  assert.doesNotMatch(panel, /UNREAD_POLL_MS/)
  // The per-Bot daemon proxy stays panel-selected-only (warm-up refresh).
  const openOnly = panel.indexOf("/oac/api/chat/events?from=")
  assert.ok(openOnly > 0)
})

test('host route chat/events/all is wired', async () => {
  const index = await readFile(join(root, 'src/index.ts'), 'utf8')
  assert.match(index, /chat\/events\/all/)
  assert.match(index, /streamAllChatEvents/)
})
