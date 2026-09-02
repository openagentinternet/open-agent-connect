/**
 * Memory / dream / twin / user routes — the CLI-backed surface for the
 * Settings Memory and User panels plus the host-side dream runner. Every
 * handler forwards to a `metabot` verb through the injected run function;
 * `dream/run` is the one orchestrated route: it drives plan → ctx.llm →
 * commit (with fragment and self-identity retry loops) in-process.
 */
import { runMetabot, type MetabotCommandResult } from './cli-bridge.js'
import {
  missing,
  readFrom,
  readTrimmed,
  requireFrom,
  runMetabotWithPayloadFile,
  type RunFn,
} from './cli-payload.js'
import { generateLlmText, type LlmStreamLike } from './llm-generate.js'
import {
  localDreamSelfIdentity,
  localDreamStatus,
  localDreamSummaries,
  localImpressionsList,
  localImpressionsShow,
  localKnowledgeList,
  localMemoryList,
  localMemoryPolicyGet,
  localMemoryStats,
  localTwinCurrent,
  localUserWho,
} from './local-read.js'

const LIST_TIMEOUT_MS = 30_000
const DREAM_CLI_TIMEOUT_MS = 120_000

export interface MemoryRouteDeps {
  run?: RunFn
  llm?: LlmStreamLike
}

function failure(code: string, message: string): MetabotCommandResult {
  return { ok: false, state: 'failed', code, message }
}

/**
 * Best-effort fail marking for the cross-process dream runner: plan/commit
 * run in short-lived CLI processes while the LLM call happens here, so an
 * LLM/transport failure would otherwise leave the run `running` in the store
 * forever (the due algorithm skips `running` dates). `dream fail` itself is a
 * no-op unless the date's run is still live, and this helper never throws.
 */
async function markDreamRunFailed(
  run: RunFn,
  from: string,
  date: string,
  error: string,
): Promise<void> {
  await runMetabotWithPayloadFile(
    ['dream', 'fail', '--from', from],
    { date, error },
    '--payload-file',
    [],
    run,
    { timeoutMs: LIST_TIMEOUT_MS },
  ).catch(() => undefined)
}

function payloadObject(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {}
}

function objectOf(payload: unknown, key: string): Record<string, unknown> | undefined {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const value = (payload as Record<string, unknown>)[key]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function withFrom(args: string[], payload: unknown): string[] | MetabotCommandResult {
  const from = requireFrom(payload)
  if (typeof from !== 'string') return from
  return [...args, '--from', from]
}

/**
 * dream plan → LLM → (fragments) → commit, with one identity-expansion retry.
 * When the primary provider/model attempt fails and the Bot profile carries a
 * DSH fallback pair, the whole attempt is retried once on the fallback
 * (IDBots `runWithLlmFallback` parity; `dream commit` is idempotent per date).
 */
export async function runDreamWithLlm(
  payload: unknown,
  run: RunFn,
  llm: LlmStreamLike,
): Promise<MetabotCommandResult> {
  const body = payloadObject(payload)
  const from = requireFrom(payload)
  if (typeof from !== 'string') return from
  const date = readTrimmed(payload, 'date')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    return missing('missing_date', 'date (YYYY-MM-DD) is required')
  }
  let provider = readTrimmed(payload, 'provider')
  let model = readTrimmed(payload, 'model')
  let fallbackProvider = readTrimmed(payload, 'fallbackProvider')
  let fallbackModel = readTrimmed(payload, 'fallbackModel')
  // One profile fetch covers both pairs: the fallback pair decides whether a
  // retry is even possible, so it must be known before the first attempt runs.
  if (!provider || !model || !fallbackProvider || !fallbackModel) {
    const show = await run(['bot', 'show', '--from', from], { timeoutMs: LIST_TIMEOUT_MS })
    const profile = show.ok && show.data && typeof show.data === 'object'
      ? (show.data as { profile?: Record<string, unknown> }).profile
      : undefined
    provider = provider || readTrimmed({ dshLlmProvider: profile?.dshLlmProvider }, 'dshLlmProvider')
    model = model || readTrimmed({ dshLlmModel: profile?.dshLlmModel }, 'dshLlmModel')
    fallbackProvider = fallbackProvider
      || readTrimmed({ dshLlmFallbackProvider: profile?.dshLlmFallbackProvider }, 'dshLlmFallbackProvider')
    fallbackModel = fallbackModel
      || readTrimmed({ dshLlmFallbackModel: profile?.dshLlmFallbackModel }, 'dshLlmFallbackModel')
  }
  if (!provider || !model) {
    return failure('missing_llm', 'No DSH LLM provider/model on this Bot; pass provider+model or set them on the Bot profile.')
  }
  const attempt = await dreamAttempt(body, from, date, provider, model, run, llm)
  if (attempt.ok) return attempt
  if (!fallbackProvider || !fallbackModel || (fallbackProvider === provider && fallbackModel === model)) {
    return attempt
  }
  const retried = await dreamAttempt(body, from, date, fallbackProvider, fallbackModel, run, llm)
  if (retried.ok) {
    return {
      ...retried,
      data: {
        ...payloadObject(retried.data),
        fallbackUsed: true,
        llm: `${fallbackProvider}/${fallbackModel}`,
      },
    }
  }
  return retried
}

