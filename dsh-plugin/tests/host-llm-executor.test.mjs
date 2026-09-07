import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

const plugin = await import('../lib/index.js')
const { HostLlmExecutor } = plugin

function textStream(text) {
  return async function* stream() {
    yield { type: 'text-delta', text }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function waitFor(predicate, timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer)
        reject(new Error('waitFor timed out'))
      }
    }, 10)
  })
}

test('executor answers daemon generate requests with the DSH pair', async () => {
  const posted = []
  const request = {
    type: 'generate',
    requestId: 'req-1',
    botSlug: 'alice',
    provider: 'deepseek',
    model: 'deepseek-chat',
    reasoningEffort: 'low',
    system: 'You are Alice.',
    prompt: 'Reply now:',
    timeoutMs: 5_000,
  }
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/llm/host-executor/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('retry: 3000\n\n')
      res.write(`data: ${JSON.stringify(request)}\n\n`)
      return
    }
    if (req.method === 'POST' && req.url === '/api/llm/host-executor/result') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        posted.push(JSON.parse(body))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, state: 'success', data: { accepted: true } }))
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  const streamCalls = []
  const llm = {
    stream(options) {
      streamCalls.push(options)
      return textStream('Hi from the brain model.')(options)
    },
  }
  const executor = new HostLlmExecutor({
    env: { METABOT_DAEMON_BASE_URL: `http://127.0.0.1:${port}` },
    llm,
  })
  executor.start()
  try {
    await waitFor(() => posted.length === 1)
    assert.equal(streamCalls.length, 1)
    assert.equal(streamCalls[0].provider, 'deepseek')
    assert.equal(streamCalls[0].model, 'deepseek-chat')
    assert.equal(streamCalls[0].reasoningEffort, 'low')
    assert.equal(streamCalls[0].purpose, 'oac-a2a-reply')
    assert.equal(streamCalls[0].messages[0].content[0].text, 'You are Alice.')
    assert.equal(streamCalls[0].messages[1].content[0].text, 'Reply now:')
    assert.deepEqual(posted[0], { requestId: 'req-1', ok: true, output: 'Hi from the brain model.' })
  } finally {
    executor.stop()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('executor retries once on the fallback pair after a primary failure', async () => {
  const posted = []
  const request = {
    type: 'generate',
    requestId: 'req-2',
    provider: 'bad-provider',
    model: 'broken-model',
    fallback: { provider: 'good-provider', model: 'good-model', reasoningEffort: 'high' },
    system: 'sys',
    prompt: 'prompt',
    timeoutMs: 5_000,
  }
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/llm/host-executor/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('retry: 3000\n\n')
      res.write(`data: ${JSON.stringify(request)}\n\n`)
      return
    }
    if (req.method === 'POST' && req.url === '/api/llm/host-executor/result') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        posted.push(JSON.parse(body))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, state: 'success', data: { accepted: true } }))
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  const streamCalls = []
  const llm = {
    stream(options) {
      streamCalls.push(options)
      if (options.provider === 'bad-provider') {
        return (async function* broken() {
          yield { type: 'finish', reason: { kind: 'error', failure: { message: 'primary exploded' } } }
        })()
      }
      return textStream('Fallback pair reply.')(options)
    },
  }
  const logs = []
  const executor = new HostLlmExecutor({
    env: { METABOT_DAEMON_BASE_URL: `http://127.0.0.1:${port}` },
    llm,
    log: (message) => logs.push(message),
  })
  executor.start()
  try {
    await waitFor(() => posted.length === 1)
    assert.equal(streamCalls.length, 2)
    assert.equal(streamCalls[0].provider, 'bad-provider')
    assert.equal(streamCalls[1].provider, 'good-provider')
    assert.equal(streamCalls[1].model, 'good-model')
    assert.equal(streamCalls[1].reasoningEffort, 'high')
    assert.deepEqual(posted[0], { requestId: 'req-2', ok: true, output: 'Fallback pair reply.' })
    assert.ok(logs.some((line) => line.includes('retrying on fallback pair')))
  } finally {
    executor.stop()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('executor posts a failure result when both pairs fail', async () => {
  const posted = []
  const request = {
    type: 'generate',
    requestId: 'req-3',
    provider: 'bad-provider',
    model: 'broken-model',
    system: 'sys',
    prompt: 'prompt',
    timeoutMs: 5_000,
  }
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/llm/host-executor/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('retry: 3000\n\n')
      res.write(`data: ${JSON.stringify(request)}\n\n`)
      return
    }
    if (req.method === 'POST' && req.url === '/api/llm/host-executor/result') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        posted.push(JSON.parse(body))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, state: 'success', data: { accepted: true } }))
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  const llm = {
    stream() {
      return (async function* broken() {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'provider down' } } }
      })()
    },
  }
  const executor = new HostLlmExecutor({
    env: { METABOT_DAEMON_BASE_URL: `http://127.0.0.1:${port}` },
    llm,
  })
  executor.start()
  try {
    await waitFor(() => posted.length === 1)
    assert.equal(posted[0].ok, false)
    assert.match(posted[0].error, /provider down/)
    assert.equal(posted[0].requestId, 'req-3')
  } finally {
    executor.stop()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('executor without an llm service posts an explicit failure', async () => {
  const posted = []
  const request = {
    type: 'generate',
    requestId: 'req-4',
    provider: 'deepseek',
    model: 'deepseek-chat',
    system: 'sys',
    prompt: 'prompt',
    timeoutMs: 5_000,
  }
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/llm/host-executor/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('retry: 3000\n\n')
      res.write(`data: ${JSON.stringify(request)}\n\n`)
      return
    }
    if (req.method === 'POST' && req.url === '/api/llm/host-executor/result') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        posted.push(JSON.parse(body))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, state: 'success', data: { accepted: true } }))
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  const executor = new HostLlmExecutor({
    env: { METABOT_DAEMON_BASE_URL: `http://127.0.0.1:${port}` },
    llm: undefined,
  })
  executor.start()
  try {
    await waitFor(() => posted.length === 1)
    assert.equal(posted[0].ok, false)
    assert.match(posted[0].error, /llm service is not available/)
  } finally {
    executor.stop()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('malformed SSE frames are ignored without breaking the subscription', async () => {
  const posted = []
  const request = {
    type: 'generate',
    requestId: 'req-5',
    provider: 'deepseek',
    model: 'deepseek-chat',
    system: 'sys',
    prompt: 'prompt',
    timeoutMs: 5_000,
  }
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/llm/host-executor/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('retry: 3000\n\n')
      res.write('data: not-json\n\n')
      res.write('data: {"type":"other"}\n\n')
      res.write(`data: ${JSON.stringify(request)}\n\n`)
      return
    }
    if (req.method === 'POST' && req.url === '/api/llm/host-executor/result') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        posted.push(JSON.parse(body))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, state: 'success', data: { accepted: true } }))
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  const llm = { stream(options) { return textStream('ok')(options) } }
  const executor = new HostLlmExecutor({
    env: { METABOT_DAEMON_BASE_URL: `http://127.0.0.1:${port}` },
    llm,
  })
  executor.start()
  try {
    await waitFor(() => posted.length === 1)
    assert.deepEqual(posted[0], { requestId: 'req-5', ok: true, output: 'ok' })
  } finally {
    executor.stop()
    await new Promise((resolve) => server.close(resolve))
  }
})
