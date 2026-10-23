/**
 * MetaTask read tools for DSH — `metatask_list`, `metatask_get`,
 * `metatask_replay` bridging the OAC CLI read surface
 * (`metabot metatask list | get --root | replay --root`), the agent-tool
 * counterpart of the panel host routes (metatask-routes.ts — argv spelling
 * is identical). OAC port of the IDBots metatask read face: the CLI owns
 * flag parsing and the daemon owns the shared projection cache, so every
 * call requires the OAC daemon running (reads included). This file renders
 * compact views and surfaces refusals verbatim; it never re-implements
 * protocol logic. Write verbs land in a later round.
 */
import type { RunFn } from './cli-payload.js'
import type { MetabotCommandResult } from './cli-bridge.js'
import { shortMetaId, shortPin } from './metatask-logic.js'
import { oacSlugOf } from './browser-tools.js'
import type { HostAgentLike, HostContext, HostToolDefinition, HostToolExec } from './context-types.js'

/** Mirrors metatask-routes.ts (the panel bridge) — keep the values in sync. */
const READ_TIMEOUT_MS = 60_000
const REFRESH_TIMEOUT_MS = 180_000

/** Node rows rendered with full columns before the table goes slim (in-band). */
const NODE_TABLE_MAX = 40

const DAEMON_HINT = 'The metatask tools need the OAC daemon running — start it and retry.'

function payloadObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberOf(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Tool error convention (metaweb-tools.ts): a readable STRING the model can act on. */
function toolError(tool: string, message: string): string {
  return `${tool} failed: ${message}`
}

/** CLI command failure: `metatask_<verb> failed: [<code>] <message>`, code optional. */
function commandFailure(tool: string, result: MetabotCommandResult): string {
  const code = result.code ? `[${result.code}] ` : ''
  return withDaemonHint(`${tool} failed: ${code}${result.message ?? result.state}`)
}

/** Thrown CLI-bridge errors (timeout, spawn failure) keep the same string shape. */
function thrownFailure(tool: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return withDaemonHint(toolError(tool, message))
}

/** Connectivity-shaped failures get the "start the daemon" hint (design Q4). */
function withDaemonHint(text: string): string {
  return looksLikeDaemonIssue(text) ? `${text}\n(${DAEMON_HINT})` : text
}

/** Connectivity-shaped failures get the "start the daemon" hint (design Q4). */
function looksLikeDaemonIssue(message: string): boolean {
  return /daemon|econnrefused|connect|fetch failed|network|timed? ?out/i.test(message)
}

/** Display name through the payload identities map; falls back to the raw metaId. */
function displayName(identities: unknown, metaId: string): string {
  const row = payloadObject(payloadObject(identities)[metaId])
  return textOf(row.name) || metaId
}

// ── compact renderers (identity maps are consumed, never echoed) ─────────────

function renderBoard(data: unknown): string {
  const board = payloadObject(data)
  const tasks = Array.isArray(board.tasks) ? board.tasks : []
  const lines: string[] = [`# MetaTask board — ${tasks.length} task(s)`]
  for (const raw of tasks) {
    const task = payloadObject(raw)
    const rootPinId = textOf(task.rootPinId)
    const progress = payloadObject(task.progress)
    const myStats = task.myStats === null || task.myStats === undefined ? null : payloadObject(task.myStats)
    const roles = Array.isArray(task.myRoles) ? task.myRoles.filter((role) => typeof role === 'string') : []
    lines.push(`- ${textOf(task.title) || '(untitled)'} (pin://${rootPinId})`)
    const facts = [
      textOf(task.mode) || 'tree',
      `author ${displayName(board.identities, textOf(task.publisher))}`,
      `progress ${numberOf(progress.verified)}/${numberOf(progress.total)} done`,
      `${numberOf(task.participantCount)} participant(s)`,
    ]
    if (task.settlementFinalized === true) facts.push('settlement finalized')
    lines.push(`  ${facts.join(' · ')}`)
    const mine: string[] = []
    if (roles.length) mine.push(`my roles: ${roles.join(', ')}`)
    if (myStats) {
      mine.push(
        `my stats: claimed ${numberOf(myStats.claimed)}, submitted ${numberOf(myStats.submitted)}, `
        + `review votes ${numberOf(myStats.reviewVotes)}, share ${numberOf(myStats.shareBP)} bp `
        + `(est. ${numberOf(myStats.estShareBP)} bp)`,
      )
    }
    if (mine.length) lines.push(`  ${mine.join(' · ')}`)
  }
  if (!tasks.length) {
    lines.push('(no tasks in the local projection yet — pass refresh=true to sweep the chain first)')
  }
  const refresh = payloadObject(board.refresh)
  const boundaryBlock = numberOf(refresh.boundaryBlock, -1)
  if (boundaryBlock >= 0) {
    lines.push(
      `Board boundary block: ${boundaryBlock} — on-chain indexing lags; the boundary block is the truth anchor, never assume real-time.`,
    )
  }
  return lines.join('\n')
}

function renderTask(data: unknown): string {
  const task = payloadObject(data)
  const nodeStates = payloadObject(task.nodeStates)
  const entries = Object.values(nodeStates).map((node) => payloadObject(node))
  const identities = task.identities
  const lines: string[] = [
    `# ${textOf(task.title) || '(untitled)'} (pin://${textOf(task.rootPinId)})`,
    `author: ${displayName(identities, textOf(task.publisher))}`,
  ]
  const policy = payloadObject(task.policy)
  const policyFacts = [
    `mode ${textOf(policy.mode) || 'tree'}`,
    `quorum ${numberOf(policy.verifyQuorum)}`,
    `split ${numberOf(policy.submitterShareBP)}/10000 to contributors`,
  ]
  const progress = payloadObject(task.progress)
  const progressFacts = [
    `progress ${numberOf(progress.verified)}/${numberOf(progress.total)} done`,
    `claimed ${numberOf(progress.claimed)}`,
    `disputed ${numberOf(progress.disputed)}`,
  ]
  if (task.taskComplete === true) progressFacts.push('task complete')
  lines.push(`${policyFacts.join(' · ')}`)
  lines.push(`${progressFacts.join(' · ')}`)

  const openNodes = Array.isArray(task.openNodes) ? task.openNodes.map((node) => payloadObject(node)) : []
  if (openNodes.length) {
    const ids = openNodes.map((node) => `${textOf(node.id)}(${textOf(node.status)})`).join(', ')
    lines.push(`openNodes (every node still short of done — idle and in-flight): ${ids}`)
  }

  lines.push(`nodes (${entries.length}):`)
  const slim = entries.length > NODE_TABLE_MAX
  entries.forEach((node, index) => {
    const status = textOf(node.status) || '?'
    const disputed = node.disputed === true ? ' disputed' : ''
    if (index >= NODE_TABLE_MAX) {
      lines.push(`  - ${textOf(node.id)} [${status}${disputed}] (slim row)`)
      return
    }
    const holder = payloadObject(node.holder)
    const holderName = holder.claimant ? shortMetaId(textOf(holder.claimant)) : '-'
    const submission = payloadObject(node.submission)
    const lead = textOf(submission.pinId) ? ` lead ${shortPin(textOf(submission.pinId))}` : ''
    lines.push(
      `  - ${textOf(node.id)} [${status}${disputed}] w=${node.weight ?? '-'} holder=${holderName} `
      + `votes=${numberOf(node.passVotes)}✓/${numberOf(node.failVotes)}✗${lead}`,
    )
  })
  if (slim) {
    lines.push(`  (${entries.length - NODE_TABLE_MAX} node(s) beyond the first ${NODE_TABLE_MAX} shown slim — large task; metatask_replay gives the full state machine view)`)
  }

  const participants = Array.isArray(task.participants) ? task.participants : []
  if (participants.length) {
    const names = participants
      .slice(0, 8)
      .map((row) => displayName(identities, textOf(payloadObject(row).metaId)))
      .join(', ')
    lines.push(`participants (${participants.length}): ${names}${participants.length > 8 ? ' …' : ''}`)
  }

  const settlement = payloadObject(task.settlement)
  if (task.settlement !== null && task.settlement !== undefined && Object.keys(settlement).length) {
    const shares = Array.isArray(settlement.shares)
      ? settlement.shares.map((row) => {
          const share = payloadObject(row)
          return `${displayName(identities, textOf(share.metaId))} ${numberOf(share.shareBP)} bp`
        }).join(', ')
      : ''
    lines.push(`settlement (finalized) at boundary ${numberOf(settlement.boundaryBlock)}: ${shares || '(no shares)'}`)
  } else {
    const estimation = payloadObject(task.estimation)
    if (task.estimation !== null && task.estimation !== undefined && Object.keys(estimation).length) {
      const shares = Array.isArray(estimation.shares)
        ? estimation.shares.map((row) => {
            const share = payloadObject(row)
            return `${displayName(identities, textOf(share.metaId))} ${numberOf(share.shareBP)} bp`
          }).join(', ')
        : ''
      lines.push(`estimation (if it settled now, ${textOf(estimation.basis) || 'weighted'} basis): ${shares || '(no shares)'}`)
    }
  }

  const freshness = payloadObject(task.freshness)
  const fresh: string[] = []
  if (numberOf(freshness.boundaryBlock, -1) >= 0) fresh.push(`boundary block ${numberOf(freshness.boundaryBlock)}`)
  if (numberOf(freshness.eventCount, -1) >= 0) fresh.push(`${numberOf(freshness.eventCount)} events`)
  if (fresh.length) lines.push(`freshness: ${fresh.join(', ')}`)
  if (Array.isArray(task.ignoredEvents) && task.ignoredEvents.length) {
    lines.push(`ignored events: ${task.ignoredEvents.length} (metatask_replay lists each reason)`)
  }
  return lines.join('\n')
}

function renderReplay(data: unknown): string {
  return `MetaTask replay (pure derivation over the cached chain events):\n${JSON.stringify(data, null, 2)}`
}

// ── shared helpers ───────────────────────────────────────────────────────────

/**
 * Resolve the session's acting OAC bot slug (live session agent first, then
 * the composed preset). The participation round's write verbs pass it as
 * `--from`; the read tools here never need an actor.
 */
export function metataskActorSlug(host: HostContext, hostAgent: HostAgentLike, exec: HostToolExec): string {
  const agent = exec.agent ?? hostAgent
  const live = oacSlugOf(host, agent)
  if (live) return live
  const preset = host.agentPresets?.composedPreset?.(agent.ctx)
  return typeof preset === 'string' ? preset.replace(/^oac-/, '') : ''
}

// ── builder + bind ───────────────────────────────────────────────────────────

export function buildMetataskTools(input: {
  host: HostContext
  hostAgent: HostAgentLike
  run?: RunFn
}): HostToolDefinition[] {
  const run = input.run ?? (async (args, options) => {
    const { runMetabot } = await import('./cli-bridge.js')
    return runMetabot(args, options)
  })

  const render = (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
  ]

  const list: HostToolDefinition = {
    name: 'metatask_list',
    description:
      'List on-chain MetaTasks from the local chain-sourced projection: root pinId, title, root author, '
      + 'progress (done/total), participant count, my roles (root author / participant), my stats (activity '
      + 'counts plus settled and estimated share in basis points), and the board boundary block. '
      + 'Pass refresh=true to force a chain sweep first (slower; the default reads the cache). '
      + 'On-chain indexing lags — the boundary block is the truth anchor, never assume real-time. '
      + 'Requires the OAC daemon running.',
    parameters: {
      type: 'object',
      properties: {
        refresh: {
          type: 'boolean',
          description: 'true to force a background chain sweep before reading (refresh is a parameter here, not a separate tool).',
        },
      },
    },
    output: { schema: { type: 'string' }, render },
    timeoutMs: REFRESH_TIMEOUT_MS,
    execute: async (args: Record<string, unknown>) => {
      const refresh = args.refresh === true
      try {
        const result = await run(
          ['metatask', 'list', ...(refresh ? ['--refresh'] : [])],
          { timeoutMs: refresh ? REFRESH_TIMEOUT_MS : READ_TIMEOUT_MS },
        )
        if (!result.ok) return commandFailure('metatask_list', result)
        return renderBoard(result.data)
      } catch (error) {
        return thrownFailure('metatask_list', error)
      }
    },
  }

  const get: HostToolDefinition = {
    name: 'metatask_get',
    description:
      'Get one MetaTask in full from the local projection: policy (TTL/quorum/window/split), every node with '
      + 'status, holder, weight and vote counts, the participant roster, and the settlement manifest when '
      + 'finalized. While the task is unfinished it also reports estimation — the if-it-settled-now share split '
      + 'in whole-task basis points (null once a manifest exists). openNodes lists every node still short of '
      + 'done (both idle ones and in-flight ones — broader than only the idle). Read-only board context. '
      + 'Requires the OAC daemon running.',
    parameters: {
      type: 'object',
      properties: {
        rootPinId: { type: 'string', description: 'Task root pinId (64 lowercase hex + i0, 66 chars).' },
        refresh: {
          type: 'boolean',
          description: 'true to force a background chain sweep of this task before reading.',
        },
      },
      required: ['rootPinId'],
    },
    output: { schema: { type: 'string' }, render },
    timeoutMs: REFRESH_TIMEOUT_MS,
    execute: async (args: Record<string, unknown>) => {
      const rootPinId = textOf(args.rootPinId)
      if (!rootPinId) return toolError('metatask_get', 'rootPinId is required.')
      const refresh = args.refresh === true
      try {
        const result = await run(
          ['metatask', 'get', '--root', rootPinId, ...(refresh ? ['--refresh'] : [])],
          { timeoutMs: refresh ? REFRESH_TIMEOUT_MS : READ_TIMEOUT_MS },
        )
        if (!result.ok) return commandFailure('metatask_get', result)
        return renderTask(result.data)
      } catch (error) {
        return thrownFailure('metatask_get', error)
      }
    },
  }

  const replay: HostToolDefinition = {
    name: 'metatask_replay',
    description:
      'Re-run the local MetaTask replay engine over the cached chain events for one task root and return the '
      + 'derived state table plus the settlement manifest (when finalizable): pure derivation, chain facts in, '
      + 'projection out. Use it to double-check a state before acting, or to compute the would-be settlement '
      + 'split. Read-only. Requires the OAC daemon running.',
    parameters: {
      type: 'object',
      properties: {
        rootPinId: { type: 'string', description: 'Task root pinId (64 lowercase hex + i0, 66 chars).' },
      },
      required: ['rootPinId'],
    },
    output: { schema: { type: 'string' }, render },
    timeoutMs: READ_TIMEOUT_MS,
    execute: async (args: Record<string, unknown>) => {
      const rootPinId = textOf(args.rootPinId)
      if (!rootPinId) return toolError('metatask_replay', 'rootPinId is required.')
      try {
        const result = await run(['metatask', 'replay', '--root', rootPinId], { timeoutMs: READ_TIMEOUT_MS })
        if (!result.ok) return commandFailure('metatask_replay', result)
        return renderReplay(result.data)
      } catch (error) {
        return thrownFailure('metatask_replay', error)
      }
    },
  }

  return [list, get, replay]
}

function isDuplicateToolError(error: unknown): boolean {
  return error instanceof Error && /already.*(registered|exists)|duplicate/i.test(error.message)
}

/** Register the MetaTask read tools on the host global layer during plugin apply. */
export function bindMetataskToolInstall(ctx: HostContext): void {
  for (const definition of buildMetataskTools({ host: ctx, hostAgent: { ctx } })) {
    try {
      ctx.tools?.register(definition)
    } catch (error) {
      if (!isDuplicateToolError(error)) {
        ctx.logger?.warn?.(`[oac-dsh] metatask tool install failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
