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

test('normalizeBotBrowserUri recovers Agent Internet URIs including leftover web2 hrefs', () => {
  const pin = 'd'.repeat(64) + 'i0'
  assert.equal(plugin.normalizeBotBrowserUri(`metaapp://${pin}`), `metaapp://${pin}`)
  assert.equal(plugin.normalizeBotBrowserUri(`pinid://${pin}`), `pin://${pin}`)
  assert.equal(
    plugin.normalizeBotBrowserUri(`https://openagentinternet.org/browser/metaapp/${pin}`),
    `metaapp://${pin}`,
  )
  assert.equal(
    plugin.normalizeBotBrowserUri('https://openagentinternet.org/browser/metaid/idq1alice'),
    'metaid://idq1alice',
  )
  assert.equal(
    plugin.normalizeBotBrowserUri(`https://openagentinternet.org/browser/pin/${pin}`),
    `pin://${pin}`,
  )
  assert.equal(plugin.normalizeBotBrowserUri(pin), `pin://${pin}`)
  assert.equal(plugin.isBotBrowserUri('https://example.com'), false)
})

test('linkifyAgentInternetUris keeps native metaapp/pin destinations', () => {
  const pin = 'e'.repeat(64) + 'i0'
  const output = plugin.linkifyAgentInternetUris(`open metaapp://${pin} and pinid://${pin}`)
  assert.match(output, new RegExp(`\\[metaapp://${pin}\\]\\(metaapp://${pin}\\)`))
  assert.match(output, new RegExp(`\\[pinid://${pin}\\]\\(pinid://${pin}\\)`))
  const already = plugin.linkifyAgentInternetUris(`[Desk](metaapp://${pin})`)
  assert.equal(already, `[Desk](metaapp://${pin})`)
})

test('wrapKnownCatalogTitles links restated names without eating longer titles', () => {
  const pinA = 'a'.repeat(64) + 'i0'
  const pinB = 'b'.repeat(64) + 'i0'
  const catalog = plugin.catalogFromMetaAppCandidates([
    { pinId: pinA, title: '番茄钟 · Pomodoro Timer (蓝调版)', publisherName: 'Lucy', publisherGlobalMetaId: 'idq1lucy' },
    { pinId: pinB, title: '番茄钟 · Pomodoro Timer', publisherName: 'Sunny', publisherGlobalMetaId: 'idq1sunny' },
  ])
  const text = plugin.wrapKnownCatalogTitles(
    '链上一共找到 2 款：\n番茄钟 · Pomodoro Timer (蓝调版) — 蓝色主题\n番茄钟 · Pomodoro Timer — 简洁高效',
    catalog,
  )
  assert.match(text, new RegExp(`\\[番茄钟 · Pomodoro Timer \\(蓝调版\\)\\]\\(metaapp://${pinA}\\)`))
  assert.match(text, new RegExp(`\\[番茄钟 · Pomodoro Timer\\]\\(metaapp://${pinB}\\)`))
  assert.doesNotMatch(text, /链上一共找到 2 款：\[/)
})

test('buildBrowserContextXml describes a closed sidebar without inventing a page', () => {
  const xml = plugin.buildBrowserContextXml({ snapshot: { open: false, tabs: [] } })
  assert.match(xml, /Bot Browser sidebar is not open/)
  assert.match(xml, /bot_browser_open_uri with no uri/)
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

test('decideBrowserOpenAction loads home and does not invent an open-tab', () => {
  assert.deepEqual(
    plugin.decideBrowserOpenAction({
      source: 'host',
      uri: null,
      localUiUrl: 'http://127.0.0.1:1/browser',
      hasIframeUrl: false,
    }),
    { kind: 'load', url: 'http://127.0.0.1:1/browser' },
  )
  assert.deepEqual(
    plugin.decideBrowserOpenAction({
      source: 'host',
      uri: null,
      localUiUrl: 'http://127.0.0.1:1/browser',
      hasIframeUrl: true,
    }),
    { kind: 'load', url: 'http://127.0.0.1:1/browser' },
  )
  assert.deepEqual(
    plugin.decideBrowserOpenAction({
      source: 'host',
      uri: `metaapp://${'c'.repeat(64)}i0`,
      localUiUrl: 'http://127.0.0.1:1/browser/metaapp/x',
      hasIframeUrl: true,
    }),
    { kind: 'open-tab', uri: `metaapp://${'c'.repeat(64)}i0` },
  )
  assert.deepEqual(
    plugin.decideBrowserOpenAction({
      source: 'daemon',
      uri: `metaapp://${'c'.repeat(64)}i0`,
      localUiUrl: 'http://127.0.0.1:1/browser/metaapp/x',
      hasIframeUrl: true,
    }),
    { kind: 'ensure-open' },
  )
})

test('applyTabInfo marks the hydrated tab active', () => {
  const pin = 'c'.repeat(64) + 'i0'
  const next = plugin.applyTabInfo({ tabs: [], activeTabId: null }, {
    id: 3,
    uri: `metaapp://${pin}`,
    title: '番茄钟',
    isActive: true,
  })
  assert.equal(next.activeTabId, 3)
  assert.equal(next.tabs[0].uri, `metaapp://${pin}`)
  assert.equal(next.tabs[0].isActive, true)
})
