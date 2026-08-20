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

const LIST_TIMEOUT_MS = 30_000
const DREAM_CLI_TIMEOUT_MS = 120_000

export interface MemoryRouteDeps {
  run?: RunFn
  llm?: LlmStreamLike
}

function failure(code: string, message: string): MetabotCommandResult {
  return { ok: false, state: 'failed', code, message }
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

/** dream plan → LLM → (fragments) → commit, with one identity-expansion retry. */
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
  if (!provider || !model) {
    const show = await run(['bot', 'show', '--from', from], { timeoutMs: LIST_TIMEOUT_MS })
    const profile = show.ok && show.data && typeof show.data === 'object'
      ? (show.data as { profile?: Record<string, unknown> }).profile
      : undefined
    provider = provider || readTrimmed({ dshLlmProvider: profile?.dshLlmProvider }, 'dshLlmProvider')
    model = model || readTrimmed({ dshLlmModel: profile?.dshLlmModel }, 'dshLlmModel')
  }
  if (!provider || !model) {
    return failure('missing_llm', 'No DSH LLM provider/model on this Bot; pass provider+model or set them on the Bot profile.')
  }
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
  )
  if (!plan.ok) return plan
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
    )
    if (!synthesis.ok) return synthesis
    prompt = synthesis.data as { system: string; user: string; maxOutputTokens?: number }
  } else if (planData.kind === 'prompt' && planData.system && planData.user) {
    prompt = { system: planData.system, user: planData.user, maxOutputTokens: planData.maxOutputTokens }
  } else {
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
    )
  }

  let commit = await commitOnce(prompt.user)
  if (!commit.ok) return commit
  let commitData = commit.data as { identityRetryHint?: string }
  if (typeof commitData.identityRetryHint === 'string' && commitData.identityRetryHint) {
    // Self-identity expansion retry: commit is idempotent per date.
    commit = await commitOnce(`${prompt.user}\n\n${commitData.identityRetryHint}`)
    if (!commit.ok) return commit
    commitData = commit.data as { identityRetryHint?: string }
  }
  return {
    ok: true,
    state: 'success',
    data: { kind: 'completed', date, commit: commitData },
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
    const args = withFrom(['memory', 'impressions', 'list'], payload)
    if (!Array.isArray(args)) return args
    return run(args, { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'memory/impressions/show') {
    const args = withFrom(['memory', 'impressions', 'show'], payload)
    if (!Array.isArray(args)) return args
    const subject = readTrimmed(payload, 'subject')
    if (!subject) return missing('missing_subject', 'subject is required')
    args.push('--subject', subject)
    return run(args, { timeoutMs: LIST_TIMEOUT_MS })
  }

  // ---- dream --------------------------------------------------------------
  if (method === 'dream/due' || method === 'dream/status' || method === 'dream/self-identity') {
    const args = withFrom(['dream', method.slice('dream/'.length)], payload)
    if (!Array.isArray(args)) return args
    return run(args, { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'dream/summaries') {
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

  // ---- user ---------------------------------------------------------------
  if (method === 'user/who') {
    return run(['identity', 'who'], { timeoutMs: LIST_TIMEOUT_MS })
  }
  if (method === 'user/bind' || method === 'user/unbind') {
    const slug = readTrimmed(payload, 'slug')
    if (!slug) return missing('missing_slug', 'slug is required')
    const args = ['bot', 'bind-owner', '--from', slug]
    if (method === 'user/unbind') {
      args.push('--unbind')
    } else {
      const owner = readTrimmed(payload, 'ownerGlobalMetaId')
      if (owner) args.push('--owner', owner)
    }
    return run(args, { timeoutMs: 60_000 })
  }
  return undefined
}
