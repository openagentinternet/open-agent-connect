/**
 * group_chat — DSH native tool for the two on-chain MetaWeb group-chat
 * primitives, OAC port of the IDBots tool (minus orchestrate, which rides a
 * host-local scheduler IDBots has and OAC does not):
 * - join_group: SimpleGroupJoin (/protocols/simplegroupjoin, state 1).
 * - send_group_message: SimpleGroupChat (/protocols/simplegroupchat).
 *
 * The send action encrypts the plaintext IN-PROCESS with the OAC core group
 * crypto (loaded through local-read's core() seam — pure computation, no
 * chain I/O; the group key is derived from the public group id, so no secret
 * key material ever crosses this bridge). The CLI request then carries the
 * ciphertext, and the daemon assembles the pin body: nickName is stamped
 * there from the acting bot's REGISTERED identity name — never from model
 * input (IDBots incident: on-chain sender_name "claude bot") — so this tool
 * exposes no nickName parameter and never forwards one.
 */
import { runMetabotWithPayloadFile, type RunFn } from './cli-payload.js'
import { core } from './local-read.js'
import type { HostAgentLike, HostContext, HostToolDefinition, HostToolExec } from './context-types.js'
import { oacSlugOf } from './browser-tools.js'

const GROUP_WRITE_TIMEOUT_MS = 240_000

/** On-chain group id shape: the group's pin id — 64 lowercase hex + "i0".
 * Local copy of the core pattern: the bridge validates before any local-read
 * dependency or CLI call (join needs no crypto, so it must not depend on the
 * dist being resolvable). */
const ON_CHAIN_GROUP_ID = /^[0-9a-f]{64}i0$/

type GroupChatAction = 'join_group' | 'send_group_message'

/** The pure group-crypto surface this bridge needs (OAC core module). */
export interface GroupCrypto {
  encryptGroupMessage(message: string, groupId: string): string
}

/** Default loader: pull the pure crypto from the OAC dist via local-read. */
function loadGroupCryptoFromDist(): GroupCrypto | null {
  try {
    const mod = core('core/group/groupCrypto.js')
    const encrypt = mod.encryptGroupMessage
    if (typeof encrypt !== 'function') return null
    return { encryptGroupMessage: encrypt as GroupCrypto['encryptGroupMessage'] }
  } catch {
    return null
  }
}

function textArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value.trim() : ''
}

function mentionArg(args: Record<string, unknown>): string[] {
  const value = args.mention
  return Array.isArray(value)
    ? value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean)
    : []
}

/** Human-readable success sheet mirroring the IDBots formatPinResult shape. */
function formatGroupPinResult(title: string, data: Record<string, unknown>): string {
  const lines: string[] = [title]
  const pinId = typeof data.pinId === 'string' ? data.pinId : ''
  if (pinId) lines.push(`- pinId: ${pinId}`)
  const txids = Array.isArray(data.txids) ? data.txids.filter((tx) => typeof tx === 'string') : []
  if (txids.length) lines.push(`- txids: ${txids.join(', ')}`)
  if (typeof data.totalCost === 'number') lines.push(`- cost: ${data.totalCost} sats`)
  if (pinId) lines.push(`- pin link: [pin://${pinId}](pin://${pinId})`)
  return lines.join('\n')
}

