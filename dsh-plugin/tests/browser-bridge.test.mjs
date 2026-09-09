import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

const plugin = await import('../lib/index.js')
const { BrowserEventHub, resolveBrowserPath, withBrowserThemeParam } = plugin

test('resolveBrowserPath mirrors the CLI path forms for deep links', () => {
  assert.equal(
    resolveBrowserPath('metaid://idq14hmv23j5fnlx4ccnmvlyldjd38xjsechzwg9xz'),
    '/browser/metaid/idq14hmv23j5fnlx4ccnmvlyldjd38xjsechzwg9xz',
  )
  assert.equal(
    resolveBrowserPath('metaapp://0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefi0'),
    '/browser/metaapp/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefi0',
  )
  assert.equal(
    resolveBrowserPath('metafile://0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefi0.png'),
    '/browser/metafile/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefi0.png',
  )
  assert.equal(
    resolveBrowserPath('pin://0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefi0'),
    '/browser/pin/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefi0',
  )
  assert.equal(
    resolveBrowserPath('pinid://0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefi0'),
    '/browser/pin/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefi0',
  )
})

test('resolveBrowserPath maps bare pins and domain aliases', () => {
  assert.equal(
    resolveBrowserPath('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefi0'),
    '/browser/pin/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefi0',
  )
  assert.equal(resolveBrowserPath('sunnyfung.eth'), '/browser/metaid/sunnyfung.eth')
})

test('resolveBrowserPath falls back to the query form for unmapped schemes', () => {
  assert.equal(resolveBrowserPath('map://region/0x1'), '/browser?uri=map%3A%2F%2Fregion%2F0x1')
})

const PIN_ID = '676dd6ef86dfc1f5e714e1eddb495dd8d2907c7ba6e42401ea58780a23b92ea7i0'

test('withBrowserThemeParam reroutes pin/metaapp/map/bare-pin deep links to the uri query form', () => {
  // The reported bug: theme on a pin deep link used to become part of the
  // pin URI (pin://<id>?theme=dark) because agent-browser-ui glues the whole
  // page search onto the resource URI for these path forms.
  assert.equal(
    withBrowserThemeParam(`http://127.0.0.1:10001/browser/pin/${PIN_ID}`, 'dark'),
    `http://127.0.0.1:10001/browser?uri=pin%3A%2F%2F${PIN_ID}&theme=dark`,
  )
  assert.equal(
    withBrowserThemeParam(`http://127.0.0.1:10001/browser/metaapp/${PIN_ID}`, 'dark'),
    `http://127.0.0.1:10001/browser?uri=metaapp%3A%2F%2F${PIN_ID}&theme=dark`,
  )
  assert.equal(
    withBrowserThemeParam('http://127.0.0.1:10001/browser/map/region%2F0x1', 'dark'),
    'http://127.0.0.1:10001/browser?uri=map%3A%2F%2Fregion%2F0x1&theme=dark',
  )
  assert.equal(
    withBrowserThemeParam(`http://127.0.0.1:10001/browser/${PIN_ID}`, 'dark'),
    `http://127.0.0.1:10001/browser?uri=pin%3A%2F%2F${PIN_ID}&theme=dark`,
  )
})

test('withBrowserThemeParam keeps theme in the search on search-safe pages', () => {
  assert.equal(
    withBrowserThemeParam('http://127.0.0.1:10001/browser', 'dark'),
    'http://127.0.0.1:10001/browser?theme=dark',
  )
  assert.equal(
    withBrowserThemeParam(`http://127.0.0.1:10001/browser?uri=map%3A%2F%2Fregion%2F0x1`, 'light'),
    'http://127.0.0.1:10001/browser?uri=map%3A%2F%2Fregion%2F0x1&theme=light',
  )
  // metaid forwards only an explicit botpage param; metafile and
  // preview-metaapp drop the search entirely when deriving the resource URI.
  assert.equal(
    withBrowserThemeParam(
      'http://127.0.0.1:10001/browser/metaid/idq14hmv23j5fnlx4ccnmvlyldjd38xjsechzwg9xz',
      'dark',
    ),
    'http://127.0.0.1:10001/browser/metaid/idq14hmv23j5fnlx4ccnmvlyldjd38xjsechzwg9xz?theme=dark',
  )
  assert.equal(
    withBrowserThemeParam(
      `http://127.0.0.1:10001/browser/metafile/${PIN_ID}.png`,
      'dark',
    ),
    `http://127.0.0.1:10001/browser/metafile/${PIN_ID}.png?theme=dark`,
  )
  assert.equal(
    withBrowserThemeParam('http://127.0.0.1:10001/browser/preview-metaapp/localhost/apps/demo', 'dark'),
    'http://127.0.0.1:10001/browser/preview-metaapp/localhost/apps/demo?theme=dark',
  )
})

