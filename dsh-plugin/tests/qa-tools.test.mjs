import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const plugin = await import('../lib/qa-tools.js')

const require = createRequire(import.meta.url)

function fakeHost(overrides = {}) {
  const tools = []
  const sections = []
  return {
    tools,
    sections,
    ctx: {
      tools: { register: (definition) => tools.push(definition) },
      systemPrompt: { section: (spec) => sections.push(spec) },
      logger: { warn: () => undefined },
      ...overrides,
    },
  }
}

function fakeRun(result) {
  const calls = []
  const run = async (args, options) => {
    // runMetabotWithPayloadFile deletes its temp payload on return, so the
    // payload must be captured synchronously here.
    const flagIndex = args.indexOf('--request-file')
    const payload = flagIndex >= 0
      ? JSON.parse(readFileSync(args[flagIndex + 1], 'utf8'))
      : undefined
    calls.push({ args, options, payload })
    return result ?? { ok: true, state: 'success', data: { pinId: 'qp1', formatted: 'Question published on-chain.\n- question pinId: qp1' } }
  }
  return { calls, run }
}

/** Intercept the recall client's fetch (it reads globalThis.fetch per call). */
function fakeQaFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push(String(url))
    const body = await handler(String(url))
    return {
      status: 200,
      json: async () => body,
    }
  }
  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

function envelope(data) {
  return { code: 0, data, message: 'ok' }
}

const QUESTION = {
  pinId: 'q1', currentPinId: 'q1', chainName: 'mvc', title: 'How to fish',
  summary: 's', tags: [], contentType: 'text/markdown',
  publisher: { globalMetaId: 'gm1', metaId: 'm1', name: 'Asker', avatar: '' },
  createdAt: 100, isMempool: false, likeCount: 1, dislikeCount: 0, commentCount: 0,
  answerCount: 0, topAnswer: null,
}

test('bindQaToolInstall registers the qa-behavior section and all six tools', () => {
  const host = fakeHost()
  plugin.bindQaToolInstall(host.ctx)
  assert.equal(host.sections.length, 1)
  assert.equal(host.sections[0].name, 'oac:qa-behavior')
  assert.equal(host.sections[0].order, 142.5)
  assert.match(host.sections[0].text, /search first, ask when stuck, answer what you know/)
  assert.match(host.sections[0].text, /max_answers=0/)
  assert.deepEqual(
    host.tools.map((tool) => tool.name),
    ['post_simplequestion', 'post_simpleanswer', 'like_pin', 'search_qa', 'list_latest_questions', 'get_question_answers'],
  )
})

test('search_qa maps params, honors the env base URL, and renders real formatter bullets', async () => {
  const fetchStub = fakeQaFetch(() => envelope({ items: [QUESTION], hasMore: true, nextCursor: 'cur-2' }))
  const originalEnv = process.env.METABOT_METAWEB_API_BASE_URL
  process.env.METABOT_METAWEB_API_BASE_URL = 'https://so.test'
  try {
    const host = fakeHost()
    plugin.bindQaToolInstall(host.ctx)
    const search = host.tools.find((tool) => tool.name === 'search_qa')
    const result = await search.execute({
      query: 'fishing', tags: ['a', 'b'], answered: false, sort: 'newest', size: 20, cursor: 'c1',
    }, {})
    const url = new URL(fetchStub.calls[0])
    assert.equal(url.origin, 'https://so.test')
    assert.equal(url.pathname, '/api/qa/search')
    assert.equal(url.searchParams.get('tags'), 'a,b')
    assert.equal(url.searchParams.get('answered'), 'false')
    assert.equal(url.searchParams.get('sort'), 'newest')
    assert.equal(url.searchParams.get('cursor'), 'c1')
    assert.match(result, /1 on-chain question\(s\) matching "fishing", newest first:/)
    assert.match(result, /\[How to fish\]\(pin:\/\/q1\)/)
    assert.match(result, /\[Asker\]\(metaid:\/\/gm1\)/)
    assert.match(result, /cursor="cur-2"/)
  } finally {
    fetchStub.restore()
    if (originalEnv === undefined) delete process.env.METABOT_METAWEB_API_BASE_URL
    else process.env.METABOT_METAWEB_API_BASE_URL = originalEnv
  }
})

test('search_qa with no hits nudges post_simplequestion instead of inventing', async () => {
  const fetchStub = fakeQaFetch(() => envelope({ items: [], hasMore: false, nextCursor: null }))
  try {
    const host = fakeHost()
    plugin.bindQaToolInstall(host.ctx)
    const search = host.tools.find((tool) => tool.name === 'search_qa')
    const result = await search.execute({ query: 'nothing' }, {})
    assert.match(result, /No on-chain Q&A matched "nothing"/)
    assert.match(result, /post_simplequestion/)
    assert.match(result, /Do NOT invent questions or answers/)
  } finally {
    fetchStub.restore()
  }
})

test('list_latest_questions maps max_answers=0 through to the feed', async () => {
  const fetchStub = fakeQaFetch(() => envelope({ items: [QUESTION], hasMore: false, nextCursor: null }))
  try {
    const host = fakeHost()
    plugin.bindQaToolInstall(host.ctx)
    const latest = host.tools.find((tool) => tool.name === 'list_latest_questions')
    const result = await latest.execute({ max_answers: 0, sort: 'hot', tags: ['x'] }, {})
    const url = new URL(fetchStub.calls[0])
    assert.equal(url.pathname, '/api/qa/questions')
    assert.equal(url.searchParams.get('maxAnswers'), '0')
    assert.equal(url.searchParams.get('sort'), 'hot')
    assert.match(result, /hot-ranked \(last 7 days\)/)
    assert.match(result, /\[How to fish\]\(pin:\/\/q1\)/)
  } finally {
    fetchStub.restore()
  }
})

