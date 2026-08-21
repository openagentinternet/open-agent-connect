import assert from 'node:assert/strict'
import test from 'node:test'

const plugin = await import('../lib/index.js')

test('reduceBrowserTabs folds ABC host events into the live tab list', () => {
  let state = plugin.reduceBrowserTabs({ tabs: [], activeTabId: null }, 'tab-opened', {
    tabId: 1,
    uri: 'metaapp://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaai0',
  })
  state = plugin.reduceBrowserTabs(state, 'tab-activated', {
    tabId: 1,
    uri: 'metaapp://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaai0',
    title: '半糖牌局',
  })
  state = plugin.reduceBrowserTabs(state, 'tab-opened', { tabId: 2, uri: 'metaid://idq1peer' })
  state = plugin.reduceBrowserTabs(state, 'tab-activated', { tabId: 2, uri: 'metaid://idq1peer', title: 'Peer' })
  assert.equal(state.activeTabId, 2)
  assert.equal(state.tabs.length, 2)
  assert.equal(state.tabs[0].isActive, false)
  assert.equal(state.tabs[1].isActive, true)
  state = plugin.reduceBrowserTabs(state, 'title-updated', { tabId: 1, title: 'Agent对决：半糖牌局' })
  assert.equal(state.tabs[0].title, 'Agent对决：半糖牌局')
  state = plugin.reduceBrowserTabs(state, 'tab-closed', { tabId: 2 })
  assert.equal(state.tabs.length, 1)
  assert.equal(state.tabs[0].isActive, true)
})

test('parseMetaAppPinIdFromUri accepts metaapp URIs and bare pinIds', () => {
  const pin = 'a'.repeat(64) + 'i0'
  assert.equal(plugin.parseMetaAppPinIdFromUri(`metaapp://${pin}`), pin)
  assert.equal(plugin.parseMetaAppPinIdFromUri(pin.toUpperCase()), pin)
  assert.equal(plugin.parseMetaAppPinIdFromUri('metaid://idq1x'), '')
})

test('formatMetaAppCandidates keeps titles and authors as markdown links', () => {
  const pin = 'b'.repeat(64) + 'i0'
  const text = plugin.formatMetaAppCandidates([{
    pinId: pin,
    title: 'Desk',
    intro: 'A tiny desk',
    publisherName: 'alice',
    publisherGlobalMetaId: 'idq1alice',
    isOwn: true,
    tags: ['game'],
    updatedAt: 1_700_000_000,
  }])
  assert.match(text, new RegExp(`\\[Desk\\]\\(metaapp://${pin}\\)`))
  assert.match(text, /\[alice\]\(metaid:\/\/idq1alice\) \(your MetaBot\)/)
})

test('buildBrowserContextXml describes a closed sidebar without inventing a page', () => {
  const xml = plugin.buildBrowserContextXml({ snapshot: { open: false, tabs: [] } })
  assert.match(xml, /Bot Browser sidebar is not open/)
  assert.match(xml, /<active_tab \/>/)
  assert.doesNotMatch(xml, /metaapp:\/\//)
})

test('buildBrowserContextXml lists the live active tab and source_dir', () => {
  const pin = 'c'.repeat(64) + 'i0'
  const xml = plugin.buildBrowserContextXml({
    snapshot: {
      open: true,
      rendererType: 'html-iframe',
      tabs: [{
        id: 1,
        uri: `metaapp://${pin}`,
        title: '半糖牌局',
        isActive: true,
      }],
    },
    source: { dir: '/tmp/cache/app', indexFile: 'index.html' },
  })
  assert.match(xml, /<active_tab title="半糖牌局" renderer="html-iframe" source_dir="\/tmp\/cache\/app"/)
  assert.match(xml, new RegExp(`metaapp://${pin}`))
  assert.match(xml, /bot_browser_read_page/)
})
