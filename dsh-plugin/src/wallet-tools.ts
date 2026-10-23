/**
 * wallet_balance / wallet_transfer — DSH native tools bridging the OAC CLI
 * wallet commands (`wallet balance [--chain] [--from]`,
 * `wallet transfer --to --amount [--confirm] [--from]`). OAC port of the
 * IDBots wallet agent tools (src/main/libs/walletAgentTools.ts): balance is
 * a read-only UTXO-sum snapshot of local Bot wallets; transfer spends the
 * session Bot's own wallet behind the IDBots two-channel gate — targets that
 * resolve to the local roster (channel A) execute immediately, external MVC
 * addresses (channel B) require the owner's approval in the native DSH
 * dialog (or an explicit in-conversation acknowledgement when the surface
 * renders no dialog). All balance/fee/signing logic stays in the CLI; this
 * file only resolves targets, gates external sends, and formats output.
 */
import type { RunFn } from './cli-payload.js'
import type { MetabotCommandResult } from './cli-bridge.js'
import type { HostAgentLike, HostApproval, HostContext, HostToolDefinition, HostToolExec } from './context-types.js'
import { approvalOf, oacSlugOf, sessionApprovalPolicy } from './browser-tools.js'

const SATOSHI_PER_UNIT = 100_000_000
/** MVC dust limit — mirrors the IDBots client-side fail-fast check. */
const MVC_DUST_LIMIT_SATS = 600
const BALANCE_TIMEOUT_MS = 60_000
const TRANSFER_TIMEOUT_MS = 120_000
const CHAINS = ['mvc', 'btc', 'doge'] as const
type Chain = (typeof CHAINS)[number]

const CHAIN_UNIT: Record<Chain, string> = { mvc: 'SPACE', btc: 'BTC', doge: 'DOGE' }

/** Minimal local-roster record from `bot list` (IdentityProfileRecord projection). */
type LocalProfile = { name: string; slug: string; globalMetaId: string; mvcAddress: string }

/** ChainBalance fields returned by the CLI wallet balance handler. */
type ChainBalance = {
  chain?: string
  address?: string
  totalSatoshis?: number
  confirmedSatoshis?: number
  unconfirmedSatoshis?: number
  utxoCount?: number
}

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

function chainArg(args: Record<string, unknown>): Chain | undefined {
  const value = textArg(args, 'chain').toLowerCase()
  return (CHAINS as readonly string[]).includes(value) ? (value as Chain) : undefined
}

function looksLikeMvcAddress(value: string): boolean {
  // MVC/SPACE livenet addresses are base58 (start with 1, 20+ chars) — same
  // shape check as the IDBots wallet tools; the CLI remains the validator.
  return /^[1-9A-HJ-NP-Za-km-z]{20,}$/.test(value)
}

function formatSats(sats: number, unit: string): string {
  return `${sats} sats (${(sats / SATOSHI_PER_UNIT).toFixed(8)} ${unit})`
}

function formatBalanceRow(chain: string, balance: ChainBalance): string {
  const unit = CHAIN_UNIT[chain as Chain] ?? chain.toUpperCase()
  const spendable = `spendable = confirmed ${balance.confirmedSatoshis ?? 0} + unconfirmed ${balance.unconfirmedSatoshis ?? 0}`
  return `- ${chain}: ${formatSats(balance.totalSatoshis ?? 0, unit)}, ${balance.utxoCount ?? 0} UTXOs [${spendable}]`
}

function formatBalanceSection(header: string, data: unknown): string {
  const payload = (data ?? {}) as { balances?: Record<string, ChainBalance> }
  const lines = [`# ${header}`]
  const balances = payload.balances ?? {}
  for (const chain of CHAINS) {
    const balance = balances[chain]
    if (balance) lines.push(formatBalanceRow(chain, balance))
  }
  if (lines.length === 1) lines.push('(no chain balances returned)')
  return lines.join('\n')
}