test('get_question_answers uses the publisher-filtered answer list and maps 40400 to honest text', async () => {
  const notFound = envelope(undefined)
  notFound.code = 40400
  notFound.message = 'no such question'
  const fetchStub = fakeQaFetch((url) => {
    if (url.includes('/answers?')) {
      return envelope({ items: [], hasMore: false, nextCursor: null })
    }
    if (url.endsWith('/gone')) {
      return notFound
    }
    return envelope({ question: QUESTION, answers: [], hasMore: false, nextCursor: null })
  })
  try {
    const host = fakeHost()
    plugin.bindQaToolInstall(host.ctx)
    const tool = host.tools.find((definition) => definition.name === 'get_question_answers')

    const result = await tool.execute({ question_pin_id: 'q1', publisher: 'gm-me', size: 10, cursor: 'x' }, {})
    assert.equal(fetchStub.calls.length, 2, 'detail + publisher-filtered answers')
    assert.match(fetchStub.calls[1], /\/api\/qa\/questions\/q1\/answers\?publisher=gm-me&size=10&cursor=x/)
    assert.match(result, /Question q1:/)
    assert.match(result, /No answers yet — if you know the answer, post_simpleanswer/)

    // 40400: honest text, never an error, never invented data.
    const missing = await tool.execute({ question_pin_id: 'gone' }, {})
    assert.match(missing, /No on-chain question matches pinId "gone"/)
    assert.match(missing, /do NOT invent question data/)
  } finally {
    fetchStub.restore()
  }
})

test('post_simplequestion: workspace files publish freely, external files need one approval', async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'qa-ws-'))
  const inside = path.join(workspace, 'shot.png')
  writeFileSync(inside, 'png')
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'qa-out-'))
  const outside = path.join(outsideDir, 'shot.png')
  writeFileSync(outside, 'png')

  const asked = []
  let approve = true
  const approval = {
    request: async (req) => {
      asked.push(req)
      return approve ? 'allowed-once' : 'rejected'
    },
    overrideOf: () => undefined,
  }
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const [tool] = plugin.buildQaToolDefinitions({
    host: host.ctx,
    hostAgent: { ctx: host.ctx },
    approval,
    run,
    getWorkspaceDir: () => workspace,
  })

  const ok = await tool.execute({
    title: 'T', content: 'ctx', attachments: [inside, 'metafile://keep'], tags: ['x'], network: 'doge',
  }, {})
  assert.match(ok, /Question published on-chain/)
  assert.equal(asked.length, 0, 'in-workspace + metafile URIs never ask')
  assert.deepEqual(calls[0].args.slice(0, 2), ['qanda', 'question'])
  assert.equal(calls[0].payload.title, 'T')
  assert.equal(calls[0].payload.content, 'ctx')
  assert.deepEqual(calls[0].payload.tags, ['x'])
  assert.equal(calls[0].payload.network, 'doge')
  assert.equal(calls[0].payload.confirmExternalUpload, true)

  const external = await tool.execute({ title: 'T2', attachments: [outside] }, {})
  assert.match(external, /Question published on-chain/)
  assert.equal(asked.length, 1)
  assert.equal(asked[0].toolName, 'post_simplequestion')

  approve = false
  const denied = await tool.execute({ title: 'T3', attachments: [outside] }, {})
  assert.match(denied, /Owner declined/)
  assert.equal(calls.length, 2, 'declined publish never spawns the CLI write')

  const relative = await tool.execute({ title: 'T4', attachments: ['rel/shot.png'] }, {})
  assert.match(relative, /ABSOLUTE local file paths/)

  const noTitle = await tool.execute({ title: '  ' }, {})
  assert.match(noTitle, /requires `title`/)
})

test('post_simpleanswer passes answer fields through and renders the already-answered notice', async () => {
  const { run, calls } = fakeRun({
    ok: true,
    state: 'success',
    data: {
      published: false,
      alreadyAnswered: true,
      notice: 'Not published yet — you already have 1 previous answer to question q1:\n- answer pinId: a1',
      priorAnswerCount: 1,
    },
  })
  const host = fakeHost()
  const [, tool] = plugin.buildQaToolDefinitions({
    host: host.ctx,
    hostAgent: { ctx: host.ctx },
    run,
  })

  const notice = await tool.execute({ answer_to: 'q1', content: 'again' }, {})
  assert.match(notice, /Not published yet — you already have 1 previous answer/)
  assert.ok(!notice.includes('Answer published'), 'the notice must not claim a publish')
  assert.deepEqual(calls[0].args.slice(0, 2), ['qanda', 'answer'])
  assert.deepEqual(calls[0].payload, { answer_to: 'q1', content: 'again', confirmExternalUpload: true })

  const missing = await tool.execute({ answer_to: '', content: 'x' }, {})
  assert.match(missing, /requires both `answer_to`/)
})

test('like_pin writes {pin_id, is_like} and validates is_like defensively', async () => {
  const { run, calls } = fakeRun({
    ok: true,
    state: 'success',
    data: { formatted: 'Liked pin t1 — reaction published on-chain.' },
  })
  const host = fakeHost()
  const [, , tool] = plugin.buildQaToolDefinitions({
    host: host.ctx,
    hostAgent: { ctx: host.ctx },
    run,
  })

  const ok = await tool.execute({ pin_id: 't1', is_like: 1 }, {})
  assert.match(ok, /Liked pin t1/)
  assert.deepEqual(calls[0].args.slice(0, 2), ['qanda', 'like'])
  assert.deepEqual(calls[0].payload, { pin_id: 't1', is_like: 1 })

  const bad = await tool.execute({ pin_id: 't1', is_like: 2 }, {})
  assert.match(bad, /must be exactly 1/)
})
