/**
 * MetaWeb surf native tools (OAC port of the IDBots surfAgentTools):
 * metaweb_surf_start fires one unattended surf run through the daemon (CLI
 * `surf run --trigger manual-chat`, fire-and-forget); metaweb_surf_status
 * reads the run store + settings in-process (same dist-root resolution as
 * the other read tools). The nightly qa-surf alias tools
 * (metaweb_qa_surf_enqueue/disable) retarget here — enrolling a Bot now
 * enables pre-dream surfing and retires the legacy study job (IDBots 0.9.1
 * migration semantics).
 */
import { core, twinFallbackSlug } from './local-read.js'
import { runMetabot } from './cli-bridge.js'
import type { RunFn } from './cli-payload.js'
import { actorHomeDir, oacSlugOf } from './browser-tools.js'
import type { HostAgentLike, HostContext, HostToolDefinition, HostToolExec } from './context-types.js'

const START_TIMEOUT_MS = 60_000

interface SurfStoreModule {
  createMetawebSurfStore(paths: unknown): {
    listRuns(limit?: number): Promise<Array<Record<string, unknown>>>
  }
}

interface SurfSettingsModule {
  createSurfSettingsStore(paths: unknown): {
    read(): Promise<{ surfBeforeDreamEnabled: boolean; interactionBudget: number }>
    update(patch: { surfBeforeDreamEnabled?: boolean }): Promise<{ surfBeforeDreamEnabled: boolean; interactionBudget: number }>
  }
}

