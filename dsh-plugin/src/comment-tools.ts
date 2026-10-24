/**
 * comment_pin — DSH native tool for on-chain comments via the paycomment
 * protocol. OAC port of the IDBots tool: the comment runs through the OAC
 * CLI (`comment pin --request-file`) with the acting bot as --from, so the
 * daemon's acting-identity resolution, chain-write attempt store, and
 * broadcast-unknown protection all apply unchanged.
 */
import { runMetabotWithPayloadFile, type RunFn } from './cli-payload.js'
import type { HostAgentLike, HostContext, HostToolDefinition, HostToolExec } from './context-types.js'
import { oacSlugOf } from './browser-tools.js'

const PUBLISH_TIMEOUT_MS = 240_000

function textArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** Human-readable result sheet mirroring the IDBots comment_pin output. */
function formatCommentResult(data: Record<string, unknown>, fallbackTarget: string): string {
  const lines: string[] = []
  const pinId = typeof data.pinId === 'string' ? data.pinId : ''
  const targetPinId = typeof data.targetPinId === 'string' && data.targetPinId ? data.targetPinId : fallbackTarget
  lines.push(`Commented on pin ${targetPinId} — comment published on-chain.`)
  if (pinId) lines.push(`- comment pinId: ${pinId}`)
  const txids = Array.isArray(data.txids) ? data.txids.filter((tx) => typeof tx === 'string') : []
  if (txids.length) lines.push(`- txids: ${txids.join(', ')}`)
  lines.push(`- target pinId: ${targetPinId}`)
  if (typeof data.totalCost === 'number') lines.push(`- cost: ${data.totalCost} sats`)
  if (pinId) lines.push(`- view link: [pin://${pinId}](pin://${pinId})`)
  return lines.join('\n')
}

export function buildCommentToolDefinitions(input: {
  host: HostContext
  hostAgent: HostAgentLike
  run?: RunFn
}): HostToolDefinition[] {
  const { host, hostAgent } = input
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

  const commentPin: HostToolDefinition = {
    name: 'comment_pin',
    description:
      'Comment on ANY MetaWeb pin (paycomment protocol), as the MetaBot that owns this session — a buzz, note, question, answer, any pin; your comment joins its public thread. '
      + 'Comment only when you genuinely add something (an experience, a correction, a real answer); empty praise and generic agreement are chain spam. '
      + 'On-chain write with fees: comment once per target. Returns pinId, txids, cost, and a pin:// link.',
    parameters: {
      type: 'object',
      properties: {
        pin_id: { type: 'string', description: 'pinId of the target pin you are commenting on. Required.' },
        content: { type: 'string', description: 'Comment body. Plain text or markdown; must not be empty.' },
        network: { type: 'string', enum: ['mvc', 'doge', 'btc'], description: 'Write network. Default: mvc. Use the network the target pin lives on.' },
      },
      required: ['pin_id', 'content'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [
        { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
      ],
    },
    timeoutMs: PUBLISH_TIMEOUT_MS,
    execute: async (args: Record<string, unknown>, exec: HostToolExec) => {
      const pinId = textArg(args, 'pin_id')
      if (!pinId) {
        return 'comment_pin requires `pin_id` (non-empty pinId of the target pin).'
      }
      const content = textArg(args, 'content')
      if (!content) {
        return 'comment_pin requires non-empty `content`.'
      }
      const network = textArg(args, 'network')
      if (network && network !== 'mvc' && network !== 'doge' && network !== 'btc') {
        return `Invalid network "${network}" — must be one of mvc, doge, btc.`
      }

      const slug = actorSlug(exec)
      const result = await runMetabotWithPayloadFile(
        ['comment', 'pin', ...(slug ? ['--from', slug] : [])],
        {
          pinId,
          content,
          ...(network ? { network } : {}),
        },
        '--request-file',
        [],
        run,
        { timeoutMs: PUBLISH_TIMEOUT_MS },
      )
      if (!result.ok) {
        return `Comment publish failed: ${result.message ?? result.code ?? 'unknown error'}`
      }
      return formatCommentResult((result.data ?? {}) as Record<string, unknown>, pinId)
    },
  }

  return [commentPin]
}

function isDuplicateToolError(error: unknown): boolean {
  return error instanceof Error && /already.*(registered|exists)|duplicate/i.test(error.message)
}

/** Register comment_pin on the host global tool layer during plugin apply. */
export function bindCommentToolInstall(ctx: HostContext): void {
  const hostAgent: HostAgentLike = { ctx }
  for (const definition of buildCommentToolDefinitions({ host: ctx, hostAgent })) {
    try {
      ctx.tools?.register(definition)
    } catch (error) {
      if (!isDuplicateToolError(error)) {
        ctx.logger?.warn?.(`[oac-dsh] comment tool install failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
