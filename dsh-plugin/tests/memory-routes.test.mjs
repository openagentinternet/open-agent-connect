import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const plugin = await import('../lib/index.js')

async function capture(method, payload, options = {}) {
  const calls = []
  const result = await plugin.dispatchMemoryRoutes(method, payload, {
    run: options.run ?? (async (args) => {
      calls.push(args)
      const fileFlag = args.includes('--payload-file') ? '--payload-file' : null
      let file
      if (fileFlag) {
        file = JSON.parse(await readFile(args[args.indexOf(fileFlag) + 1], 'utf8'))
      }
      return { ok: true, state: 'success', data: { args, file } }
    }),
    ...(options.llm ? { llm: options.llm } : {}),
  })
  return { result, calls }
}

test('memory list maps filters to CLI flags', async () => {
  const { result, calls } = await capture('memory/list', { from: 'alice', query: '咖啡', limit: 5, status: 'created' })
  assert.equal(result.ok, true)
  assert.deepEqual(calls[0].slice(0, 4), ['memory', 'list', '--from', 'alice'])
  assert.ok(calls[0].includes('--query'))
  assert.ok(calls[0].includes('--limit'))
})

test('memory add/update/delete forward the payload file', async () => {
  const add = await capture('memory/add', { from: 'alice', text: '我喜欢美式咖啡', isExplicit: true })
  assert.equal(add.result.data.file.text, '我喜欢美式咖啡')
  const update = await capture('memory/update', { from: 'alice', entry: { id: 'mem_1', text: 'x' } })
  assert.equal(update.result.data.file.id, 'mem_1')
  const del = await capture('memory/delete', { from: 'alice', id: 'mem_1' })
  assert.equal(del.result.data.file.id, 'mem_1')
})

test('memory policy set forwards the patch object; knowledge and impressions map verbs', async () => {
  const set = await capture('memory/policy/set', { from: 'alice', patch: { memoryEnabled: false } })
  assert.deepEqual(set.result.data.file, { memoryEnabled: false })
  const knowledge = await capture('memory/knowledge/upsert', { from: 'alice', topic: 't', summary: 's' })
  assert.deepEqual(knowledge.calls[0].slice(0, 5), ['memory', 'knowledge', 'upsert', '--from', 'alice'])
  const show = await capture('memory/impressions/show', { from: 'alice', subject: 'gm-bob' })
  assert.ok(show.calls[0].includes('--subject'))
  const missingSubject = await capture('memory/impressions/show', { from: 'alice' })
  assert.equal(missingSubject.result.code, 'missing_subject')
})

test('user bind/unbind and twin routes map to CLI verbs', async () => {
  const bind = await capture('user/bind', { from: 'ignored', slug: 'alice' })
  assert.deepEqual(bind.calls[0], ['bot', 'bind-owner', '--from', 'alice'])
  const unbind = await capture('user/unbind', { slug: 'alice' })
  assert.ok(unbind.calls[0].includes('--unbind'))
  const current = await capture('twin/current', {})
  assert.deepEqual(current.calls[0], ['twin', 'current'])
})

test('dream/run drives plan → llm → commit and honors the identity retry hint', async () => {
  const seen = []
  const run = async (args) => {
    seen.push(args)
    const verb = args[1]
    if (verb === 'plan') {
      return { ok: true, state: 'success', data: { kind: 'prompt', system: 'sys', user: 'usr', maxOutputTokens: 4096 } }
    }
    if (verb === 'commit') {
      const fileFlag = args.indexOf('--payload-file')
      const file = JSON.parse(await readFile(args[fileFlag + 1], 'utf8'))
      seen.push(['commit-payload', file])
      if (seen.filter((entry) => entry[0] === 'commit-payload').length === 1) {
        return { ok: true, state: 'success', data: { identityRetryHint: 'expand please' } }
      }
      return { ok: true, state: 'success', data: { ok: true } }
    }
    return { ok: true, state: 'success', data: {} }
  }
  const llm = {
    stream: (options) => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'text-delta', index: 0, text: '{"daily_summary": "ok"}' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }),
  }
  const result = await plugin.dispatchMemoryRoutes('dream/run', {
    from: 'alice',
    date: '2026-08-19',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
  }, { run, llm })
  assert.equal(result.ok, true)
  assert.equal(result.data.kind, 'completed')
  const commits = seen.filter((entry) => Array.isArray(entry) && entry[0] === 'commit-payload')
  assert.equal(commits.length, 2) // initial commit + identity expansion retry
  assert.equal(commits[0][1].outputText, '{"daily_summary": "ok"}')
})

test('dream/run handles the fragments path and refuses without a provider', async () => {
  const run = async (args) => {
    const verb = args[1]
    if (verb === 'plan') {
      return {
        ok: true,
        state: 'success',
        data: {
          kind: 'fragments',
          fragments: [{ fragmentKey: 'session:s1:0', system: 's', user: 'u', maxOutputTokens: 1024 }],
          cachedFragmentKeys: [],
        },
      }
    }
    if (verb === 'synthesize') {
      const fileFlag = args.indexOf('--payload-file')
      const file = JSON.parse(await readFile(args[fileFlag + 1], 'utf8'))
      assert.equal(typeof file.fragmentOutputs['session:s1:0'], 'string')
      return { ok: true, state: 'success', data: { kind: 'prompt', system: 'sys', user: 'usr' } }
    }
    return { ok: true, state: 'success', data: { ok: true } }
  }
  const llm = {
    stream: () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'text-delta', index: 0, text: '{"daily_summary":"x"}' }
      },
    }),
  }
  const result = await plugin.dispatchMemoryRoutes('dream/run', {
    from: 'alice',
    date: '2026-08-19',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
  }, { run, llm })
  assert.equal(result.ok, true)

  const refused = await plugin.dispatchMemoryRoutes('dream/run', { from: 'alice', date: '2026-08-19' }, {
    run: async () => ({ ok: true, state: 'success', data: { profile: {} } }),
    llm,
  })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'missing_llm')
})

test('unknown methods fall through', async () => {
  const result = await plugin.dispatchMemoryRoutes('bots/list', {})
  assert.equal(result, undefined)
})
