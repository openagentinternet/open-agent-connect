import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// These tests assert the CLI verb mapping through the mocked `run`; disable
// the in-process local-read fast path so every route exercises the CLI path.
process.env.OAC_DSH_NO_LOCAL_READ = '1'

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

test('user identity routes and twin routes map to CLI verbs', async () => {
  const who = await capture('user/who', {})
  assert.deepEqual(who.calls[0], ['user', 'who'])
  const create = await capture('user/create', { name: 'Alice' })
  assert.deepEqual(create.calls[0], ['user', 'create', '--name', 'Alice'])
  const importRoute = await capture('user/import', { name: 'Alice', mnemonic: 'a b c', path: "m/44'/10001'/0'/0/1" })
  assert.ok(importRoute.calls[0].includes('--mnemonic'))
  assert.ok(importRoute.calls[0].includes('--path'))
  const missingMnemonic = await capture('user/import', { name: 'Alice' })
  assert.equal(missingMnemonic.result.code, 'missing_mnemonic')
  const rename = await capture('user/rename', { name: 'Alicia' })
  assert.deepEqual(rename.calls[0], ['user', 'rename', '--name', 'Alicia'])
  const reveal = await capture('user/reveal', {})
  assert.deepEqual(reveal.calls[0], ['user', 'reveal'])
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

test('dream/run disables reasoning and forwards declared model limits to the plan', async () => {
  const seen = []
  const run = async (args) => {
    seen.push(args)
    if (args[1] === 'plan') {
      const fileFlag = args.indexOf('--payload-file')
      const file = JSON.parse(await readFile(args[fileFlag + 1], 'utf8'))
      seen.push(['plan-payload', file])
      return { ok: true, state: 'success', data: { kind: 'prompt', system: 'sys', user: 'usr', maxOutputTokens: 4096 } }
    }
    return { ok: true, state: 'success', data: { ok: true } }
  }
  const llmCalls = []
  const llm = {
    resolveModelInfo: async () => ({
      context: { contextWindow: 131072 },
      defaultMaxTokens: 32768,
      reasoning: { efforts: [{ id: 'off' }, { id: 'high' }] },
    }),
    stream: (options) => {
      llmCalls.push(options)
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'text-delta', index: 0, text: '{"daily_summary": "ok"}' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    },
  }
  const result = await plugin.dispatchMemoryRoutes('dream/run', {
    from: 'alice',
    date: '2026-08-19',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  }, { run, llm })
  assert.equal(result.ok, true)
  assert.equal(llmCalls.length, 1)
  assert.equal(llmCalls[0].reasoningEffort, 'off')
  const planPayload = seen.find((entry) => Array.isArray(entry) && entry[0] === 'plan-payload')
  assert.deepEqual(planPayload[1].limits, { contextWindow: 131072, maxOutputTokens: 32768 })
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

test('dream/run retries a failed attempt on the fallback LLM pair', async () => {
  const calls = []
  const llmCalls = []
  const run = async (args) => {
    calls.push(args)
    const verb = args[1]
    if (verb === 'plan') return { ok: true, state: 'success', data: { kind: 'prompt', system: 'sys', user: 'usr' } }
    return { ok: true, state: 'success', data: { ok: true } }
  }
  const llm = {
    stream: (options) => {
      llmCalls.push(options)
      if (options.provider === 'deepseek') {
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'finish', reason: { kind: 'error', failure: { message: 'primary down' } } }
          },
        }
      }
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'text-delta', index: 0, text: '{"daily_summary":"ok"}' }
        },
      }
    },
  }
  const result = await plugin.dispatchMemoryRoutes('dream/run', {
    from: 'alice',
    date: '2026-08-19',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    fallbackProvider: 'ollama',
    fallbackModel: 'qwen3',
  }, { run, llm })
  assert.equal(result.ok, true)
  assert.equal(result.data.kind, 'completed')
  assert.equal(result.data.fallbackUsed, true)
  assert.equal(result.data.llm, 'ollama/qwen3')
  assert.equal(llmCalls.length, 2)
  assert.equal(llmCalls[0].provider, 'deepseek')
  assert.equal(llmCalls[1].provider, 'ollama')
  // Both pairs came from the payload, so no profile fetch was needed.
  assert.ok(calls.every((args) => args[1] !== 'show'))
})

test('dream/run learns the fallback pair from one bot show fetch', async () => {
  let botShowCalls = 0
  const llmCalls = []
  const run = async (args) => {
    const verb = args[1]
    if (verb === 'show') {
      botShowCalls += 1
      return {
        ok: true,
        state: 'success',
        data: {
          profile: {
            dshLlmProvider: 'deepseek',
            dshLlmModel: 'deepseek-v4-flash',
            dshLlmFallbackProvider: 'ollama',
            dshLlmFallbackModel: 'qwen3',
          },
        },
      }
    }
    if (verb === 'plan') return { ok: true, state: 'success', data: { kind: 'prompt', system: 'sys', user: 'usr' } }
    return { ok: true, state: 'success', data: { ok: true } }
  }
  const llm = {
    stream: (options) => {
      llmCalls.push(options)
      if (options.provider === 'deepseek') {
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'finish', reason: { kind: 'error', failure: { message: 'primary down' } } }
          },
        }
      }
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'text-delta', index: 0, text: '{"daily_summary":"ok"}' }
        },
      }
    },
  }
  const result = await plugin.dispatchMemoryRoutes('dream/run', { from: 'alice', date: '2026-08-19' }, { run, llm })
  assert.equal(result.ok, true)
  assert.equal(result.data.fallbackUsed, true)
  assert.equal(botShowCalls, 1)
  assert.deepEqual(llmCalls.map((call) => call.provider), ['deepseek', 'ollama'])
})

