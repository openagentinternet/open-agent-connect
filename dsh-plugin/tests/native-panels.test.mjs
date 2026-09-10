import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const flow = await import('../lib/browser-open-flow.js')

function fakeFace(overrides = {}) {
  const calls = []
  const face = {
    browserOpen: async (uri) => {
      calls.push(['browserOpen', uri])
      return overrides.url ?? 'http://127.0.0.1:4242/browser/home'
    },
    selectConversation: () => { calls.push(['selectConversation']) },
    openTab: (params) => { calls.push(['openTab', params]) },
    reportError: (message) => { calls.push(['reportError', message]) },
    ...overrides.face,
  }
  return { face, calls }
}

test('cold open resolves the url then reveals the tab with url + uri', async () => {
  const { face, calls } = fakeFace({ url: 'http://x/browser/bot' })
  await flow.openBotBrowser(face, 'metaid://abc', null, [0])
  assert.deepEqual(calls, [
    ['browserOpen', 'metaid://abc'],
    ['selectConversation'],
    ['openTab', { url: 'http://x/browser/bot', uri: 'metaid://abc' }],
  ])
})

test('home open (null uri) reveals the tab without a uri param', async () => {
  const { face, calls } = fakeFace({ url: 'http://x/browser/home' })
  await flow.openBotBrowser(face, null, null, [0])
  assert.deepEqual(calls, [
    ['browserOpen', null],
    ['selectConversation'],
    ['openTab', { url: 'http://x/browser/home' }],
  ])
})

test('live iframe + uri reveals on the CURRENT live url (duplicate-nav guard)', async () => {
  const { face, calls } = fakeFace({ url: 'http://x/browser/fresh' })
  await flow.openBotBrowser(face, 'metaid://abc', 'http://x/browser/live', [0])
  assert.deepEqual(calls, [
    ['browserOpen', 'metaid://abc'],
    ['selectConversation'],
    ['openTab', { url: 'http://x/browser/live', uri: 'metaid://abc' }],
  ])
})

test('live iframe + no uri falls through to a fresh resolve (home navigation)', async () => {
  const { face, calls } = fakeFace({ url: 'http://x/browser/home' })
  await flow.openBotBrowser(face, null, 'http://x/browser/live', [0])
  assert.deepEqual(calls, [
    ['browserOpen', null],
    ['selectConversation'],
    ['openTab', { url: 'http://x/browser/home' }],
  ])
})

test('openTab retries through the no-mounted-surface window, then succeeds', async () => {
  let attempts = 0
  const { face, calls } = fakeFace({
    face: {
      openTab: (params) => {
        attempts += 1
        if (attempts < 3) throw new Error('sidebarRight: no session surface is mounted')
        calls.push(['openTab', params])
      },
    },
  })
  await flow.revealBotBrowserTab(face, { url: 'http://x/browser/home' }, [0, 0, 0])
  assert.equal(attempts, 3)
  assert.deepEqual(calls, [
    ['selectConversation'],
    ['openTab', { url: 'http://x/browser/home' }],
  ])
})

test('openTab failing every retry lands in reportError and never rejects', async () => {
  const { face, calls } = fakeFace({
    face: {
      openTab: () => { throw new Error('sidebarRight: no session surface is mounted') },
    },
  })
  await flow.revealBotBrowserTab(face, { url: 'http://x/browser/home' }, [0, 0, 0])
  assert.deepEqual(calls, [
    ['selectConversation'],
    ['reportError', 'sidebarRight: no session surface is mounted'],
  ])
})

test('a selectConversation hiccup never blocks the openTab attempts', async () => {
  const { face, calls } = fakeFace({
    face: {
      selectConversation: () => { throw new Error('layout gone') },
    },
  })
  await flow.revealBotBrowserTab(face, { url: 'http://x/browser/home' }, [0])
  assert.deepEqual(calls, [['openTab', { url: 'http://x/browser/home' }]])
})

test('browserOpen rejection lands in reportError and never rejects', async () => {
  const { face, calls } = fakeFace({
    face: {
      browserOpen: async () => { throw new Error('daemon unreachable') },
    },
  })
  await flow.openBotBrowser(face, 'metaid://abc', null, [0])
  assert.deepEqual(calls, [['reportError', 'daemon unreachable']])
})

test('shouldResetIframeSrc: fresh url replaces, same url and url-less navigations do not', () => {
  assert.equal(flow.shouldResetIframeSrc(null, 'http://a'), false)
  assert.equal(flow.shouldResetIframeSrc('http://a', 'http://a'), false)
  assert.equal(flow.shouldResetIframeSrc('http://b', 'http://a'), true)
  assert.equal(flow.shouldResetIframeSrc('http://a', null), true)
})

test('client registers the bot-browser tab type, body, and title on the right Sidebar', async () => {
  const text = await readFile(join(root, 'src/client/index.ts'), 'utf8')
  assert.match(text, /sidebarRightTabs\.register\(\{/)
  assert.match(text, /id: BOT_BROWSER_TAB_ID/)
  assert.match(text, /kind: BOT_BROWSER_TAB_KIND/)
  assert.match(text, /name: 'sidebar\.right\.pane\.tab'/)
  assert.match(text, /key: BOT_BROWSER_TAB_ID/)
  assert.match(text, /name: 'sidebar\.right\.pane\.tab\.title'/)
  assert.match(text, /ctx\.sidebarRight\.openTab\(BOT_BROWSER_TAB_KIND, \{ params \}\)/)
  assert.match(text, /ctx\.layout\.selectPanel\(null\)/)
  assert.match(text, /guide: \[\{/)
  // The body portal is gone: the right Sidebar owns the chrome now.
  assert.doesNotMatch(text, /createRoot/)
  assert.doesNotMatch(text, /react-dom\/client/)
  assert.doesNotMatch(text, /BotBrowserSidebar/)
})

test('client registers the A2A main panel and its panellist glyph, not the footer action', async () => {
  const text = await readFile(join(root, 'src/client/index.ts'), 'utf8')
  assert.match(text, /name: 'main'/)
  assert.match(text, /key: 'oac-a2a'/)
  assert.match(text, /name: 'sidebar\.panellist'/)
  assert.match(text, /id: 'oac-a2a'/)
  assert.doesNotMatch(text, /sidebar\.footer\.action/)
  assert.match(text, /unreadController\.start\(\)/)
})

test('client inject array declares the layout and right-sidebar services', async () => {
  const text = await readFile(join(root, 'src/client/index.ts'), 'utf8')
  assert.match(
    text,
    /export const inject = \[\s*'slots',\s*'locale',\s*'remote',\s*'remote\.agentPresets',\s*'remote\.session',\s*'layout',\s*'sidebarRight',\s*'sidebarRightTabs',?\s*\]/,
  )
})

test('bot-browser tab body reads navigation params and guards same-url reveals', async () => {
  const text = await readFile(join(root, 'src/client/BotBrowserTab.tsx'), 'utf8')
  assert.match(text, /SidebarRightTabParamsMap/)
  assert.match(text, /'bot-browser': BotBrowserTabParams/)
  assert.match(text, /useTabInfo\(\)/)
  assert.match(text, /tab\.navigation\.params/)
  assert.match(text, /tab\.navigation\.revision/)
  assert.match(text, /shouldResetIframeSrc\(paramsUrl, loadedUrl\)/)
  assert.match(text, /key=\{loadedUrl\}/)
})