test('withBrowserThemeParam leaves deep links with their own search and non-browser URLs alone', () => {
  // A search on these paths is part of the resource URI (ABC glues it), so it
  // must survive untouched; the theme rides the load-time postMessage.
  assert.equal(
    withBrowserThemeParam(`http://127.0.0.1:10001/browser/pin/${PIN_ID}?x=1`, 'dark'),
    `http://127.0.0.1:10001/browser/pin/${PIN_ID}?x=1`,
  )
  // The qanda question page is not the Browser shell; the param is dead there.
  assert.equal(
    withBrowserThemeParam(`http://127.0.0.1:10001/ui/qanda/app/index.html#q/${PIN_ID}`, 'dark'),
    `http://127.0.0.1:10001/ui/qanda/app/index.html#q/${PIN_ID}`,
  )
  assert.equal(withBrowserThemeParam('pin://not-a-page-url', 'dark'), 'pin://not-a-page-url')
})

test('hub.open returns null until a daemon base URL is known', () => {
  const hub = new BrowserEventHub({ METABOT_DAEMON_BASE_URL: '' })
  assert.equal(hub.open('metaid://x'), null)
  hub.stop()
})

test('hub.open(null) loads the homepage and marks the snapshot open', async () => {
  const hub = new BrowserEventHub({ METABOT_DAEMON_BASE_URL: 'http://127.0.0.1:9' })
  hub.start()
  try {
    await new Promise((resolve) => setTimeout(resolve, 40))
    const event = hub.open(null, 'host')
    assert.equal(event.uri, null)
    assert.equal(event.localUiUrl, 'http://127.0.0.1:9/browser')
    assert.equal(hub.getSnapshot().open, true)
    assert.deepEqual(hub.getSnapshot().tabs, [])
  } finally {
    hub.stop()
  }
})

test('hub forwards agent-browser:open-tab events to web listeners', async () => {
  const received = []
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('retry: 3000\n\n')
    const frames = ['event: agent-browser:open-tab\ndata: {"uri":"metaid://idq1example"}']
    let i = 0
    const timer = setInterval(() => {
      if (i < frames.length) {
        res.write(`${frames[i]}\n\n`)
        i += 1
      } else {
        clearInterval(timer)
        res.end()
      }
    }, 20)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  const hub = new BrowserEventHub({ METABOT_DAEMON_BASE_URL: baseUrl })
  const off = hub.addListener((event) => received.push(event))
  hub.start()
  try {
    await new Promise((resolve) => setTimeout(resolve, 120))
    assert.equal(received.length, 1)
    assert.equal(received[0].uri, 'metaid://idq1example')
    assert.equal(received[0].localUiUrl, `${baseUrl}/browser/metaid/idq1example`)
  } finally {
    off()
    hub.stop()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('browser/open without a started hub answers daemon_unreachable', async () => {
  const routes = []
  const ctx = {
    webRuntime: { trustedHosts: [] },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    effect(fn) {
      fn()
    },
  }
  await plugin.apply(ctx, { skipBootstrap: true })
  const route = routes[0]
  const box = capture()
  const request = {
    method: 'POST',
    url: '/oac/api/browser/open',
    headers: { host: '127.0.0.1:8787' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ uri: 'metaid://idq1example' }))
    },
  }
  await route.handler(request, box.res)
  assert.equal(box.status, 200)
  const body = JSON.parse(box.body)
  assert.equal(body.ok, false)
  assert.equal(body.state, 'failed')
  assert.equal(body.code, 'daemon_unreachable')
})

function capture() {
  const box = { status: 0, body: '', res: null }
  box.res = {
    statusCode: 0,
    writeHead(status) {
      box.status = status
    },
    end(body) {
      box.body = body === undefined ? '' : String(body)
    },
  }
  return box
}