test('dream/run surfaces the primary failure when no fallback pair exists', async () => {
  const run = async (args) => {
    const verb = args[1]
    if (verb === 'show') {
      return { ok: true, state: 'success', data: { profile: { dshLlmProvider: 'deepseek', dshLlmModel: 'deepseek-v4-flash' } } }
    }
    if (verb === 'plan') return { ok: true, state: 'success', data: { kind: 'prompt', system: 'sys', user: 'usr' } }
    return { ok: true, state: 'success', data: { ok: true } }
  }
  const llm = {
    stream: () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'primary down' } } }
      },
    }),
  }
  const result = await plugin.dispatchMemoryRoutes('dream/run', { from: 'alice', date: '2026-08-19' }, { run, llm })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'llm_error')
  assert.equal(result.message, 'primary down')
})

test('dream/run passes the 120s dream timeout to plan, synthesize, and commit', async () => {
  const seen = []
  const run = async (args, options) => {
    seen.push({ args, options })
    const verb = args[1]
    if (verb === 'plan') {
      return {
        ok: true,
        state: 'success',
        data: {
          kind: 'fragments',
          fragments: [{ fragmentKey: 'session:s1:0', system: 's', user: 'u' }],
        },
      }
    }
    if (verb === 'synthesize') return { ok: true, state: 'success', data: { kind: 'prompt', system: 'sys', user: 'usr' } }
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
    fallbackProvider: 'ollama',
    fallbackModel: 'qwen3',
  }, { run, llm })
  assert.equal(result.ok, true)
  for (const verb of ['plan', 'synthesize', 'commit']) {
    const call = seen.find((entry) => entry.args[1] === verb)
    assert.ok(call, `expected a ${verb} call`)
    assert.equal(call.options.timeoutMs, 120_000)
  }
})

test('dream/run marks the store run failed when the attempt dies', async () => {
  const failCalls = []
  const run = async (args) => {
    const verb = args[1]
    if (verb === 'fail') {
      const fileFlag = args.indexOf('--payload-file')
      failCalls.push(JSON.parse(await readFile(args[fileFlag + 1], 'utf8')))
      return { ok: true, state: 'success', data: { failed: true } }
    }
    if (verb === 'plan') return { ok: true, state: 'success', data: { kind: 'prompt', system: 'sys', user: 'usr' } }
    return { ok: true, state: 'success', data: { ok: true } }
  }
  const llm = {
    stream: () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'primary down' } } }
      },
    }),
  }
  const result = await plugin.dispatchMemoryRoutes('dream/run', {
    from: 'alice',
    date: '2026-08-19',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
  }, { run, llm })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'llm_error')
  assert.equal(failCalls.length, 1)
  assert.equal(failCalls[0].date, '2026-08-19')
  assert.equal(failCalls[0].error, 'primary down')
})

test('dream/run never touches the fail route on success or on empty days', async () => {
  const verbs = []
  const run = async (args) => {
    verbs.push(args[1])
    if (args[1] === 'plan') return { ok: true, state: 'success', data: { kind: 'prompt', system: 's', user: 'u' } }
    return { ok: true, state: 'success', data: { ok: true } }
  }
  const llm = {
    stream: () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'text-delta', index: 0, text: '{"daily_summary":"ok"}' }
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
  assert.ok(!verbs.includes('fail'))
})

test('hygiene routes, memory unarchive, and archived list flag map to CLI verbs', async () => {
  const status = await capture('memory/hygiene/status', { from: 'alice' })
  assert.deepEqual(status.calls[0].slice(0, 5), ['memory', 'hygiene', 'status', '--from', 'alice'])

  const due = await capture('memory/hygiene/due', { from: 'alice' })
  assert.deepEqual(due.calls[0].slice(0, 5), ['memory', 'hygiene', 'due', '--from', 'alice'])

  const run = await capture('memory/hygiene/run', { from: 'alice', noDeep: true })
  assert.deepEqual(run.calls[0], ['memory', 'hygiene', 'run', '--from', 'alice', '--no-deep'])
  const runDefault = await capture('memory/hygiene/run', { from: 'alice' })
  assert.deepEqual(runDefault.calls[0], ['memory', 'hygiene', 'run', '--from', 'alice'])

  const configGet = await capture('memory/hygiene/config-get', { from: 'alice' })
  assert.deepEqual(configGet.calls[0].slice(0, 6), ['memory', 'hygiene', 'config', 'get', '--from', 'alice'])

  const configSet = await capture('memory/hygiene/config-set', { from: 'alice', config: { memoryDecayDays: 90 } })
  assert.deepEqual(configSet.result.data.file, { memoryDecayDays: 90 })
  assert.deepEqual(configSet.calls[0].slice(0, 6), ['memory', 'hygiene', 'config', 'set', '--from', 'alice'])

  const unarchive = await capture('memory/unarchive', { from: 'alice', id: 'mem_1' })
  assert.equal(unarchive.result.data.file.id, 'mem_1')
  assert.deepEqual(unarchive.calls[0].slice(0, 3), ['memory', 'unarchive', '--from'])

  const archived = await capture('memory/list', { from: 'alice', includeArchived: true })
  assert.ok(archived.calls[0].includes('--include-archived'))
  const plain = await capture('memory/list', { from: 'alice' })
  assert.ok(!plain.calls[0].includes('--include-archived'))
})
