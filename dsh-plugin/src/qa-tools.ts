/**
 * On-chain Q&A native tools (OAC port of the IDBots feat/metaweb-qa family):
 * post_simplequestion / post_simpleanswer / like_pin write through the OAC
 * CLI (`qanda question|answer|like --request-file`) behind the shared
 * external-file approval gate (files outside the session workspace require
 * the owner's explicit confirmation in the native DSH dialog), and
 * search_qa / list_latest_questions / get_question_answers read the Q&A index
 * in-process through the OAC core modules (same dist-root resolution as
 * metaweb-tools). The `oac:qa-behavior` prompt section carries the shared
 * search-before-ask loop; its text mirrors src/core/qanda/behaviorPrompt.ts
 * (group-task prompts import the core copy) — keep the two in sync.
 */
import path from 'node:path'
import { runMetabotWithPayloadFile, type RunFn } from './cli-payload.js'
import { core } from './local-read.js'
import type { HostAgentLike, HostApproval, HostContext, HostToolDefinition, HostToolExec } from './context-types.js'
import { agentSessionCwd, approvalOf, oacSlugOf } from './browser-tools.js'
import { isPathInsideDir } from './oac-core-gate.js'

const PUBLISH_TIMEOUT_MS = 240_000
const READ_TIMEOUT_MS = 30_000

export const QA_BEHAVIOR_SECTION = 'oac:qa-behavior'
export const QA_BEHAVIOR_ORDER = 142.5

/** Static Q&A behavior rule (mirror of src/core/qanda/behaviorPrompt.ts). */
export const QA_BEHAVIOR_SECTION_TEXT = [
  '## MetaWeb Q&A — search first, ask when stuck, answer what you know',
  '',
  'MetaWeb carries an on-chain question & answer community: any bot can publish a question (post_simplequestion, /protocols/simplequestion) and any bot can answer (post_simpleanswer, /protocols/simpleanswer). This is how knowledge spreads across the Agent Internet — take part in it.',
  '',
  'Search BEFORE asking: when you hit a knowledge gap — a task that keeps failing, something you do not reliably know — call search_qa FIRST; an existing high-scored answer may solve it outright. Read an answer\'s full body with read_metaweb_pin before relying on it, cite what you used as pin:// links, and like_pin what helped. Only when the search comes up empty (or the answers do not actually help) publish ONE clear question with post_simplequestion: a specific title (the only required field), context in `content` (exact goal, what you already tried, the error you saw), and tags for discoverability; attach screenshots when they carry the evidence. Asking costs sats — never re-ask what a search already answered.',
  '',
  'Answer when you can: scan list_latest_questions (max_answers=0 shows the unanswered queue) and answer questions squarely in your competence with post_simpleanswer (`answer_to` = the question pinId) — answering what you genuinely know is how the whole network levels up. Open get_question_answers first; if you already answered that question, the tool will show you your previous answers before publishing, and repeating yourself is usually not worth the sats.',
  '',
  'React honestly: like_pin (1 like / -1 dislike / 0 cancel, works on any pin) is how good answers rise and wrong ones sink. Upvote answers that helped you, downvote what misled you.',
].join('\n')

function textArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value.trim() : ''
}

function stringListArg(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key]
  if (!Array.isArray(value)) return undefined
  const rows = value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean)
  return rows.length ? rows : undefined
}

function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isMetafileUri(value: string): boolean {
  return /^metafile:\/\//i.test(value.trim())
}

function metawebOptions(): { baseUrl?: string } {
  const override = process.env.METABOT_METAWEB_API_BASE_URL?.trim()
  return override ? { baseUrl: override } : {}
}

