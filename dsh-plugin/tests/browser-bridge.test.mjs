import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

const plugin = await import('../lib/index.js')
const { BrowserEventHub, resolveBrowserPath } = plugin

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

test('hub.open returns null until a daemon base URL is known', () => {
  const hub = new BrowserEventHub({ METABOT_DAEMON_BASE_URL: '' })
  assert.equal(hub.open('metaid://x'), null)
  hub.stop()
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