/** Fetch the local roster through the CLI (`bot list`); errors come back as text. */
async function listLocalProfiles(run: RunFn): Promise<{ profiles: LocalProfile[] } | { error: string }> {
  try {
    const result = await run(['bot', 'list'], { timeoutMs: 30_000 })
    if (!result.ok) {
      return { error: `wallet: local roster lookup failed: ${result.message ?? result.code ?? 'unknown error'}` }
    }
    const rows = (result.data ?? {}) as { profiles?: LocalProfile[] }
    if (!Array.isArray(rows.profiles)) {
      return { error: 'wallet: local roster lookup returned no profiles.' }
    }
    return { profiles: rows.profiles.filter((row) => row && typeof row.slug === 'string') }
  } catch (error) {
    return { error: `wallet: local roster lookup failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}

function matchProfile(profiles: LocalProfile[], value: string): LocalProfile | undefined {
  return profiles.find((row) => row.slug === value || row.name === value)
}

function commandFailureText(action: string, result: MetabotCommandResult): string {
  return `${action} failed${result.code ? ` (${result.code})` : ''}: ${result.message ?? 'unknown error'}`
}

export function buildWalletToolDefinitions(input: {
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

  const walletBalance: HostToolDefinition = {
    name: 'wallet_balance',
    description:
      'Query wallet balances (UTXO sums) for local Bots by name or slug, optionally per chain. '
      + 'Use when the user asks for a bot wallet balance, a whole-roster balance overview, or before planning on-chain work that costs fees. '
      + 'Read-only public chain data: balance is the spendable total in sats (confirmed + unconfirmed — unconfirmed funds are usable on these chains), '
      + 'plus the UTXO count, per chain (mvc/btc/doge; omit `chain` for all three). '
      + 'Without `bots` this queries THIS session Bot\'s own wallet; pass multiple local bot names/slugs in ONE call to batch. '
      + 'This host cannot query raw addresses that belong to no local Bot — query the Bot that owns the address instead.',
    parameters: {
      type: 'object',
      properties: {
        bots: {
          type: 'array',
          items: { type: 'string' },
          description: 'Local Bot names or slugs to query, e.g. ["AI Sunny", "builder-ama"]. Defaults to this session Bot.',
        },
        chain: {
          type: 'string',
          enum: ['mvc', 'btc', 'doge'],
          description: 'Limit to one chain; omit for all three.',
        },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    },
    timeoutMs: BALANCE_TIMEOUT_MS,
    execute: async (args: Record<string, unknown>, exec: HostToolExec) => {
      const chain = args.chain != null ? chainArg(args) : undefined
      if (args.chain != null && !chain) {
        return `Invalid chain "${textArg(args, 'chain')}" — must be one of mvc, btc, doge.`
      }

      const slug = actorSlug(exec)
      const requested = stringListArg(args, 'bots')
      let targets: Array<{ slug: string; header: string }>
      if (requested) {
        const roster = await listLocalProfiles(run)
        if ('error' in roster) return roster.error
        targets = []
        for (const value of requested) {
          const profile = matchProfile(roster.profiles, value)
          if (!profile) {
            return `wallet_balance: local Bot not found by name or slug: ${value}. `
              + 'Pass names/slugs from the local roster; raw-address queries are not supported on this host.'
          }
          if (!targets.some((row) => row.slug === profile.slug)) {
            targets.push({ slug: profile.slug, header: `${profile.name} (slug ${profile.slug})` })
          }
        }
      } else {
        if (!slug) {
          return 'wallet_balance could not resolve this session\'s Bot; pass explicit `bots` names/slugs instead.'
        }
        targets = [{ slug, header: slug }]
      }

      const sections: string[] = []
      for (const target of targets) {
        try {
          const result = await run(
            ['wallet', 'balance', ...(chain ? ['--chain', chain] : []), '--from', target.slug],
            { timeoutMs: BALANCE_TIMEOUT_MS },
          )
          if (!result.ok) {
            sections.push(`# ${target.header}\n- lookup failed: ${result.message ?? result.code ?? 'unknown error'}`)
            continue
          }
          sections.push(formatBalanceSection(target.header, result.data))
        } catch (error) {
          sections.push(`# ${target.header}\n- lookup failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return sections.join('\n')
    },
  }

  const walletTransfer: HostToolDefinition = {
    name: 'wallet_transfer',
    description:
      'Transfer SPACE (MVC native coin) from THIS session Bot\'s own wallet to a target address or local Bot. '
      + 'Use when the owner asks to top up / recharge a worker bot, move funds between local bots, or send SPACE. '
      + '`to` accepts a local Bot name/slug or a raw MVC address; `amount` is in SPACE (dust limit 600 sats). '
      + 'Channel A (target resolves to the local roster): executes immediately, no confirmation. '
      + 'Channel B (external address): the CLI first previews the send (recipient, amount, estimated fee, current balance) and the owner must approve it '
      + 'in the native dialog — with from/to/amount/fee spelled out — before anything is broadcast; declining never sends. '
      + 'When this surface renders no owner dialog, the owner\'s explicit in-conversation approval must be passed as `external_confirmed: true` '
      + '(the same acknowledgement the RPC path accepts). '
      + 'Insufficient balance fails fast with a structured have/need error before broadcast. Signing stays inside the CLI; no key material is exposed.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Target: local Bot name/slug or raw MVC address.' },
        amount: { type: 'number', description: 'Amount in SPACE (e.g. 0.001). Dust limit applies (600 sats).' },
        external_confirmed: {
          type: 'boolean',
          description:
            'Set true ONLY when the owner has already approved this external transfer in the conversation and no owner dialog can render. '
            + 'Ignored whenever the native approval dialog is available.',
        },
      },
      required: ['to', 'amount'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    },
    timeoutMs: TRANSFER_TIMEOUT_MS,
    execute: async (args: Record<string, unknown>, exec: HostToolExec) => {
      const slug = actorSlug(exec)
      if (!slug) {
        return 'wallet_transfer could not determine which Bot owns this session; transfers must spend the session Bot\'s own wallet.'
      }

      const toRaw = textArg(args, 'to')
      if (!toRaw) {
        return 'wallet_transfer requires `to` (local Bot name/slug or MVC address).'
      }
      const amount = typeof args.amount === 'number' ? args.amount : Number.NaN
      if (!Number.isFinite(amount) || amount <= 0) {
        return 'wallet_transfer requires a positive `amount` in SPACE.'
      }
      const amountSats = Math.round(amount * SATOSHI_PER_UNIT)
      if (!Number.isInteger(amountSats) || amountSats < MVC_DUST_LIMIT_SATS) {
        return `wallet_transfer: amount below the MVC dust limit (${MVC_DUST_LIMIT_SATS} sats).`
      }
      const amountRaw = `${amount}SPACE`

      // Resolve `to`: local roster name/slug → the Bot's mvc address (channel
      // A, immediate); anything address-shaped is external (channel B,
      // owner-gated). The CLI remains the final validator of both.
      let toAddress = ''
      let channel: 'local' | 'external'
      if (looksLikeMvcAddress(toRaw)) {
        toAddress = toRaw
        channel = 'external'
      } else {
        const roster = await listLocalProfiles(run)
        if ('error' in roster) return roster.error
        const profile = matchProfile(roster.profiles, toRaw)
        if (!profile) {
          return `wallet_transfer: "${toRaw}" is neither a local Bot name/slug nor an address. `
            + 'For an external send pass the full MVC address.'
        }
        if (!profile.mvcAddress) {
          return `wallet_transfer: local Bot ${toRaw} has no mvc address.`
        }
        toAddress = profile.mvcAddress
        channel = 'local'
      }

      const transferArgs = (confirm: boolean): string[] => [
        'wallet', 'transfer', '--to', toAddress, '--amount', amountRaw, '--from', slug, ...(confirm ? ['--confirm'] : []),
      ]

      if (channel === 'local') {
        // Channel A — local roster target: execute immediately (IDBots R2).
        try {
          const result = await run(transferArgs(true), { timeoutMs: TRANSFER_TIMEOUT_MS })
          return result.ok
            ? formatTransferSuccess(result.data, 'local (local roster, no confirmation required)')
            : commandFailureText('Transfer', result)
        } catch (error) {
          return `Transfer failed: ${error instanceof Error ? error.message : String(error)}`
        }
      }

      // Channel B — external address: preview first (fail fast on
      // insufficient balance), then gate the broadcast on the owner.
      let preview: MetabotCommandResult
      try {
        preview = await run(transferArgs(false), { timeoutMs: TRANSFER_TIMEOUT_MS })
      } catch (error) {
        return `Transfer failed: ${error instanceof Error ? error.message : String(error)}`
      }
      if (!preview.ok && preview.state !== 'awaiting_confirmation') {
        // e.g. insufficient_balance with have/need detail — surface as-is.
        return commandFailureText('Transfer', preview)
      }
      const previewData = (preview.data ?? {}) as Record<string, unknown>
      const detail = [
        `- from: ${String(previewData.fromAddress ?? slug)}`,
        `- to: ${String(previewData.toAddress ?? toAddress)}`,
        `- amount: ${String(previewData.amount ?? `${amount} SPACE`)}`,
        `- estimated fee: ${String(previewData.estimatedFee ?? 'estimated by the wallet at send time')}`,
        ...(previewData.currentBalance != null ? [`- current balance: ${String(previewData.currentBalance)}`] : []),
      ].join('\n')

      // Owner gate (same lineage as send_private_chat): with native prompts
      // live the dialog asks; when prompts are disabled (approval/policy
      // "never") or no approval surface exists at all, the owner's explicit
      // in-conversation acknowledgement is the only path.
      const policy = approval?.overrideOf?.(exec.agent?.session) ?? sessionApprovalPolicy(exec.agent)
      if (approval && policy !== 'never') {
        const agent = exec.agent ?? hostAgent
        const reason = [
          `Send SPACE from this Bot's wallet to this external address? The transfer is broadcast on-chain and irreversible.`,
          detail,
        ].join('\n')
        const outcome = await approval.request({
          agent,
          toolName: 'wallet_transfer',
          ...(exec.callId ? { callId: exec.callId } : {}),
          reason,
          signal: exec.signal,
        })
        if (outcome !== 'allowed-once') {
          return `Owner declined the external transfer (${outcome}); nothing was sent. Do not retry the same send without the owner's explicit consent — for an in-conversation approval when no dialog can render, the owner must say so explicitly.`
        }
      } else if (args.external_confirmed !== true) {
        // No usable owner dialog (no approval surface, or prompts disabled
        // by approval/policy "never"): require the same explicit
        // acknowledgement the RPC path accepts (IDBots R2 channel B).
        return 'Transfer refused: external sends require owner approval, and this surface renders no approval dialog. '
          + 'Ask the owner to approve the send in the conversation, then retry with `external_confirmed: true`. '
          + `Preview of the send:\n${detail}`
      }

      try {
        const result = await run(transferArgs(true), { timeoutMs: TRANSFER_TIMEOUT_MS })
        return result.ok
          ? formatTransferSuccess(result.data, 'external (owner-confirmed)')
          : commandFailureText('Transfer', result)
      } catch (error) {
        return `Transfer failed: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  }

  return [walletBalance, walletTransfer]
}

function formatTransferSuccess(data: unknown, channelLine: string): string {
  const payload = (data ?? {}) as { txid?: string; amount?: string; explorerUrl?: string; toAddress?: string }
  const lines = ['Transfer broadcast on-chain.']
  if (payload.txid) lines.push(`- txid: ${payload.txid}`)
  if (payload.amount) lines.push(`- amount: ${payload.amount}`)
  if (payload.toAddress) lines.push(`- to: ${payload.toAddress}`)
  lines.push(`- channel: ${channelLine}`)
  if (payload.explorerUrl) lines.push(`- explorer: ${payload.explorerUrl}`)
  return lines.join('\n')
}

function isDuplicateToolError(error: unknown): boolean {
  return error instanceof Error && /already.*(registered|exists)|duplicate/i.test(error.message)
}

/** Register wallet_balance / wallet_transfer on the host global tool layer during plugin apply. */
export function bindWalletToolInstall(ctx: HostContext): void {
  const hostAgent: HostAgentLike = { ctx }
  for (const definition of buildWalletToolDefinitions({
    host: ctx,
    hostAgent,
    approval: approvalOf(ctx),
  })) {
    try {
      ctx.tools?.register(definition)
    } catch (error) {
      if (!isDuplicateToolError(error)) {
        ctx.logger?.warn?.(`[oac-dsh] wallet tool install failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
