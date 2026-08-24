/**
 * post_simplenote — DSH native tool for on-chain long-form publishing via
 * the simplenote protocol. OAC port of the IDBots tool: local cover /
 * attachment files go through the shared chain-upload gate (files outside
 * the session workspace require the owner's explicit confirmation in the
 * native DSH approval dialog before any bytes leave the machine), then the
 * publish runs through the OAC CLI (`simplenote post --request-file`).
 */
import path from 'node:path'
import { runMetabotWithPayloadFile, type RunFn } from './cli-payload.js'
import type { HostAgentLike, HostApproval, HostContext, HostToolDefinition, HostToolExec } from './context-types.js'
import { approvalOf, oacSlugOf } from './browser-tools.js'
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

export function buildSimpleNoteToolDefinitions(input: {
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

  const postSimpleNote: HostToolDefinition = {
    name: 'post_simplenote',
    description:
      'Publish a long-form note or article on-chain via the simplenote protocol, as the MetaBot that owns this session. '
      + 'Use when the user asks to publish/write an article, blog post, tutorial, long-form documentation, or a note on MetaWeb. '
      + 'Content defaults to Markdown (`content_type` text/markdown) but any MIME type is allowed. '
      + 'Images and files must be ON-CHAIN, never Web2 hotlinks: the built-in Bot Browser renders metafile:// URIs natively, '
      + 'so to show an image inside the article, pass its local absolute path as `cover`/`attachments` (uploaded automatically) '
      + 'or an existing metafile:// URI, and reference metafile://<pinId> in the Markdown body, e.g. ![alt](metafile://<pinId>). '
      + 'NEVER embed https:// Web2 URLs for on-chain articles. '
      + 'Do NOT use for short buzz posts (post_buzz) or plain file uploads. '
      + 'Writes permanently on-chain and costs transaction fees. Local files outside the session workspace require the owner\'s '
      + 'explicit confirmation in the native dialog before upload. Returns pinId, txids, cost in sats, and a pin:// view link.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Note title. Required and must not be empty.' },
        content: { type: 'string', description: 'Note body. Markdown by default (see content_type).' },
        subtitle: { type: 'string', description: 'Optional subtitle shown under the title.' },
        cover: { type: 'string', description: 'Cover image: local absolute file path (uploaded automatically) or an existing metafile:// URI.' },
        attachments: { type: 'array', items: { type: 'string' }, description: 'Extra files/images: local absolute file paths and/or metafile:// URIs.' },
        content_type: { type: 'string', description: 'MIME type of the content field. Default: text/markdown.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Topic tags for discovery.' },
        network: { type: 'string', enum: ['mvc', 'doge', 'btc'], description: 'Note write network. Default: mvc. DOGE is allowed for the note write only; files always upload on MVC.' },
      },
      required: ['title', 'content'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    },
    timeoutMs: PUBLISH_TIMEOUT_MS,
    execute: async (args: Record<string, unknown>, exec: HostToolExec) => {
      const title = textArg(args, 'title')
      const content = textArg(args, 'content')
      if (!title || !content) {
        return 'post_simplenote requires both `title` and `content` (non-empty).'
      }

      // Gate: local absolute paths that are not metafile:// URIs must be
      // inside the workspace, or the owner approves them in one batch.
      const candidates = [textArg(args, 'cover'), ...(stringListArg(args, 'attachments') ?? [])].filter(Boolean)
      const localPaths = candidates.filter((item) => path.isAbsolute(item) && !isMetafileUri(item))
      const relative = candidates.filter((item) => !path.isAbsolute(item) && !isMetafileUri(item))
      if (relative.length > 0) {
        return `post_simplenote requires ABSOLUTE local file paths (or metafile:// URIs). Relative: ${relative.join(', ')}.`
      }
      const workspaceDir = input.getWorkspaceDir?.(exec)
      const external = localPaths.filter((item) => !workspaceDir || !isPathInsideDir(item, workspaceDir))
      if (external.length > 0) {
        if (!approval) {
          return 'Publish refused: DSH approval is not available in this composition, so files outside the session workspace cannot be confirmed for on-chain upload.'
        }
        const agent = exec.agent ?? hostAgent
        const reason = [
          'Publish these files on-chain as part of the note? This makes them public and irreversible.',
          ...external.map((file) => `- ${file}`),
        ].join('\n')
        const outcome = await approval.request({
          agent,
          toolName: 'post_simplenote',
          ...(exec.callId ? { callId: exec.callId } : {}),
          reason,
          signal: exec.signal,
        })
        if (outcome !== 'allowed-once') {
          return `Owner declined to upload files outside the session workspace (${outcome}). Do not retry unless the owner explicitly asks again; suggest copying the files into the workspace instead.`
        }
      }

      if (args.network != null && args.network !== 'mvc' && args.network !== 'doge' && args.network !== 'btc') {
        return `Invalid network "${args.network}" — must be one of mvc, doge, btc.`
      }
      const slug = actorSlug(exec)
      // The native approval above (or workspace containment) covered the
      // external-file decision, so the daemon-side gate gets the consent flag.
      const result = await runMetabotWithPayloadFile(
        ['simplenote', 'post', ...(slug ? ['--from', slug] : [])],
        {
          title,
          content,
          confirmExternalUpload: true,
          ...(textArg(args, 'subtitle') ? { subtitle: textArg(args, 'subtitle') } : {}),
          ...(textArg(args, 'cover') ? { cover: textArg(args, 'cover') } : {}),
          ...(stringListArg(args, 'attachments') ? { attachments: stringListArg(args, 'attachments') } : {}),
          ...(textArg(args, 'content_type') ? { content_type: textArg(args, 'content_type') } : {}),
          ...(stringListArg(args, 'tags') ? { tags: stringListArg(args, 'tags') } : {}),
          ...(args.network === 'mvc' || args.network === 'doge' || args.network === 'btc' ? { network: args.network } : {}),
        },
        '--request-file',
        [],
        run,
      )
      if (!result.ok) {
        return `Note publish failed: ${result.message ?? result.code ?? 'unknown error'}`
      }
      const data = (result.data ?? {}) as {
        formatted?: string
        pinId?: string
        localUiUrl?: string
      }
      const lines = [typeof data.formatted === 'string' && data.formatted ? data.formatted : 'Note published on-chain.']
      if (data.localUiUrl && data.pinId) {
        lines.push(`You can open it for the user with bot_browser_open_uri on "pin://${data.pinId}".`)
      }
      return lines.join('\n')
    },
  }

  return [postSimpleNote]
}

function isDuplicateToolError(error: unknown): boolean {
  return error instanceof Error && /already.*(registered|exists)|duplicate/i.test(error.message)
}

/** Register post_simplenote on the host global tool layer during plugin apply. */
export function bindSimpleNoteToolInstall(ctx: HostContext): void {
  const hostAgent: HostAgentLike = { ctx }
  for (const definition of buildSimpleNoteToolDefinitions({
    host: ctx,
    hostAgent,
    approval: approvalOf(ctx),
    getWorkspaceDir: (exec) => {
      const cwd = (exec.agent as { ctx?: { options?: { cwd?: string } } } | undefined)?.ctx?.options?.cwd
      return typeof cwd === 'string' && cwd.trim() ? cwd : undefined
    },
  })) {
    try {
      ctx.tools?.register(definition)
    } catch (error) {
      if (!isDuplicateToolError(error)) {
        ctx.logger?.warn?.(`[oac-dsh] simplenote tool install failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
