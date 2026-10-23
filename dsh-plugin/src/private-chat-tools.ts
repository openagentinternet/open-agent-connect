/**
 * send_private_chat — DSH native tool for one E2E-encrypted private MetaWeb
 * message (/protocols/simplemsg) to a globalMetaId. OAC port of the IDBots
 * tool: the send runs through the OAC CLI (`chat private --request-file`),
 * and the daemon owns the crypto (peer chatpubkey lookup, ECDH shared
 * secret, AES encryption, pin broadcast) — this side never touches key
 * material. The send itself is an irreversible on-chain write addressed to
 * a specific peer, so it carries the owner gate used by other outbound
 * writes: a native DSH approval dialog confirms the send, and when prompts
 * are unavailable or disabled the model must bring the owner's explicit
 * in-chat ask as `owner_confirmed: true` (group-task `close` pattern).
 */
import { runMetabotWithPayloadFile, type RunFn } from './cli-payload.js'
import type {
  HostAgentLike,
  HostApproval,
  HostApprovalOutcome,
  HostContext,
  HostToolDefinition,
  HostToolExec,
} from './context-types.js'
import { approvalOf, oacSlugOf, sessionApprovalPolicy } from './browser-tools.js'

/** One simplemsg pin write; no uploads, so well under the publish budgets. */
const SEND_TIMEOUT_MS = 120_000

function textArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value.trim() : ''
}

function boolArg(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true
}

/** Short single-line excerpt of the plaintext for the approval dialog. */
function excerptOf(content: string, max = 160): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