/** One full plan → LLM → commit pass; LLM stream throws become failure results. */
async function dreamAttempt(
  body: Record<string, unknown>,
  from: string,
  date: string,
  provider: string,
  model: string,
  run: RunFn,
  llm: LlmStreamLike,
): Promise<MetabotCommandResult> {
  try {
    const limits = body.limits && typeof body.limits === 'object' && !Array.isArray(body.limits)
      ? body.limits as Record<string, unknown>
      : undefined
    const llmTag = `${provider}/${model}`

    const plan = await runMetabotWithPayloadFile(
      ['dream', 'plan', '--from', from, '--date', date],
      { llm: llmTag, ...(limits ? { limits } : {}) },
      '--payload-file',
      [],
      run,
      { timeoutMs: DREAM_CLI_TIMEOUT_MS },
    )
    if (!plan.ok) {
      await markDreamRunFailed(run, from, date, plan.message ?? plan.code ?? 'dream plan failed')
      return plan
    }
    const planData = plan.data as {
      kind?: string
      system?: string
      user?: string
      maxOutputTokens?: number
      fragments?: Array<{
        fragmentKey: string
        system: string
        user: string
        maxOutputTokens?: number
      }>
    }
    if (planData.kind === 'empty') {
      return { ok: true, state: 'success', data: { kind: 'empty', date } }
    }

    let prompt: { system: string; user: string; maxOutputTokens?: number }
    if (planData.kind === 'fragments') {
      const fragmentOutputs: Record<string, string> = {}
      for (const fragment of planData.fragments ?? []) {
        fragmentOutputs[fragment.fragmentKey] = await generateLlmText(llm, {
          provider,
          model,
          system: fragment.system,
          user: fragment.user,
          ...(fragment.maxOutputTokens !== undefined ? { maxTokens: fragment.maxOutputTokens } : {}),
        })
      }
      const synthesis = await runMetabotWithPayloadFile(
        ['dream', 'synthesize', '--from', from],
        { date, llm: llmTag, fragmentOutputs, ...(limits ? { limits } : {}) },
        '--payload-file',
        [],
        run,
        { timeoutMs: DREAM_CLI_TIMEOUT_MS },
      )
      if (!synthesis.ok) {
        await markDreamRunFailed(run, from, date, synthesis.message ?? synthesis.code ?? 'dream synthesize failed')
        return synthesis
      }
      prompt = synthesis.data as { system: string; user: string; maxOutputTokens?: number }
    } else if (planData.kind === 'prompt' && planData.system && planData.user) {
      prompt = { system: planData.system, user: planData.user, maxOutputTokens: planData.maxOutputTokens }
    } else {
      await markDreamRunFailed(run, from, date, 'dream plan returned an unexpected shape')
      return failure('dream_plan_invalid', 'dream plan returned an unexpected shape')
    }

    const commitOnce = async (userText: string): Promise<MetabotCommandResult> => {
      const outputText = await generateLlmText(llm, {
        provider,
        model,
        system: prompt.system,
        user: userText,
        ...(prompt.maxOutputTokens !== undefined ? { maxTokens: prompt.maxOutputTokens } : {}),
      })
      return runMetabotWithPayloadFile(
        ['dream', 'commit', '--from', from],
        { date, outputText, llm: llmTag, ...(body.isRepair === true ? { isRepair: true } : {}) },
        '--payload-file',
        [],
        run,
        { timeoutMs: DREAM_CLI_TIMEOUT_MS },
      )
    }

    let commit = await commitOnce(prompt.user)
    if (!commit.ok) {
      await markDreamRunFailed(run, from, date, commit.message ?? commit.code ?? 'dream commit failed')
      return commit
    }
    let commitData = commit.data as { identityRetryHint?: string }
    if (typeof commitData.identityRetryHint === 'string' && commitData.identityRetryHint) {
      // Self-identity expansion retry: commit is idempotent per date.
      commit = await commitOnce(`${prompt.user}\n\n${commitData.identityRetryHint}`)
      if (!commit.ok) {
        await markDreamRunFailed(run, from, date, commit.message ?? commit.code ?? 'dream commit failed')
        return commit
      }
      commitData = commit.data as { identityRetryHint?: string }
    }
    return {
      ok: true,
      state: 'success',
      data: { kind: 'completed', date, commit: commitData },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await markDreamRunFailed(run, from, date, message)
    return failure('llm_error', message)
  }
}

/**
 * Memory/dream/twin/user route table. Returns undefined when the method does
 * not belong to this surface (the caller then falls through).
 */
export async function dispatchMemoryRoutes(
  method: string,
  payload: unknown,
  deps: MemoryRouteDeps = {},
): Promise<MetabotCommandResult | undefined> {
  const run = deps.run ?? runMetabot
  const body = payloadObject(payload)

  // ---- memory reads/writes ------------------------------------------------
  if (method === 'memory/list') {
    const from = readTrimmed(payload, 'from')
    if (from) {
      const local = await localMemoryList(from, body)
      if (local) return local
    }
    const args = withFrom(['memory', 'list'], payload)
    if (!Array.isArray(args)) return args
    for (const [flag, key] of [
      ['--scope-kind', 'scopeKind'],
      ['--scope-key', 'scopeKey'],
      ['--usage-class', 'usageClass'],
      ['--status', 'status'],
      ['--origin', 'origin'],
      ['--query', 'query'],
    ] as const) {
      const value = readTrimmed(payload, key)
      if (value) args.push(flag, value)
    }
    if (typeof body.limit === 'number') args.push('--limit', String(Math.trunc(body.limit)))
    if (body.includeDeleted === true) args.push('--include-deleted')
    return run(args, { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'memory/add' || method === 'memory/update' || method === 'memory/delete') {
    const verb = method.slice('memory/'.length)
    const from = requireFrom(payload)
    if (typeof from !== 'string') return from
    const entry = objectOf(payload, 'entry') ?? body
    return runMetabotWithPayloadFile(['memory', verb, '--from', from], entry, '--payload-file', [], run)
  }
  if (method === 'memory/scopes' || method === 'memory/stats') {
    if (method === 'memory/stats') {
      const from = readTrimmed(payload, 'from')
      if (from) {
        const local = await localMemoryStats(from, body)
        if (local) return local
      }
    }
    const args = withFrom(['memory', method.slice('memory/'.length)], payload)
    if (!Array.isArray(args)) return args
    const scopeKind = readTrimmed(payload, 'scopeKind')
    const scopeKey = readTrimmed(payload, 'scopeKey')
    if (scopeKind) args.push('--scope-kind', scopeKind)
    if (scopeKey) args.push('--scope-key', scopeKey)
    return run(args, { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'memory/blocks' || method === 'memory/extract' || method === 'memory/recall'
    || method === 'memory/search' || method === 'memory/transcript/append') {
    const from = requireFrom(payload)
    if (typeof from !== 'string') return from
    const verb = method === 'memory/transcript/append' ? 'transcript append' : method.slice('memory/'.length)
    const args = ['memory', ...verb.split(' '), '--from', from]
    return runMetabotWithPayloadFile(args, body, '--payload-file', [], run)
  }
  if (method === 'memory/chats') {
    const args = withFrom(['memory', 'chats'], payload)
    if (!Array.isArray(args)) return args
    if (typeof body.limit === 'number') args.push('--limit', String(Math.trunc(body.limit)))
    const sortOrder = readTrimmed(payload, 'sortOrder')
    if (sortOrder) args.push('--sort-order', sortOrder)
    return run(args, { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'memory/policy/get' || method === 'memory/policy/delete') {
    if (method === 'memory/policy/get') {
      const from = readTrimmed(payload, 'from')
      if (from) {
        const local = await localMemoryPolicyGet(from)
        if (local) return local
      }
    }
    const args = withFrom(['memory', 'policy', method.endsWith('/get') ? 'get' : 'delete'], payload)
    if (!Array.isArray(args)) return args
    return run(args, { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'memory/policy/set') {
    const from = requireFrom(payload)
    if (typeof from !== 'string') return from
    const patch = objectOf(payload, 'patch') ?? {}
    return runMetabotWithPayloadFile(['memory', 'policy', 'set', '--from', from], patch, '--payload-file', [], run)
  }
  if (method === 'memory/knowledge/list') {
    const from = readTrimmed(payload, 'from')
    if (from) {
      const local = await localKnowledgeList(from, body)
      if (local) return local
    }
    const args = withFrom(['memory', 'knowledge', 'list'], payload)
    if (!Array.isArray(args)) return args
    for (const [flag, key] of [['--kind', 'kind'], ['--category', 'category'], ['--status', 'status'], ['--query', 'query']] as const) {
      const value = readTrimmed(payload, key)
      if (value) args.push(flag, value)
    }
    if (typeof body.limit === 'number') args.push('--limit', String(Math.trunc(body.limit)))
    return run(args, { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'memory/knowledge/upsert' || method === 'memory/knowledge/update'
    || method === 'memory/knowledge/archive' || method === 'memory/knowledge/delete') {
    const from = requireFrom(payload)
    if (typeof from !== 'string') return from
    const verb = method.slice('memory/knowledge/'.length)
    const entry = objectOf(payload, 'entry') ?? body
    return runMetabotWithPayloadFile(['memory', 'knowledge', verb, '--from', from], entry, '--payload-file', [], run)
  }
  if (method === 'memory/impressions/list') {
    const from = readTrimmed(payload, 'from')
    if (from) {
      const local = await localImpressionsList(from)
      if (local) return local
    }
    const args = withFrom(['memory', 'impressions', 'list'], payload)
    if (!Array.isArray(args)) return args
    return run(args, { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'memory/impressions/show') {
    const subject = readTrimmed(payload, 'subject')
    const from = readTrimmed(payload, 'from')
    if (from && subject) {
      const local = await localImpressionsShow(from, subject)
      if (local) return local
    }
    const args = withFrom(['memory', 'impressions', 'show'], payload)
    if (!Array.isArray(args)) return args
    if (!subject) return missing('missing_subject', 'subject is required')
    args.push('--subject', subject)
    return run(args, { timeoutMs: LIST_TIMEOUT_MS })
  }

  // ---- dream --------------------------------------------------------------
  if (method === 'dream/due' || method === 'dream/status' || method === 'dream/self-identity') {
    const from = readTrimmed(payload, 'from')
    if (from && method === 'dream/status') {
      const local = await localDreamStatus(from)
      if (local) return local
    }
    if (from && method === 'dream/self-identity') {
      const local = await localDreamSelfIdentity(from)
      if (local) return local
    }
    const args = withFrom(['dream', method.slice('dream/'.length)], payload)
    if (!Array.isArray(args)) return args
    return run(args, { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'dream/summaries') {
    const from = readTrimmed(payload, 'from')
    if (from) {
      const local = await localDreamSummaries(from, typeof body.limit === 'number' ? body.limit : undefined)
      if (local) return local
    }
    const args = withFrom(['dream', 'summaries'], payload)
    if (!Array.isArray(args)) return args
    if (typeof body.limit === 'number') args.push('--limit', String(Math.trunc(body.limit)))
    const before = readTrimmed(payload, 'before')
    if (before) args.push('--before', before)
    return run(args, { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'dream/run') {
    if (!deps.llm) {
      return failure('llm_unavailable', 'The DSH llm service is not available to this plugin.')
    }
    return runDreamWithLlm(payload, run, deps.llm)
  }

  // ---- twin ---------------------------------------------------------------
  if (method === 'twin/current') {
    const local = await localTwinCurrent()
    if (local) return local
    return run(['twin', 'current'], { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'twin/workers') {
    const from = readFrom(payload)
    const args = from ? ['twin', 'workers', '--from', from] : ['twin', 'workers']
    return run(args, { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'twin/tasks/list') {
    const args = withFrom(['twin', 'tasks', 'list'], payload)
    if (!Array.isArray(args)) return args
    const status = readTrimmed(payload, 'status')
    if (status) args.push('--status', status)
    if (typeof body.limit === 'number') args.push('--limit', String(Math.trunc(body.limit)))
    return run(args, { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'twin/tasks/show') {
    const args = withFrom(['twin', 'tasks', 'show'], payload)
    if (!Array.isArray(args)) return args
    const taskId = readTrimmed(payload, 'taskId')
    if (!taskId) return missing('missing_task_id', 'taskId is required')
    args.push('--task-id', taskId)
    return run(args, { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'twin/tasks/create' || method === 'twin/tasks/update') {
    const from = requireFrom(payload)
    if (typeof from !== 'string') return from
    const verb = method.slice('twin/tasks/'.length)
    const entry = objectOf(payload, 'task') ?? body
    return runMetabotWithPayloadFile(['twin', 'tasks', verb, '--from', from], entry, '--payload-file', [], run)
  }

  // ---- user (local human owner identity) ---------------------------------
  if (method === 'user/who') {
    const local = await localUserWho()
    if (local) return local
    return run(['user', 'who'], { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'user/create') {
    const name = readTrimmed(payload, 'name')
    return run(['user', 'create', '--name', name || 'User'], { timeoutMs: 60_000 })
  }
  if (method === 'user/import') {
    const mnemonic = readTrimmed(payload, 'mnemonic')
    if (!mnemonic) return missing('missing_mnemonic', 'mnemonic is required')
    const name = readTrimmed(payload, 'name')
    const derivationPath = readTrimmed(payload, 'path')
    const args = ['user', 'import', '--mnemonic', mnemonic]
    if (name) args.push('--name', name)
    if (derivationPath) args.push('--path', derivationPath)
    return run(args, { timeoutMs: 60_000 })
  }
  if (method === 'user/ensure') {
    const name = readTrimmed(payload, 'name')
    const args = ['user', 'ensure']
    if (name) args.push('--name', name)
    return run(args, { timeoutMs: 60_000 })
  }
  if (method === 'user/rename') {
    const name = readTrimmed(payload, 'name')
    if (!name) return missing('missing_name', 'name is required')
    return run(['user', 'rename', '--name', name], { timeoutMs: 60_000 })
  }
  if (method === 'user/reveal') {
    return run(['user', 'reveal'], { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'user/delete') {
    return run(['user', 'delete'], { timeoutMs: 60_000 })
  }
  return undefined
}
