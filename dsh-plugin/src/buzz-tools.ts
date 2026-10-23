/**
 * post_buzz — DSH native tool for on-chain short posts via the simplebuzz
 * protocol. OAC port of the IDBots tool: local attachment files go through
 * the shared chain-upload gate (files outside the session workspace require
 * the owner's explicit confirmation in the native DSH approval dialog before
 * any bytes leave the machine), then the post runs through the OAC CLI
 * (`buzz post --request-file`). Quote-reposts reuse quote_pin.
 */
import path from 'node:path'
import { runMetabotWithPayloadFile, type RunFn } from './cli-payload.js'
import type { HostAgentLike, HostApproval, HostContext, HostToolDefinition, HostToolExec } from './context-types.js'
import { agentSessionCwd, approvalOf, oacSlugOf } from './browser-tools.js'
import { stageExternalFilesIntoWorkspace, type StagedExternalFiles } from './file-upload.js'
import { isPathInsideDir } from './oac-core-gate.js'

const PUBLISH_TIMEOUT_MS = 240_000

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

function isMetafileUri(value: string): boolean {
  return /^metafile:\/\//i.test(value.trim())
}

/** Human-readable result sheet mirroring the IDBots post_buzz output. */
function formatBuzzResult(data: Record<string, unknown>): string {
  const lines: string[] = []
  const pinId = typeof data.pinId === 'string' ? data.pinId : ''
  if (pinId) lines.push(`Buzz posted on-chain: pin://${pinId}`)
  const txids = Array.isArray(data.txids) ? data.txids.filter((tx) => typeof tx === 'string') : []
  if (txids.length) lines.push(`txids: ${txids.join(', ')}`)
  if (typeof data.totalCost === 'number') lines.push(`cost: ${data.totalCost} sats`)
  const attachments = Array.isArray(data.attachments) ? data.attachments.filter((a) => typeof a === 'string') : []
  if (attachments.length) lines.push(`attachments: ${attachments.join(', ')}`)
  return lines.length ? lines.join('\n') : 'Buzz posted on-chain.'
}