export function buildPrivateChatToolDefinitions(input: {
  host: HostContext
  hostAgent: HostAgentLike
  approval?: HostApproval
  run?: RunFn
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

  /** Owner gate for the send: one irreversible on-chain write addressed to a
   * specific peer. With native approval prompts the dialog asks; with prompts
   * disabled (or no approval surface) the model must bring the owner's
   * explicit in-chat ask as `owner_confirmed: true`. Returns the refusal
   * text, or null to proceed. */
  const confirmSendWithOwner = async (
    exec: HostToolExec,
    to: string,
    content: string,
    replyPin: string,
    ownerConfirmed: boolean,
  ): Promise<string | null> => {
    const refusal = [
      'Send refused: DSH approval is not available in this composition, so an outbound private message cannot be confirmed.',
      'Ask the owner in chat for the exact message, then retry with owner_confirmed: true — otherwise the private message is not sent.',
    ].join('\n')
    const policy = approval?.overrideOf?.(exec.agent?.session) ?? sessionApprovalPolicy(exec.agent)
    if (!approval || policy === 'never') {
      return ownerConfirmed ? null : refusal
    }
    const decision: HostApprovalOutcome = await approval.request({
      agent: exec.agent ?? hostAgent,
      toolName: 'send_private_chat',
      ...(exec.callId ? { callId: exec.callId } : {}),
      reason: `Send one encrypted private on-chain message to ${to}`
        + (replyPin ? ` (reply to ${replyPin})` : '')
        + `: “${excerptOf(content)}”`,
      signal: exec.signal,
    })
    if (decision !== 'allowed-once') {
      return `Send cancelled: the owner declined in the confirmation dialog (${decision}). `
        + 'Do not retry unless the owner explicitly asks again.'
    }
    return null
  }

  const sendPrivateChat: HostToolDefinition = {
    name: 'send_private_chat',
    description:
      'Send ONE encrypted private MetaWeb message (/protocols/simplemsg) to a globalMetaId, as the MetaBot that owns this session. '
      + 'Pass the target and plaintext; the daemon resolves the peer chatpubkey, encrypts ECDH+AES, and broadcasts — no key material ever reaches this tool. '
      + 'Use when the user asks to DM or privately message someone on MetaWeb (idq1...), or a remote Bot/MetaBot asks for one private chat message. '
      + 'The message is on-chain and permanent — do NOT send content the user did not ask for. '
      + 'NOT for group-task chat (group_task) or public posts and notes (post_simplenote). '
      + 'To pick a recipient, resolve the identity first — search_online_bots for who is online right now, or use the globalMetaId of an incoming message; never invent a globalMetaId. '
      + '`reply_pin` marks this message as a reply to a specific earlier private-chat pin. '
      + 'Sending requires the owner: a native approval dialog confirms the send, and when approval prompts are unavailable or disabled the owner\'s '
      + 'explicit in-chat ask must be carried as owner_confirmed: true — otherwise the send is refused. '
      + 'Returns pinId, txids, cost in sats, network, and a pin:// link.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Target globalMetaId (idq1...).' },
        content: { type: 'string', description: 'Plaintext message; the daemon resolves the peer chatpubkey and encrypts ECDH+AES before broadcast.' },
        reply_pin: { type: 'string', description: 'Pin id of the message being replied to, when this is a reply.' },
        owner_confirmed: { type: 'boolean', description: 'Set true ONLY when the owner explicitly asked in chat for this exact message AND approval prompts are unavailable or disabled; otherwise omit and let the approval dialog confirm.' },
      },
      required: ['to', 'content'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    },
    timeoutMs: SEND_TIMEOUT_MS,
    execute: async (args: Record<string, unknown>, exec: HostToolExec) => {
      const to = textArg(args, 'to')
      const content = textArg(args, 'content')
      if (!to) {
        return 'send_private_chat requires `to` (the target globalMetaId, idq1...).'
      }
      if (!content) {
        return 'send_private_chat requires `content` (the plaintext message).'
      }
      const replyPin = textArg(args, 'reply_pin')

      // Gate: the owner confirms the send itself — approval dialog when
      // prompts are live, explicit in-chat ask otherwise (no silent sends).
      const blocked = await confirmSendWithOwner(exec, to, content, replyPin, boolArg(args, 'owner_confirmed'))
      if (blocked) return blocked

      const slug = actorSlug(exec)
      try {
        const result = await runMetabotWithPayloadFile(
          ['chat', 'private', ...(slug ? ['--from', slug] : [])],
          { to, content, ...(replyPin ? { replyPin } : {}) },
          '--request-file',
          [],
          run,
        )
        if (!result.ok) {
          return `Private message send failed: ${result.message ?? result.code ?? 'unknown error'}`
        }
        const data = (result.data ?? {}) as {
          pinId?: string | null
          txids?: string[]
          totalCost?: number | null
          network?: string
          localUiUrl?: string
          webhookWarning?: string
        }
        const lines = ['Private message sent.']
        const pinId = typeof data.pinId === 'string' && data.pinId ? data.pinId : ''
        if (pinId) lines.push(`- pinId: ${pinId}`)
        const txids = Array.isArray(data.txids) ? data.txids.filter(Boolean) : []
        if (txids.length) lines.push(`- txids: ${txids.join(', ')}`)
        if (typeof data.totalCost === 'number' && Number.isFinite(data.totalCost)) {
          lines.push(`- cost: ${data.totalCost} sats`)
        }
        if (data.network) lines.push(`- network: ${data.network}`)
        if (pinId) lines.push(`- pin link: [pin://${pinId}](pin://${pinId})`)
        if (data.localUiUrl) lines.push(`Local conversation view: ${data.localUiUrl}`)
        if (data.webhookWarning) lines.push(`NOTICE: ${data.webhookWarning}`)
        return lines.join('\n')
      } catch (error) {
        return `Private message send failed: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  }

  return [sendPrivateChat]
}

function isDuplicateToolError(error: unknown): boolean {
  return error instanceof Error && /already.*(registered|exists)|duplicate/i.test(error.message)
}

/** Register send_private_chat on the host global tool layer during plugin apply. */
export function bindPrivateChatToolInstall(ctx: HostContext): void {
  const hostAgent: HostAgentLike = { ctx }
  for (const definition of buildPrivateChatToolDefinitions({
    host: ctx,
    hostAgent,
    approval: approvalOf(ctx),
  })) {
    try {
      ctx.tools?.register(definition)
    } catch (error) {
      if (!isDuplicateToolError(error)) {
        ctx.logger?.warn?.(`[oac-dsh] private-chat tool install failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