const render = (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [
  { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
]

function toolError(tool: string, error: unknown): string {
  return `${tool} failed: ${error instanceof Error ? error.message : String(error)}`
}

/** Resolve the acting bot (session oac-* agent first, Twin fallback last). */
async function sessionSlugOf(
  host: HostContext,
  exec: HostToolExec,
  input: {
    resolveHomeDir?: (slug: string) => Promise<string>
    resolveFallbackSlug?: () => Promise<string | null | undefined>
    fallbackSlug?: string
  },
): Promise<{ slug: string; homeDir: string; viaFallback: boolean } | null> {
  const agent = exec.agent as HostAgentLike | undefined
  let slug = (agent ? oacSlugOf(host, agent) : undefined) ?? ''
  let viaFallback = false
  if (!slug) {
    slug = typeof input.fallbackSlug === 'string' && input.fallbackSlug
      ? input.fallbackSlug
      : (await input.resolveFallbackSlug?.()) ?? ''
    viaFallback = slug !== ''
  }
  if (!slug) return null
  return { slug, homeDir: await (input.resolveHomeDir ?? actorHomeDir)(slug), viaFallback }
}

export interface SurfToolDeps {
  host: HostContext
  run?: RunFn
  /** Resolve a Bot slug to its profile homeDir; defaults to the shared resolution. */
  resolveHomeDir?: (slug: string) => Promise<string>
  /** Machine-default Bot (the Twin) when the session has no oac-* agent. */
  resolveFallbackSlug?: () => Promise<string | null | undefined>
  /** knowledgebase-tools passes the fallback as a plain slug string. */
  fallbackSlug?: string
}

function surfStoreFor(homeDir: string): ReturnType<SurfStoreModule['createMetawebSurfStore']> {
  const { resolveMetabotPaths } = core('core/state/paths.js') as {
    resolveMetabotPaths(homeDir: string): unknown
  }
  const storeModule = core('core/surf/store.js') as unknown as SurfStoreModule
  return storeModule.createMetawebSurfStore(resolveMetabotPaths(homeDir))
}

function surfSettingsFor(homeDir: string): ReturnType<SurfSettingsModule['createSurfSettingsStore']> {
  const { resolveMetabotPaths } = core('core/state/paths.js') as {
    resolveMetabotPaths(homeDir: string): unknown
  }
  const settingsModule = core('core/surf/settings.js') as unknown as SurfSettingsModule
  return settingsModule.createSurfSettingsStore(resolveMetabotPaths(homeDir))
}

function runsText(runs: Array<Record<string, unknown>>): string {
  const formatModule = core('core/surf/format.js') as unknown as {
    formatSurfRunList(runs: Array<Record<string, unknown>>): string
  }
  return formatModule.formatSurfRunList(runs)
}

function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function buildSurfToolDefinitions(input: SurfToolDeps): HostToolDefinition[] {
  const run = input.run ?? (async (args, options) => runMetabot(args, options))

  const metawebSurfStart: HostToolDefinition = {
    name: 'metaweb_surf_start',
    description: [
      'Start one autonomous MetaWeb surf run ("AI 冲浪"), as the MetaBot that owns this session.',
      'Use when the user asks you to go surf / browse the AI internet (去冲浪、上网逛逛), or when you decide a surf would help: you will catch up on new chain content since your last surf, search & learn old content relevant to your role, engage (like/comment/answer) as your persona sees fit, and handle chain notifications addressed to you.',
      'The run is unattended and asynchronous: this call only starts it. While it runs you cannot start a second one; the structured surf report lands in your surf records (metaweb_surf_status) and, for nightly runs, feeds tonight\'s dream.',
      'If your Memory is off the surf still runs, but degraded: you browse, engage, and handle your inbox — nothing can be saved into knowledge bases or memory, and the report notes what you would have saved.',
      'Interactions cost on-chain fees and are capped by the bot\'s per-run interaction budget. Do not start a surf when one is already running — check metaweb_surf_status first if unsure.',
    ].join(' '),
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'string' }, render },
    timeoutMs: START_TIMEOUT_MS,
    execute: async (_args, exec) => {
      const session = await sessionSlugOf(input.host, exec, input)
      if (!session) {
        return toolError('metaweb_surf_start', 'could not resolve which local Bot owns this session — retry from an oac-* conversation')
      }
      try {
        const running = (await surfStoreFor(session.homeDir).listRuns(1))[0]
        if (running && running.status === 'running') {
          return 'A surf run is already in progress for you right now. Let it finish — check metaweb_surf_status for the outcome.'
        }
        const result = await run(['surf', 'run', '--from', session.slug, '--trigger', 'manual-chat'], {
          timeoutMs: START_TIMEOUT_MS - 5_000,
        })
        if (!result.ok) {
          return toolError('metaweb_surf_start', result.message ?? result.code ?? 'surf run failed')
        }
        const runId = (result.data as { runId?: string } | null)?.runId ?? ''
        return [
          'Surf started — you are now browsing MetaWeb in the background (fresh digest → search & learn → persona-driven engagement → your inbox).',
          runId ? `- run id: ${runId}` : null,
          'The structured surf report will appear in your surf records when the run finishes; the user can also read it in the bot editor\'s advanced tab.',
        ].filter(Boolean).join('\n')
      } catch (error) {
        return toolError('metaweb_surf_start', error)
      }
    },
  }

  const metawebSurfStatus: HostToolDefinition = {
    name: 'metaweb_surf_status',
    description: [
      'List your recent MetaWeb surf runs (newest first): status, what was fetched/learned/saved, and how you engaged.',
      'Use to answer "what did you learn on your last surf / 你上次冲浪学到了什么", or to check whether a surf is currently running before starting one.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'How many recent runs to list (default 5, max 50).' },
      },
    },
    output: { schema: { type: 'string' }, render },
    timeoutMs: 20_000,
    execute: async (args, exec) => {
      const session = await sessionSlugOf(input.host, exec, input)
      if (!session) {
        return toolError('metaweb_surf_status', 'could not resolve which local Bot owns this session — retry from an oac-* conversation')
      }
      try {
        const limit = Math.max(1, Math.min(50, Math.floor(numberArg(args, 'limit') ?? 5)))
        const runs = await surfStoreFor(session.homeDir).listRuns(limit)
        const running = runs.some((entry) => entry.status === 'running')
        const header = running ? 'A surf run is IN PROGRESS right now.\n' : ''
        return `${header}${runsText(runs)}`
      } catch (error) {
        return toolError('metaweb_surf_status', error)
      }
    },
  }

  return [metawebSurfStart, metawebSurfStatus]
}

/**
 * Legacy alias semantics (IDBots 0.9.1 parity): metaweb_qa_surf_enqueue now
 * enables pre-dream surfing, retires the legacy study job, and starts one
 * surf immediately; metaweb_qa_surf_disable disables pre-dream surfing.
 * Exported for knowledgebase-tools to wire onto the existing tool names.
 */