export function buildBuzzToolDefinitions(input: {
  host: HostContext
  hostAgent: HostAgentLike
  approval?: HostApproval
  run?: RunFn
  /** Session workspace resolver; absent = every local file counts as external. */
  getWorkspaceDir?: (exec: HostToolExec) => string | undefined
  /** Test seam; production stages approved files into the Bot workspace. */
  stageExternalFiles?: (from: string, paths: string[]) => Promise<StagedExternalFiles>
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

  const postBuzz: HostToolDefinition = {
    name: 'post_buzz',
    description:
      'Post a buzz (short text post with optional attachments) on-chain via the simplebuzz protocol, as the MetaBot that owns this session. '
      + 'Use to post a buzz — a short on-chain message or development-journal entry. Attachments accept local absolute paths (uploaded automatically) and metafile:// URIs; '
      + 'quote_pin quotes/reposts an existing buzz. '
      + 'Do NOT use for file-only uploads or long articles (post_simplenote), Q&A (post_simplequestion/post_simpleanswer), or chat messages (send_private_chat). '
      + 'Writes permanently on-chain and costs transaction fees. Local files outside the session workspace require the owner\'s '
      + 'explicit confirmation in the native dialog before upload; attachment paths must be ABSOLUTE (relative paths are rejected), '
      + 'and when approval prompts are disabled in this session outside-workspace files are auto-declined — copy the file into the '
      + 'session workspace first (a gitignored sub-directory keeps the tree clean) and pass that path. '
      + 'Returns pinId, txids, cost in sats, and a pin:// view link.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Buzz text content. Required and must not be empty.' },
        attachments: { type: 'array', items: { type: 'string' }, description: 'Local absolute file paths and/or metafile:// URIs.' },
        content_type: { type: 'string', description: 'MIME type of the content field. Default: text/plain;utf-8.' },
        network: { type: 'string', enum: ['mvc', 'doge', 'btc'], description: 'Buzz write network. Default: mvc. DOGE is allowed for the buzz write only; attachments always upload on MVC.' },
        quote_pin: { type: 'string', description: 'pinId of the buzz being quoted/reposted.' },
      },
      required: ['content'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    },
    timeoutMs: PUBLISH_TIMEOUT_MS,
    execute: async (args: Record<string, unknown>, exec: HostToolExec) => {
      const content = textArg(args, 'content')
      if (!content) {
        return 'post_buzz requires `content` (non-empty buzz text).'
      }

      // Gate: local absolute paths that are not metafile:// URIs must be
      // inside the workspace, or the owner approves them in one batch —
      // after which the HOST stages the copies into the Bot workspace (the
      // daemon no longer honors a caller-supplied consent flag).
      const candidates = stringListArg(args, 'attachments') ?? []
      const localPaths = candidates.filter((item) => path.isAbsolute(item) && !isMetafileUri(item))
      const relative = candidates.filter((item) => !path.isAbsolute(item) && !isMetafileUri(item))
      if (relative.length > 0) {
        return `post_buzz requires ABSOLUTE local file paths (or metafile:// URIs). Relative: ${relative.join(', ')}.`
      }
      const workspaceDir = input.getWorkspaceDir?.(exec)
      const external = localPaths.filter((item) => !workspaceDir || !isPathInsideDir(item, workspaceDir))
      let staged: StagedExternalFiles | null = null
      if (external.length > 0) {
        if (!approval) {
          return 'Publish refused: DSH approval is not available in this composition, so files outside the session workspace cannot be confirmed for on-chain upload.'
        }
        const agent = exec.agent ?? hostAgent
        const reason = [
          'Upload these files on-chain as buzz attachments? This makes them public and irreversible.',
          ...external.map((file) => `- ${file}`),
        ].join('\n')
        const outcome = await approval.request({
          agent,
          toolName: 'post_buzz',
          ...(exec.callId ? { callId: exec.callId } : {}),
          reason,
          signal: exec.signal,
        })
        if (outcome !== 'allowed-once') {
          return `Owner declined to upload files outside the session workspace (${outcome}). Do not retry the same path — when approval prompts are disabled or the owner declines, outside-workspace files cannot upload. Next step: copy the file into the session workspace (a gitignored sub-directory keeps the tree clean) and retry with the new ABSOLUTE path.`
        }
        const slugForStaging = actorSlug(exec)
        if (!slugForStaging) {
          return 'post_buzz: the acting Bot could not be resolved, so the approved files cannot be staged into its workspace. Copy them into the Bot workspace manually and retry with the new paths.'
        }
        try {
          staged = await (input.stageExternalFiles ?? stageExternalFilesIntoWorkspace)(slugForStaging, external)
        } catch (error) {
          return `post_buzz: could not stage the approved files into the Bot workspace: ${error instanceof Error ? error.message : String(error)}`
        }
      }

      if (args.network != null && args.network !== 'mvc' && args.network !== 'doge' && args.network !== 'btc') {
        return `Invalid network "${args.network}" — must be one of mvc, doge, btc.`
      }
      const slug = actorSlug(exec)
      const mapStaged = (item: string): string => staged?.pathByOriginal.get(item) ?? item
      try {
        const result = await runMetabotWithPayloadFile(
          ['buzz', 'post', ...(slug ? ['--from', slug] : [])],
          {
            content,
            ...(textArg(args, 'content_type') ? { contentType: textArg(args, 'content_type') } : {}),
            ...(stringListArg(args, 'attachments')
              ? { attachments: stringListArg(args, 'attachments')!.map(mapStaged) }
              : {}),
            ...(textArg(args, 'quote_pin') ? { quotePin: textArg(args, 'quote_pin') } : {}),
            ...(args.network === 'mvc' || args.network === 'doge' || args.network === 'btc' ? { network: args.network } : {}),
          },
          '--request-file',
          [],
          run,
          { timeoutMs: PUBLISH_TIMEOUT_MS },
        )
        if (!result.ok) {
          return `Buzz post failed: ${result.message ?? result.code ?? 'unknown error'}`
        }
        const data = (result.data ?? {}) as Record<string, unknown>
        const lines = [formatBuzzResult(data)]
        if (typeof data.localUiUrl === 'string' && data.localUiUrl && typeof data.pinId === 'string' && data.pinId) {
          lines.push(`You can open it for the user with bot_browser_open_uri on "pin://${data.pinId}".`)
        }
        return lines.join('\n')
      } finally {
        await staged?.cleanup()
      }
    },
  }

  return [postBuzz]
}

function isDuplicateToolError(error: unknown): boolean {
  return error instanceof Error && /already.*(registered|exists)|duplicate/i.test(error.message)
}

/** Register post_buzz on the host global tool layer during plugin apply. */
export function bindBuzzToolInstall(ctx: HostContext): void {
  const hostAgent: HostAgentLike = { ctx }
  for (const definition of buildBuzzToolDefinitions({
    host: ctx,
    hostAgent,
    approval: approvalOf(ctx),
    getWorkspaceDir: (exec) => agentSessionCwd(exec.agent),
  })) {
    try {
      ctx.tools?.register(definition)
    } catch (error) {
      if (!isDuplicateToolError(error)) {
        ctx.logger?.warn?.(`[oac-dsh] buzz tool install failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