export function buildGroupChatToolDefinitions(input: {
  host: HostContext
  hostAgent: HostAgentLike
  run?: RunFn
  /** Group-crypto loader seam (tests inject a fake); default loads the OAC
   * core module in-process via local-read. */
  loadGroupCrypto?: () => GroupCrypto | null
}): HostToolDefinition[] {
  const { host, hostAgent } = input
  const run = input.run ?? (async (args, options) => {
    const { runMetabot } = await import('./cli-bridge.js')
    return runMetabot(args, options)
  })
  const loadGroupCrypto = input.loadGroupCrypto ?? loadGroupCryptoFromDist

  const actorSlug = (exec: HostToolExec): string => {
    const agent = exec.agent ?? hostAgent
    const live = oacSlugOf(host, agent)
    if (live) return live
    const preset = host.agentPresets?.composedPreset?.(agent.ctx)
    return typeof preset === 'string' ? preset.replace(/^oac-/, '') : ''
  }

  const groupChat: HostToolDefinition = {
    name: 'group_chat',
    description:
      'MetaWeb group-chat operations for one MetaBot. Pick the action by intent: '
      + 'action "join_group": join an on-chain group (SimpleGroupJoin, /protocols/simplegroupjoin, state 1). Pass the protocol key field `k` for a private group. '
      + 'action "send_group_message": send ONE group message (SimpleGroupChat); pass plaintext `content` — it is AES-encrypted with the group key before broadcast. '
      + 'To both join and keep chatting, call join_group first, then send_group_message. '
      + 'group_id is the on-chain group pin id: EXACTLY 64 lowercase hex characters followed by "i0" (66 chars total). A bare number (e.g. "65") is a task NUMBER, never a group id — never invent a group id; ask the user when unknown. In a group-task workflow, pass the group id shown in your context. '
      + 'The on-chain sender name is always the acting bot\'s registered name (resolved by the host) — there is no nickname parameter. '
      + 'On-chain pins are permanent — do NOT join groups or post messages the user did not ask for. For private 1:1 messages use send_private_chat; for public posts use post_buzz. '
      + 'Writes permanently on-chain with fees. Returns pinId, txids, cost, and a pin:// link.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['join_group', 'send_group_message'],
          description: 'join_group = SimpleGroupJoin; send_group_message = one AES-encrypted group message (SimpleGroupChat).',
        },
        group_id: {
          type: 'string',
          description:
            'On-chain group pin id: exactly 64 lowercase hex chars + "i0" (66 chars, e.g. "4ffab5a8…e2e4i0"). '
            + 'NOT the numeric task id (65 is a task number, not a group id). Required for every action.',
        },
        content: { type: 'string', description: 'send_group_message: plaintext message; encrypted with the group key before broadcast.' },
        referrer: { type: 'string', description: 'join_group: inviter MetaID; omit or empty for open joins.' },
        k: { type: 'string', description: 'join_group: encrypted key field for private groups (per SimpleGroupJoin protocol).' },
        reply_pin: { type: 'string', description: 'send_group_message: pin id of the message being replied to.' },
        channel_id: { type: 'string', description: 'send_group_message: channel id within the group.' },
        mention: { type: 'array', items: { type: 'string' }, description: 'send_group_message: MetaID list to @mention.' },
        network: { type: 'string', enum: ['mvc', 'doge', 'btc'], description: 'Write network. Default: mvc.' },
      },
      required: ['action', 'group_id'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [
        { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
      ],
    },
    timeoutMs: GROUP_WRITE_TIMEOUT_MS,
    execute: async (args: Record<string, unknown>, exec: HostToolExec) => {
      const action = textArg(args, 'action') as GroupChatAction | ''
      if (action !== 'join_group' && action !== 'send_group_message') {
        return 'group_chat requires `action` — join_group (SimpleGroupJoin) or send_group_message (one encrypted group message).'
      }

      const groupId = textArg(args, 'group_id')
      if (!groupId) {
        return 'group_chat requires `group_id` (the on-chain group pin id). Do not invent one — ask the user.'
      }
      // Task #65 defense: a bare number like "65" is the task NUMBER, not a
      // group id — a worker once guessed it and its delivery receipt landed
      // in a phantom on-chain group nobody reads.
      if (!ON_CHAIN_GROUP_ID.test(groupId)) {
        return `Invalid group_id "${groupId}": an on-chain group id is the group's pin id — exactly 64 lowercase hex chars followed by "i0" (66 characters). `
          + 'A bare number such as "65" is the TASK number, not a group id. Do not guess; ask for the real group id.'
      }

      const network = textArg(args, 'network')
      if (network && network !== 'mvc' && network !== 'doge' && network !== 'btc') {
        return `Invalid network "${network}" — must be one of mvc, doge, btc.`
      }

      const slug = actorSlug(exec)

      if (action === 'join_group') {
        const referrer = textArg(args, 'referrer')
        const k = textArg(args, 'k')
        const result = await runMetabotWithPayloadFile(
          ['chat', 'group', 'join', ...(slug ? ['--from', slug] : [])],
          {
            groupId,
            ...(referrer ? { referrer } : {}),
            ...(k ? { k } : {}),
            ...(network ? { network } : {}),
          },
          '--request-file',
          [],
          run,
          { timeoutMs: GROUP_WRITE_TIMEOUT_MS },
        )
        if (!result.ok) {
          return `Join group failed: ${result.message ?? result.code ?? 'unknown error'}`
        }
        return formatGroupPinResult('Joined group on-chain (SimpleGroupJoin).', (result.data ?? {}) as Record<string, unknown>)
      }

      // send_group_message
      const content = textArg(args, 'content')
      if (!content) {
        return 'group_chat send_group_message requires `content` (the plaintext message).'
      }
      const groupCrypto = loadGroupCrypto()
      if (!groupCrypto) {
        return 'group_chat could not load the OAC group crypto module (is the open-agent-connect runtime installed and built?); '
          + 'the message was NOT sent and nothing was written on-chain. Verify the OAC runtime installation, then retry.'
      }
      // Encrypt in-process; the CLI request carries ONLY the ciphertext —
      // plaintext group content must never reach the wire.
      const encryptedContent = groupCrypto.encryptGroupMessage(content, groupId)

      const replyPin = textArg(args, 'reply_pin')
      const channelId = textArg(args, 'channel_id')
      const mention = mentionArg(args)

      const result = await runMetabotWithPayloadFile(
        ['chat', 'group', 'send', ...(slug ? ['--from', slug] : [])],
        {
          groupId,
          content: encryptedContent,
          ...(replyPin ? { replyPin } : {}),
          ...(channelId ? { channelId } : {}),
          ...(mention.length ? { mention } : {}),
          ...(network ? { network } : {}),
        },
        '--request-file',
        [],
        run,
        { timeoutMs: GROUP_WRITE_TIMEOUT_MS },
      )
      if (!result.ok) {
        return `Send group message failed: ${result.message ?? result.code ?? 'unknown error'}`
      }
      return formatGroupPinResult('Group message sent (SimpleGroupChat).', (result.data ?? {}) as Record<string, unknown>)
    },
  }

  return [groupChat]
}

function isDuplicateToolError(error: unknown): boolean {
  return error instanceof Error && /already.*(registered|exists)|duplicate/i.test(error.message)
}

/** Register group_chat on the host global tool layer during plugin apply. */
export function bindGroupChatToolInstall(ctx: HostContext): void {
  const hostAgent: HostAgentLike = { ctx }
  for (const definition of buildGroupChatToolDefinitions({ host: ctx, hostAgent })) {
    try {
      ctx.tools?.register(definition)
    } catch (error) {
      if (!isDuplicateToolError(error)) {
        ctx.logger?.warn?.(`[oac-dsh] group-chat tool install failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