export async function qaSurfAliasEnqueue(input: SurfToolDeps, exec: HostToolExec): Promise<string> {
  const session = await sessionSlugOf(input.host, exec, input)
  if (!session) return toolError('metaweb_qa_surf_enqueue', 'could not resolve which local Bot owns this session')
  const run = input.run ?? (async (args, options) => runMetabot(args, options))
  try {
    // IDBots alias semantics, in-process like the original: flip the setting,
    // retire the legacy study job, then start one surf immediately (CLI).
    await surfSettingsFor(session.homeDir).update({ surfBeforeDreamEnabled: true })
    let retired = false
    try {
      const { resolveMetabotPaths } = core('core/state/paths.js') as { resolveMetabotPaths(homeDir: string): unknown }
      const studyModule = core('core/knowledgebase/studyJobs.js') as unknown as {
        createStudyJobStore(paths: unknown): {
          listStudyJobs(slug: string): Promise<Array<{ kind: string; status: string }>>
          disableQaSurfJob(slug: string, summary?: string): Promise<boolean>
        }
      }
      const studyStore = studyModule.createStudyJobStore(resolveMetabotPaths(session.homeDir))
      retired = await studyModuleRetire(studyStore, session.slug)
    } catch {
      // A sick study store never blocks enabling surf.
    }
    const start = await run(['surf', 'run', '--from', session.slug, '--trigger', 'manual-chat'], {
      timeoutMs: START_TIMEOUT_MS - 5_000,
    })
    const runId = start.ok ? ((start.data as { runId?: string } | null)?.runId ?? '') : ''
    return [
      'Nightly MetaWeb surfing enabled (the new full AI-internet surf: Q&A, buzz, articles, encyclopedia, your inbox).',
      retired
        ? 'The legacy Q&A-only surf job was retired — Q&A browsing now happens inside the nightly surf run.'
        : 'Q&A browsing now happens inside the nightly surf run.',
      runId ? `One surf is starting right now (run id: ${runId}); progress shows in metaweb_surf_status.` : 'Start one anytime with metaweb_surf_start; progress shows in metaweb_surf_status.',
    ].join('\n')
  } catch (error) {
    return toolError('metaweb_qa_surf_enqueue', error)
  }
}

/** Retire active qa-surf jobs (IDBots 0.9.1 migration wording). */
async function studyModuleRetire(
  store: {
    listStudyJobs(slug: string): Promise<Array<{ kind: string; status: string }>>
    disableQaSurfJob(slug: string, summary?: string): Promise<boolean>
  },
  slug: string,
): Promise<boolean> {
  const jobs = await store.listStudyJobs(slug)
  const active = jobs.some((job) => job.kind === 'qa-surf' && (job.status === 'pending' || job.status === 'running'))
  if (!active) return false
  return store.disableQaSurfJob(
    slug,
    'Superseded by MetaWeb surf: Q&A browsing now happens inside the nightly surf run.',
  )
}

export async function qaSurfAliasDisable(input: SurfToolDeps, exec: HostToolExec): Promise<string> {
  const session = await sessionSlugOf(input.host, exec, input)
  if (!session) return toolError('metaweb_qa_surf_disable', 'could not resolve which local Bot owns this session')
  const run = input.run ?? (async (args, options) => runMetabot(args, options))
  try {
    await surfSettingsFor(session.homeDir).update({ surfBeforeDreamEnabled: false })
    await run(['surf', 'disable', '--from', session.slug], { timeoutMs: 30_000 }).catch(() => undefined)
    return 'Nightly MetaWeb surfing disabled. Everything already answered and saved stays with you; future nightly runs are stopped. Re-enable anytime with metaweb_qa_surf_enqueue.'
  } catch (error) {
    return toolError('metaweb_qa_surf_disable', error)
  }
}

/** Host-global registration (every session sees the tools from turn 1). */
export function bindSurfToolInstall(ctx: HostContext): void {
  for (const definition of buildSurfToolDefinitions({
    host: ctx,
    resolveHomeDir: actorHomeDir,
    resolveFallbackSlug: twinFallbackSlug,
  })) {
    try {
      ctx.tools?.register(definition)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/duplicate/i.test(message)) {
        ctx.logger?.warn?.(`[oac-dsh] surf tool install failed: ${message}`)
      }
    }
  }
}