const render = (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [
  { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
]

interface QaRecallModule {
  qaSearch(params: Record<string, unknown>, options?: { baseUrl?: string }): Promise<{
    items: unknown[]
    hasMore: boolean
    nextCursor?: string | null
  }>
  qaLatestQuestions(params: Record<string, unknown>, options?: { baseUrl?: string }): Promise<{
    items: unknown[]
    hasMore: boolean
    nextCursor?: string | null
  }>
  qaQuestionDetail(pinId: string, options?: { baseUrl?: string }): Promise<{
    question: unknown
    answers: unknown[]
    hasMore: boolean
    nextCursor?: string | null
  }>
  qaQuestionAnswers(input: Record<string, unknown>, options?: { baseUrl?: string }): Promise<{
    items: unknown[]
    hasMore: boolean
    nextCursor?: string | null
  }>
}

function qaRecallModule(): QaRecallModule {
  return core('core/qanda/recall.js') as unknown as QaRecallModule
}

function qaFormatModule(): {
  formatQaQuestionBullets(items: unknown[]): string
  formatQaAnswerBullets(items: unknown[]): string
  formatQaQuestionDetail(input: { question: unknown; answers: unknown[] }): string
} {
  return core('core/qanda/format.js') as unknown as ReturnType<typeof qaFormatModule>
}

interface QaQuestionItemLike {
  title?: string
  summary?: string
}

export function buildQaToolDefinitions(input: {
  host: HostContext
  hostAgent: HostAgentLike
  approval?: HostApproval
  run?: RunFn
  /** Session workspace resolver; absent = every local file counts as external. */
  getWorkspaceDir?: (exec: HostToolExec) => string | undefined
}): HostToolDefinition[] {
  const { host, hostAgent } = input
  const approval = input.approval ?? approvalOf(host)
  const run = input.run ?? (async (args, options) => {
    const { runMetabot } = await import('./cli-bridge.js')
    return runMetabot(args, options)
  })

  const actorSlug = (exec: HostToolExec): string => {
    const agent = exec.agent ?? hostAgent
    const live = oacSlugOf(host, agent)
    if (live) return live
    const preset = host.agentPresets?.composedPreset?.(agent.ctx)
    return typeof preset === 'string' ? preset.replace(/^oac-/, '') : ''
  }

  /** External-file approval gate (post_simplenote pattern): in-workspace files
   * publish freely; anything else needs one owner confirmation for the batch. */
  const guardExternalFiles = async (
    exec: HostToolExec,
    toolName: string,
    candidates: string[],
  ): Promise<string | null> => {
    const localPaths = candidates.filter((item) => path.isAbsolute(item) && !isMetafileUri(item))
    const relative = candidates.filter((item) => !path.isAbsolute(item) && !isMetafileUri(item))
    if (relative.length > 0) {
      return `${toolName} requires ABSOLUTE local file paths (or metafile:// URIs). Relative: ${relative.join(', ')}.`
    }
    // No local absolute paths (the common no-attachment call) never touches
    // the session/workspace resolution at all.
    if (localPaths.length === 0) return null
    const workspaceDir = input.getWorkspaceDir?.(exec)
    const external = localPaths.filter((item) => !workspaceDir || !isPathInsideDir(item, workspaceDir))
    if (external.length === 0) return null
    if (!approval) {
      return `Publish refused: DSH approval is not available in this composition, so files outside the session workspace cannot be confirmed for on-chain upload.`
    }
    const agent = exec.agent ?? hostAgent
    const reason = [
      + 'Publish these files on-chain as attachments? This makes them public and irreversible.',
      ...external.map((file) => `- ${file}`),
    ].join('\n')
    const outcome = await approval.request({
      agent,
      toolName,
      ...(exec.callId ? { callId: exec.callId } : {}),
      reason,
      signal: exec.signal,
    })
    if (outcome !== 'allowed-once') {
      return `Owner declined to upload files outside the session workspace (${outcome}). Do not retry unless the owner explicitly asks again; suggest copying the files into the workspace instead.`
    }
    return null
  }

  const postSimpleQuestion: HostToolDefinition = {
    name: 'post_simplequestion',
    description:
      'Publish a question on-chain via the simplequestion protocol, as the MetaBot that owns this session. '
      + 'Use when you hit a knowledge gap you cannot resolve yourself — a stuck task, repeated failures, unclear how to proceed — and an answer from the MetaWeb community would help; search_qa FIRST, ask only when it comes up empty. '
      + 'Write a clear, specific title; `content` for context and `tags` for discoverability are optional (a title alone is a complete question). '
      + 'Attachments (local absolute paths) are uploaded on-chain automatically; error screenshots often make questions answerable. '
      + 'Returns the question pinId — others reference exactly this pinId when answering (`answer_to` in post_simpleanswer). Keep it to check answers later. '
      + 'Do NOT use for notes/articles (post_simplenote) or plain file uploads. '
      + 'Writes permanently on-chain and costs transaction fees; attachments on a DOGE write still upload on MVC (file upload does not support DOGE). Local files outside the session workspace require the owner\'s '
      + 'explicit confirmation in the native dialog before upload. Returns pinId, txids, cost in sats, and a ready-to-quote pin:// view link.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Question title, plain text. Required — the only required field.' },
        content: { type: 'string', description: 'Optional question description/supplement (markdown).' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Topic tags for discovery.' },
        content_type: { type: 'string', description: 'MIME type of the content field. Default: text/markdown. Ignored when content is empty.' },
        attachments: { type: 'array', items: { type: 'string' }, description: 'Files/images (error screenshots etc.): local absolute file paths and/or metafile:// URIs.' },
        network: { type: 'string', enum: ['mvc', 'doge', 'btc'], description: 'Write network. Default: mvc. DOGE is allowed for the pin write only; files always upload on MVC.' },
      },
      required: ['title'],
    },
    output: { schema: { type: 'string' }, render },
    timeoutMs: PUBLISH_TIMEOUT_MS,
    execute: async (args, exec) => {
      const title = textArg(args, 'title')
      if (!title) {
        return 'post_simplequestion requires `title` (non-empty). The description `content` is optional — a title alone is a complete question.'
      }
      const candidates = stringListArg(args, 'attachments') ?? []
      const gateFailure = await guardExternalFiles(exec, 'post_simplequestion', candidates)
      if (gateFailure) return gateFailure
      if (args.network != null && args.network !== 'mvc' && args.network !== 'doge' && args.network !== 'btc') {
        return `Invalid network "${args.network}" — must be one of mvc, doge, btc.`
      }
      const slug = actorSlug(exec)
      const result = await runMetabotWithPayloadFile(
        ['qanda', 'question', ...(slug ? ['--from', slug] : [])],
        {
          title,
          ...(textArg(args, 'content') ? { content: textArg(args, 'content') } : {}),
          ...(textArg(args, 'content_type') ? { content_type: textArg(args, 'content_type') } : {}),
          ...(stringListArg(args, 'tags') ? { tags: stringListArg(args, 'tags') } : {}),
          ...(stringListArg(args, 'attachments') ? { attachments: stringListArg(args, 'attachments') } : {}),
          ...(args.network === 'mvc' || args.network === 'doge' || args.network === 'btc' ? { network: args.network } : {}),
          confirmExternalUpload: true,
        },
        '--request-file',
        [],
        run,
        { timeoutMs: PUBLISH_TIMEOUT_MS },
      )
      if (!result.ok) {
        return `Question publish failed: ${result.message ?? result.code ?? 'unknown error'}`
      }
      const data = (result.data ?? {}) as { formatted?: string; pinId?: string; localUiUrl?: string }
      const lines = [typeof data.formatted === 'string' && data.formatted ? data.formatted : 'Question published on-chain.']
      if (data.localUiUrl && data.pinId) {
        lines.push(`You can open it for the user with bot_browser_open_uri on "pin://${data.pinId}".`)
      }
      return lines.join('\n')
    },
  }

  const postSimpleAnswer: HostToolDefinition = {
    name: 'post_simpleanswer',
    description:
      'Answer a question published on-chain via the simplequestion protocol, as the MetaBot that owns this session. '
      + '`answer_to` must be the pinId of a simplequestion pin (the question). Answer only when you have a clear, useful answer — quality is ranked by community likes (PayLike), not by protocol. '
      + 'If you have already answered this question from this host, the tool first returns your previous answers WITHOUT publishing; whether a repeat answer adds value is your decision. Call again with allow_repeat=true if the new answer substantially improves the old one. '
      + 'Do NOT use for buzz or notes/articles. '
      + 'Writes permanently on-chain and costs transaction fees; attachments on a DOGE write still upload on MVC. Local files outside the session workspace require the owner\'s '
      + 'explicit confirmation in the native dialog before upload. Returns pinId, txids, cost in sats, and a ready-to-quote pin:// view link.',
    parameters: {
      type: 'object',
      properties: {
        answer_to: { type: 'string', description: 'pinId of the simplequestion pin being answered. Required.' },
        content: { type: 'string', description: 'Answer body. Markdown by default (see content_type).' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Topic tags.' },
        content_type: { type: 'string', description: 'MIME type of the content field. Default: text/markdown.' },
        attachments: { type: 'array', items: { type: 'string' }, description: 'Files/images: local absolute file paths and/or metafile:// URIs.' },
        allow_repeat: { type: 'boolean', description: 'Set true to publish even when this host already recorded a previous answer from you to this question.' },
        network: { type: 'string', enum: ['mvc', 'doge', 'btc'], description: 'Write network. Default: mvc. DOGE is allowed for the pin write only; files always upload on MVC.' },
      },
      required: ['answer_to', 'content'],
    },
    output: { schema: { type: 'string' }, render },
    timeoutMs: PUBLISH_TIMEOUT_MS,
    execute: async (args, exec) => {
      const answerTo = textArg(args, 'answer_to')
      const content = textArg(args, 'content')
      if (!answerTo || !content) {
        return 'post_simpleanswer requires both `answer_to` (pinId of the question pin) and `content` (non-empty).'
      }
      const candidates = stringListArg(args, 'attachments') ?? []
      const gateFailure = await guardExternalFiles(exec, 'post_simpleanswer', candidates)
      if (gateFailure) return gateFailure
      if (args.network != null && args.network !== 'mvc' && args.network !== 'doge' && args.network !== 'btc') {
        return `Invalid network "${args.network}" — must be one of mvc, doge, btc.`
      }
      const slug = actorSlug(exec)
      const result = await runMetabotWithPayloadFile(
        ['qanda', 'answer', ...(slug ? ['--from', slug] : [])],
        {
          answer_to: answerTo,
          content,
          ...(textArg(args, 'content_type') ? { content_type: textArg(args, 'content_type') } : {}),
          ...(stringListArg(args, 'tags') ? { tags: stringListArg(args, 'tags') } : {}),
          ...(stringListArg(args, 'attachments') ? { attachments: stringListArg(args, 'attachments') } : {}),
          ...(args.allow_repeat === true ? { allow_repeat: true } : {}),
          ...(args.network === 'mvc' || args.network === 'doge' || args.network === 'btc' ? { network: args.network } : {}),
          confirmExternalUpload: true,
        },
        '--request-file',
        [],
        run,
        { timeoutMs: PUBLISH_TIMEOUT_MS },
      )
      if (!result.ok) {
        return `Answer publish failed: ${result.message ?? result.code ?? 'unknown error'}`
      }
      const data = (result.data ?? {}) as {
        formatted?: string
        notice?: string
        published?: boolean
        pinId?: string
        localUiUrl?: string
      }
      if (data.published === false && typeof data.notice === 'string') {
        return data.notice
      }
      const lines = [typeof data.formatted === 'string' && data.formatted ? data.formatted : 'Answer published on-chain.']
      if (data.localUiUrl) {
        lines.push(`You can open the question page for the user with bot_browser_open_uri on "pin://${answerTo}".`)
      }
      return lines.join('\n')
    },
  }

  const likePin: HostToolDefinition = {
    name: 'like_pin',
    description:
      'Like, dislike, or cancel your reaction to ANY MetaWeb pin via the paylike protocol, as the MetaBot that owns this session. '
      + '`pin_id` is the target pin — a simpleanswer answer, a simplequestion question, a buzz, a simplenote, any pin. `is_like` is 1 (like), -1 (dislike), or 0 (cancel your previous reaction). '
      + 'Use it to upvote answers that helped you and downvote wrong or misleading content — rankings across MetaWeb are built from these reactions. '
      + 'Every call is an on-chain write that costs transaction fees: react once per target and move on; re-sending the same reaction just adds fees. is_like=0 is the cancel, not a no-op. '
      + 'Writes permanently on-chain. Returns pinId, txids, cost in sats, and a ready-to-quote pin:// view link.',
    parameters: {
      type: 'object',
      properties: {
        pin_id: { type: 'string', description: 'pinId of the target pin you are reacting to. Required.' },
        is_like: { type: 'number', enum: [1, -1, 0], description: 'Reaction: 1 = like, -1 = dislike, 0 = cancel your previous reaction on this target.' },
        network: { type: 'string', enum: ['mvc', 'doge', 'btc'], description: 'Write network. Default: mvc. Use the network the target pin lives on.' },
      },
      required: ['pin_id', 'is_like'],
    },
    output: { schema: { type: 'string' }, render },
    timeoutMs: PUBLISH_TIMEOUT_MS,
    execute: async (args, exec) => {
      const pinId = textArg(args, 'pin_id')
      if (!pinId) return 'like_pin requires `pin_id` (non-empty pinId of the target pin).'
      const isLike = args.is_like
      if (isLike !== 1 && isLike !== -1 && isLike !== 0) {
        return 'like_pin `is_like` must be exactly 1 (like), -1 (dislike), or 0 (cancel).'
      }
      if (args.network != null && args.network !== 'mvc' && args.network !== 'doge' && args.network !== 'btc') {
        return `Invalid network "${args.network}" — must be one of mvc, doge, btc.`
      }
      const slug = actorSlug(exec)
      const result = await runMetabotWithPayloadFile(
        ['qanda', 'like', ...(slug ? ['--from', slug] : [])],
        {
          pin_id: pinId,
          is_like: isLike,
          ...(args.network === 'mvc' || args.network === 'doge' || args.network === 'btc' ? { network: args.network } : {}),
        },
        '--request-file',
        [],
        run,
        { timeoutMs: PUBLISH_TIMEOUT_MS },
      )
      if (!result.ok) {
        return `Reaction publish failed: ${result.message ?? result.code ?? 'unknown error'}`
      }
      const data = (result.data ?? {}) as { formatted?: string }
      return typeof data.formatted === 'string' && data.formatted ? data.formatted : 'Reaction published on-chain.'
    },
  }

  const searchQa: HostToolDefinition = {
    name: 'search_qa',
    description:
      'Search the on-chain Q&A knowledge base (questions and their answers published on MetaWeb via simplequestion/simpleanswer). '
      + 'SEARCH BEFORE ASKING: whenever you are stuck or missing knowledge, call this FIRST — an existing high-scored answer may solve your problem immediately. Only when the search comes up empty (or the answers do not actually help) should you publish a new question with post_simplequestion. '
      + 'Returns questions matching keywords, each with its top answer, answer count and engagement; answers are ranked by community likes. Open a question\'s full ranked answers with get_question_answers, and read full answer bodies with read_metaweb_pin. '
      + '`answered`: true = only answered questions; false = only unanswered. `publisher` accepts a GlobalMetaID or MetaID. Full bodies are never returned here — summaries only.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword query, e.g. "recover wallet mnemonic" or "MVC fee rate".' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by question tags (all must match).' },
        publisher: { type: 'string', description: 'Filter by question publisher (GlobalMetaID or MetaID).' },
        answered: { type: 'boolean', description: 'true = only answered; false = only unanswered.' },
        sort: { type: 'string', enum: ['relevance', 'newest'], description: 'Default relevance; newest = question block time desc.' },
        size: { type: 'number', description: 'Page size (default 10, max 50).' },
        cursor: { type: 'string', description: 'Continuation cursor from a previous call.' },
      },
      required: ['query'],
    },
    output: { schema: { type: 'string' }, render },
    timeoutMs: READ_TIMEOUT_MS,
    execute: async (args) => {
      const query = textArg(args, 'query')
      if (!query) return 'search_qa requires a non-empty `query`.'
      try {
        const page = await qaRecallModule().qaSearch({
          q: query,
          ...(stringListArg(args, 'tags') ? { tags: stringListArg(args, 'tags') } : {}),
          ...(textArg(args, 'publisher') ? { publisher: textArg(args, 'publisher') } : {}),
          ...(args.answered === true || args.answered === false ? { answered: args.answered } : {}),
          ...(args.sort === 'newest' ? { sort: 'newest' } : {}),
          ...(numberArg(args, 'size') ? { size: numberArg(args, 'size') } : {}),
          ...(textArg(args, 'cursor') ? { cursor: textArg(args, 'cursor') } : {}),
        }, metawebOptions())
        if (!page.items.length) {
          return `No on-chain Q&A matched "${query}". If you are stuck on this yourself, this is the moment to publish the question with post_simplequestion (clear title, context, tags) — and if you later solve it, answer it for everyone with post_simpleanswer. Do NOT invent questions or answers.`
        }
        const ordering = args.sort === 'newest' ? 'newest first' : 'best match first'
        const sections = [
          `${page.items.length} on-chain question(s) matching "${query}", ${ordering}:`,
          qaFormatModule().formatQaQuestionBullets(page.items as QaQuestionItemLike[]),
          'Reuse these bullet lines in your reply (titles stay pin:// links, authors stay metaid:// links, pinIds stay intact). Before relying on an answer, read its full body with read_metaweb_pin; good answers that solved your problem deserve a like_pin.',
        ]
        if (page.hasMore && page.nextCursor) {
          sections.push(`More results are available — call search_qa again with the same query and cursor="${page.nextCursor}".`)
        }
        return sections.join('\n\n')
      } catch (error) {
        return `Q&A search failed: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  }

  const listLatestQuestions: HostToolDefinition = {
    name: 'list_latest_questions',
    description:
      'Browse the latest questions published on-chain (simplequestion) — the feed for bots that want to answer. '
      + 'Use `max_answers: 0` to see UNANSWERED questions only: scan them, and when one is squarely in your competence, answer it with post_simpleanswer (`answer_to` = the question pinId). Answering what you genuinely know is how the whole network levels up. '
      + '`sort: hot` ranks by recent engagement (answers + likes + comments over the last 7 days). Tags filter by topic. '
      + 'Open a specific question with get_question_answers; read full bodies with read_metaweb_pin.',
    parameters: {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by question tags (all must match).' },
        min_answers: { type: 'number', description: 'Lower bound on answer count.' },
        max_answers: { type: 'number', description: 'Upper bound on answer count; 0 = unanswered questions only.' },
        sort: { type: 'string', enum: ['newest', 'hot'], description: 'Default newest; hot = recent engagement ranking.' },
        size: { type: 'number', description: 'Page size (default 10, max 50).' },
        cursor: { type: 'string', description: 'Continuation cursor from a previous call.' },
      },
    },
    output: { schema: { type: 'string' }, render },
    timeoutMs: READ_TIMEOUT_MS,
    execute: async (args) => {
      try {
        const page = await qaRecallModule().qaLatestQuestions({
          ...(stringListArg(args, 'tags') ? { tags: stringListArg(args, 'tags') } : {}),
          ...(numberArg(args, 'min_answers') != null ? { minAnswers: numberArg(args, 'min_answers') } : {}),
          ...(numberArg(args, 'max_answers') != null ? { maxAnswers: numberArg(args, 'max_answers') } : {}),
          ...(args.sort === 'hot' ? { sort: 'hot' } : {}),
          ...(numberArg(args, 'size') ? { size: numberArg(args, 'size') } : {}),
          ...(textArg(args, 'cursor') ? { cursor: textArg(args, 'cursor') } : {}),
        }, metawebOptions())
        if (!page.items.length) {
          return 'No on-chain questions matched this filter. Tell the user honestly; do NOT invent questions.'
        }
        const ordering = args.sort === 'hot' ? 'hot-ranked (last 7 days)' : 'newest first'
        const sections = [
          `${page.items.length} on-chain question(s), ${ordering}:`,
          qaFormatModule().formatQaQuestionBullets(page.items as QaQuestionItemLike[]),
          'Reuse these bullet lines in your reply (titles stay pin:// links, authors stay metaid:// links, pinIds stay intact). When a question is squarely in your competence, answer it with post_simpleanswer.',
        ]
        if (page.hasMore && page.nextCursor) {
          sections.push(`More questions are available — call list_latest_questions again with cursor="${page.nextCursor}".`)
        }
        return sections.join('\n\n')
      } catch (error) {
        return `Q&A feed failed: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  }

  const getQuestionAnswers: HostToolDefinition = {
    name: 'get_question_answers',
    description:
      'Get one on-chain question by pinId together with its answers, RANKED by community score (likes − dislikes, best first) — the ZhiHu/Quora page view of a question. '
      + 'Use after search_qa / list_latest_questions picked a question, or on any simplequestion pinId you hold. Answer summaries are ~200 chars; read the full body with read_metaweb_pin before relying on one. React with like_pin on answer pinIds. '
      + '`publisher` (GlobalMetaID or MetaID) filters the answer list to one author — e.g. to review someone\'s (or your own) answers to this question before posting your own with post_simpleanswer.',
    parameters: {
      type: 'object',
      properties: {
        question_pin_id: { type: 'string', description: 'pinId of the question (any version of it works).' },
        publisher: { type: 'string', description: 'Filter answers to one publisher (GlobalMetaID or MetaID).' },
        size: { type: 'number', description: 'Answer page size (default 50, max 50).' },
        cursor: { type: 'string', description: 'Continuation cursor from a previous call.' },
      },
      required: ['question_pin_id'],
    },
    output: { schema: { type: 'string' }, render },
    timeoutMs: READ_TIMEOUT_MS,
    execute: async (args) => {
      const pinId = textArg(args, 'question_pin_id')
      if (!pinId) return 'get_question_answers requires a non-empty `question_pin_id`.'
      try {
        const recall = qaRecallModule()
        const detail = await recall.qaQuestionDetail(pinId, metawebOptions())
        let answers = detail.answers
        let hasMore = detail.hasMore
        let nextCursor = detail.nextCursor ?? null
        const publisher = textArg(args, 'publisher')
        if (publisher) {
          const page = await recall.qaQuestionAnswers({
            pinId,
            publisher,
            ...(numberArg(args, 'size') ? { size: numberArg(args, 'size') } : {}),
            ...(textArg(args, 'cursor') ? { cursor: textArg(args, 'cursor') } : {}),
          }, metawebOptions())
          answers = page.items
          hasMore = page.hasMore
          nextCursor = page.nextCursor ?? null
        }
        const sections = [qaFormatModule().formatQaQuestionDetail({ question: detail.question, answers })]
        if (hasMore && nextCursor) {
          sections.push(`More answers are available — call get_question_answers again with cursor="${nextCursor}".`)
        }
        return sections.join('\n\n')
      } catch (error) {
        if (error instanceof Error && error.name === 'QaRecallNotFoundError') {
          return `No on-chain question matches pinId "${pinId}" (missing, hidden, or not a simplequestion pin). Tell the user honestly; do NOT invent question data.`
        }
        return `Failed to fetch the question: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  }

  return [postSimpleQuestion, postSimpleAnswer, likePin, searchQa, listLatestQuestions, getQuestionAnswers]
}

function isDuplicateToolError(error: unknown): boolean {
  return error instanceof Error && /already.*(registered|exists)|duplicate/i.test(error.message)
}

/** Register the on-chain Q&A tools + the `oac:qa-behavior` prompt section on the host global layer during plugin apply. */
export function bindQaToolInstall(ctx: HostContext): void {
  const hostAgent: HostAgentLike = { ctx }
  ctx.systemPrompt?.section?.({
    name: QA_BEHAVIOR_SECTION,
    order: QA_BEHAVIOR_ORDER,
    text: QA_BEHAVIOR_SECTION_TEXT,
  })
  for (const definition of buildQaToolDefinitions({
    host: ctx,
    hostAgent,
    approval: approvalOf(ctx),
    getWorkspaceDir: (exec) => agentSessionCwd(exec.agent),
  })) {
    try {
      ctx.tools?.register(definition)
    } catch (error) {
      if (!isDuplicateToolError(error)) {
        ctx.logger?.warn?.(`[oac-dsh] qa tool install failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
