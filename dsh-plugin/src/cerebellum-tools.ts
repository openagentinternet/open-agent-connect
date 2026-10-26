/**
 * Cerebellum (小脑) turn-path wiring — Round 3 PR-3 on top of the merged
 * core (PR-1): the brain-callable `intuition` agent tool, the pre-step
 * skill/service shortlist message, and the spawned-agent reasoning-effort
 * selector. Semantics port from IDBots @ d75bea8ac2249da4886bfa0f6f1db838d234ef1f
 * (coworkRunner.ts intuition registration :12622-12720, effort chain
 * :10010-10110; the pure modules live in src/cerebellum/questions/).
 *
 * DEFAULT OFF, ZERO BEHAVIOR DELTA: with the cerebellum section absent or
 * `enabled !== true` (a) the `intuition` tool is NEVER registered (the sync
 * mount probe resolves false), (b) the pre-step observer returns the inner
 * decision untouched after one cheap sync probe — no message is appended,
 * (c) the spawned-effort resolver returns null and every agents.create call
 * site keeps the exact previous agentOptions.
 *
 * Failure contract: nothing here may block or break a turn. Every path is
 * fail-open; logging carries verdict/latency/ids/counts only — never the
 * judged text, never the API key (design doc §5.3 standing rules).
 */
import { randomUUID } from 'node:crypto'
import { runMetabot } from './cli-bridge.js'
import type { RunFn } from './cli-payload.js'
import { slugFromPresetId } from './chip-logic.js'
import { oacMessageSource } from './message-source.js'
import { isRemoteContentAgent } from './remote-content-guard.js'
import type {
  HostAgentLike,
  HostContext,
  HostTextBlock,
  HostToolDefinition,
  HostUserMessage,
} from './context-types.js'
import type { CerebellumRuntime } from './cerebellum/client.js'
import {
  askCerebellumIntuition,
  CEREBELLUM_INTUITION_WINDOW_MAX_CALLS,
  CEREBELLUM_INTUITION_WINDOW_MS,
  validateIntuitionInput,
} from './cerebellum/questions/intuitionTool.js'
import {
  buildRemoteServiceShortlistBlock,
  type CerebellumRemoteServiceCandidate,
} from './cerebellum/questions/remoteServiceShortlist.js'
import {
  buildSkillShortlistBlock,
  type CerebellumSkillCandidate,
} from './cerebellum/questions/skillShortlist.js'
import { runCerebellumTurnDecisions } from './cerebellum/questions/turnDecisionBundle.js'
import {
  CEREBELLUM_EFFORT_STICKY_WINDOW_MS,
  resolveStickyAutoEffortRung,
  selectEffortWithCerebellum,
  type CerebellumEffortSticky,
} from './cerebellum/effort.js'

// ---------------------------------------------------------------------------
// intuition agent tool (IDBots coworkRunner.ts :12622-12720)
// ---------------------------------------------------------------------------

/**
 * Tool-call budget backstop. The executor itself aborts at
 * CEREBELLUM_INTUITION_TIMEOUT_MS (3000 ms, the ported constant); this outer
 * ceiling only exists so a wedged executor cannot hold the turn forever.
 */
export const INTUITION_TOOL_TIMEOUT_MS = 10_000;

/** Teaching description — IDBots verbatim; the WHEN/WHEN-NOT sections are
 * load-bearing (keep them when editing). */
const INTUITION_TOOL_DESCRIPTION = [
  'Your built-in fast "intuition" module: a lightweight decision model that returns calibrated probabilities for judgments you choose to delegate.',
  'It only judges the `context` you provide — it never generates text.',
  'Question types: "noul" = yes/no likelihood (0-1 probability); "choice" = pick among named options (probability distribution); "score" = rate on an ordered scale of level descriptions.',
  '',
  'WHEN to use:',
  '1. Choosing between candidates by soft fit — "which draft best matches this user\'s tone preference", "which title would this user click".',
  '2. Judging likelihood from context — "is this claim consistent with what I know about this user".',
  '3. Calibrated quality/fit ratings when a trustworthy number beats a gut guess.',
  'Up to 6 questions about the SAME context are evaluated in parallel per call.',
  '',
  'WHEN NOT to use:',
  '- Never for anything computable (counting, dates, arithmetic) or facts you can look up with other tools.',
  '- Never for generating, rewriting, or summarizing text.',
  '- Not a substitute for your own reasoning on every turn — call it only when a probability you can trust beats guessing.',
  '',
  'How to ask well: keep each question atomic and self-contained; English wording works best while `context` can stay in the user\'s language; give each choice option a one-line description; order score levels from the low end to the high end.',
  'Output: answers keyed by question id with probabilities/confidence. They are calibrated across groups, NOT per-case guarantees — weigh them as evidence, not truth.',
].join('\n')

/** Per-session rolling-window state (3 calls / 60 s, IDBots constants). */
interface IntuitionWindowState {
  startAt: number
  calls: number
}

export interface IntuitionToolDependencies {
  ctx: HostContext
  runtime: CerebellumRuntime
  /** Injected clock (tests). */
  now?: () => number
}

/**
 * Build the `intuition` agent tool. The definition mirrors the IDBots
 * registration: JSON-schema parameters (the IDBots zod shape), hard input
 * caps enforced by the ported validator, the per-session 3/60 s rolling
 * window, and an honest no-verdict on every failure mode.
 */
export function buildIntuitionToolDefinition(input: IntuitionToolDependencies): HostToolDefinition {
  const now = input.now ?? Date.now
  const windowBySession = new Map<string, IntuitionWindowState>()
  const render = (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
  ]

  return {
    name: 'intuition',
    description: INTUITION_TOOL_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        context: {
          type: 'string',
          description: 'The single shared text to judge — quote the user\'s original words or the content itself; any language.',
        },
        questions: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          description: 'Questions evaluated in parallel against the same context.',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                pattern: '^[a-zA-Z0-9_-]{1,32}$',
                description: 'Short unique answer key (defaults to q1, q2, ...).',
              },
              type: {
                type: 'string',
                enum: ['noul', 'choice', 'score'],
                description: 'noul = yes/no probability; choice = pick among options; score = rate on ordered levels.',
              },
              question: {
                type: 'string',
                description: 'One atomic judgment, English wording works best; it is evaluated against `context`.',
              },
              options: {
                type: 'object',
                additionalProperties: { type: 'string' },
                description: 'choice only: { option_id: one-line description }, 2-24 options.',
              },
              levels: {
                type: 'array',
                items: { type: 'string' },
                description: 'score only: 2-10 descriptions ordered from the low end to the high end of the scale.',
              },
            },
            required: ['type', 'question'],
          },
        },
      },
      required: ['context', 'questions'],
    },
    output: { schema: { type: 'string' }, render },
    timeoutMs: INTUITION_TOOL_TIMEOUT_MS,
    execute: async (args: Record<string, unknown>, exec) => {
      const validation = validateIntuitionInput(args)
      if (!validation.questions) {
        return validation.error ?? 'intuition: invalid input.'
      }

      // Rolling window per DSH session (IDBots keeps this on the active
      // session; here it is a map keyed by the session id, pruned lazily).
      const session = (exec?.agent as { session?: { id?: unknown } } | undefined)?.session
      const sessionId = typeof session?.id === 'string' && session.id ? session.id : 'global'
      const at = now()
      let window = windowBySession.get(sessionId)
      if (!window || at - window.startAt > CEREBELLUM_INTUITION_WINDOW_MS) {
        window = { startAt: at, calls: 0 }
        windowBySession.set(sessionId, window)
      }
      if (window.calls >= CEREBELLUM_INTUITION_WINDOW_MAX_CALLS) {
        return `intuition: rate limit — at most ${CEREBELLUM_INTUITION_WINDOW_MAX_CALLS} calls per minute on this session. Decide with your own judgment for now.`
      }
      window.calls += 1
      if (windowBySession.size > 512) {
        for (const [key, entry] of [...windowBySession]) {
          if (at - entry.startAt > CEREBELLUM_INTUITION_WINDOW_MS) {
            windowBySession.delete(key)
          }
        }
      }

      input.ctx.logger?.info?.(
        `[oac-dsh] cerebellum:intuition invoked {questionCount:${validation.questions.length}}`,
      )
      const startedAt = now()
      const callContext = await input.runtime.resolveCallContext()
      if (!callContext) {
        return 'intuition: no verdict (the fast-decision model is unavailable or timed out). Proceed with your own judgment — do not retry immediately.'
      }
      const result = await askCerebellumIntuition({
        config: callContext.config,
        fetchImpl: callContext.fetchImpl,
        context: typeof args.context === 'string' ? args.context : '',
        questions: validation.questions,
      })
      input.ctx.logger?.info?.(
        `[oac-dsh] cerebellum:intuition evaluated {used:${result !== null},inputTokens:${result?.inputTokens ?? 0},latencyMs:${now() - startedAt}}`,
      )
      if (!result) {
        return 'intuition: no verdict (the fast-decision model is unavailable or timed out). Proceed with your own judgment — do not retry immediately.'
      }
      return 'intuition result (probabilities are calibrated across groups, NOT per-case guarantees — weigh them as a signal, not truth):\n'
        + JSON.stringify(result.answers, null, 2)
    },
  }
}

/**
 * Register the `intuition` tool on the host global layer. Mount probe = the
 * runtime's SYNC config resolve (IDBots `cerebellumIntuitionAvailable`):
 * unconfigured/disabled (the default) registers NOTHING — the tool is
 * absent from the model's surface entirely, not merely non-functional.
 *
 * Remote-content sessions (chat peers, group-task work turns) refuse the
 * tool at execute time: sending remote-authored text to the fast-decision
 * provider is outside the consented content categories (IDBots restricts
 * the tool to cowork_ui owner sessions — the OAC privacy line for external
 * content is the remote-content mark).
 */
export function bindCerebellumToolInstall(ctx: HostContext, input: { runtime: CerebellumRuntime }): void {
  if (!input.runtime.available()) {
    return
  }
  const base = buildIntuitionToolDefinition({ ctx, runtime: input.runtime })
  const guarded: HostToolDefinition = {
    ...base,
    execute: async (args, exec) => {
      if (isRemoteContentAgent(exec?.agent)) {
        return 'intuition is not available while answering remote-driven content (a chat peer or group task): sending remote-authored text to the fast-decision provider is outside the consented content categories. Judge with your own reasoning instead.'
      }
      return base.execute(args, exec)
    },
  }
  try {
    ctx.tools?.register(guarded)
  } catch (error) {
    if (!/already.*(registered|exists)|duplicate/i.test(error instanceof Error ? error.message : String(error))) {
      ctx.logger?.warn?.(`[oac-dsh] intuition tool install failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Pre-step skill/service shortlists (IDBots turn-decision bundle slice)
// ---------------------------------------------------------------------------

const SKILLS_LIST_TIMEOUT_MS = 35_000
const SERVICES_LIST_TIMEOUT_MS = 30_000
/**
 * Catalog cache TTL. IDBots reads in-process stores per turn; OAC reaches
 * both catalogs through CLI subprocesses, so a short cache keeps the
 * pre-step cheap on back-to-back turns (mechanical difference, listed in
 * the PR diff table).
 */
const SHORTLIST_CATALOG_CACHE_TTL_MS = 60_000

interface CatalogCacheEntry<T> {
  at: number
  value: T[]
}

function textFromBlocks(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      const candidate = block as { type?: unknown; text?: unknown }
      return candidate.type === 'text' && typeof candidate.text === 'string' ? candidate.text : ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

/** The human's text for this turn: the last user-role message in the
 * INCOMING payload (before any plugin append), counting only genuine
 * `source.kind === 'user'` messages — the same discipline as the
 * session-event mirror (machine-produced context is never the human's
 * words). */
function humanTextFromIncoming(messages: HostUserMessage[] | undefined): string {
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user' && message.source?.kind === 'user') {
      const text = textFromBlocks(message.content)
      if (text) return text
    }
  }
  return ''
}

function presetSlugForAgent(ctx: HostContext, agent: HostAgentLike): string | null {
  const preset = ctx.agentPresets?.composedPreset?.(agent.ctx)
  return preset ? (slugFromPresetId(preset) ?? null) : null
}

async function fetchSkillCatalog(
  run: RunFn,
  cache: CatalogCacheEntry<CerebellumSkillCandidate> | { at: number; value: CerebellumSkillCandidate[] },
): Promise<CerebellumSkillCandidate[]> {
  if (Date.now() - cache.at <= SHORTLIST_CATALOG_CACHE_TTL_MS) {
    return cache.value
  }
  const result = await run(['skills', 'list'], { timeoutMs: SKILLS_LIST_TIMEOUT_MS })
  if (!result.ok) return cache.value
  const skills = (result.data as { skills?: Array<{ name?: unknown; description?: unknown }> } | undefined)?.skills
  const value: CerebellumSkillCandidate[] = Array.isArray(skills)
    ? skills
      .map((skill) => ({
        id: typeof skill?.name === 'string' ? skill.name.trim() : '',
        name: typeof skill?.name === 'string' ? skill.name.trim() : '',
        description: typeof skill?.description === 'string' ? skill.description : '',
      }))
      .filter((skill) => skill.id)
    : []
  cache.at = Date.now()
  cache.value = value
  return value
}

async function fetchServiceDirectory(
  run: RunFn,
  cache: { at: number; value: CerebellumRemoteServiceCandidate[] },
): Promise<CerebellumRemoteServiceCandidate[]> {
  if (Date.now() - cache.at <= SHORTLIST_CATALOG_CACHE_TTL_MS) {
    return cache.value
  }
  const result = await run(['network', 'services', '--online'], { timeoutMs: SERVICES_LIST_TIMEOUT_MS })
  if (!result.ok) return cache.value
  const services = (result.data as { services?: Array<{ servicePinId?: unknown; displayName?: unknown; serviceName?: unknown; description?: unknown }> } | undefined)?.services
  const value: CerebellumRemoteServiceCandidate[] = Array.isArray(services)
    ? services
      .map((service) => ({
        id: typeof service?.servicePinId === 'string' ? service.servicePinId.trim() : '',
        name: typeof service?.displayName === 'string' && service.displayName.trim()
          ? service.displayName.trim()
          : (typeof service?.serviceName === 'string' ? service.serviceName.trim() : ''),
        description: typeof service?.description === 'string' ? service.description : '',
      }))
      .filter((service) => service.id)
    : []
  cache.at = Date.now()
  cache.value = value
  return value
}

/**
 * Mount the pre-step shortlist observer: ONE extra small user-tail message
 * beside the memory message, carrying the <skill_shortlist> and (when the
 * directory pool clears its floor) <remote_service_shortlist> blocks for
 * this turn. Both rankings ride ONE /v1/systemone request (the ported
 * turn-decision bundle with the memory/knowledge pools empty — their
 * min-pool floors contribute no questions) with per-decision independent
 * degradation: a null ranking simply omits its block, and when both are
 * null no message is appended at all.
 *
 * Privacy posture: fires only for non-remote-content oac-* preset sessions
 * (remote-driven sessions keep the established posture and get no JEV
 * shortlist), and only when the cerebellum is enabled AND resolves a call
 * context — otherwise the inner decision returns untouched (zero message
 * delta).
 */
export function applyCerebellumShortlists(
  ctx: HostContext,
  options: { runtime: CerebellumRuntime; run?: RunFn },
): void {
  if (!ctx.on) return
  const run = options.run ?? runMetabot
  const skillCache: { at: number; value: CerebellumSkillCandidate[] } = { at: 0, value: [] }
  const serviceCache: { at: number; value: CerebellumRemoteServiceCandidate[] } = { at: 0, value: [] }

  ctx.on(
    'agent/pre-step',
    async (
      payload: { agent: HostAgentLike; messages?: HostUserMessage[] },
      next: () => Promise<{ kind: string; messages?: HostUserMessage[] }>,
    ): Promise<{ kind: string; messages?: HostUserMessage[] }> => {
      const decision = await next()
      if (decision.kind !== 'enter' || !Array.isArray(decision.messages)) {
        return decision
      }
      try {
        // Zero-delta fast path: sync probe first; off means no awaits at all.
        if (!options.runtime.available()) {
          return decision
        }
        const slug = presetSlugForAgent(ctx, payload.agent)
        if (!slug) return decision
        if (isRemoteContentAgent(payload.agent)) return decision
        const userText = humanTextFromIncoming(payload.messages)
        if (!userText.trim()) return decision
        const callContext = await options.runtime.resolveCallContext()
        if (!callContext) return decision

        const [skills, services] = await Promise.all([
          fetchSkillCatalog(run, skillCache),
          fetchServiceDirectory(run, serviceCache),
        ])
        const results = await runCerebellumTurnDecisions({
          config: callContext.config,
          fetchImpl: callContext.fetchImpl,
          decisions: {
            currentUserText: userText,
            memories: [],
            knowledge: [],
            skills,
            services,
            includeGate: false,
          },
        })
        if (!results) return decision

        const blocks: string[] = []
        if (results.skillRanking && results.skillRanking.length > 0) {
          const byId = new Map(skills.map((skill) => [skill.id, skill]))
          const entries = results.skillRanking
            .map((entry) => {
              const candidate = byId.get(entry.id)
              return candidate ? { ...candidate, probability: entry.probability } : null
            })
            .filter((entry): entry is CerebellumSkillCandidate & { probability: number } => entry !== null)
          if (entries.length > 0) blocks.push(buildSkillShortlistBlock(entries))
        }
        if (results.serviceRanking && results.serviceRanking.length > 0) {
          const byId = new Map(services.map((service) => [service.id, service]))
          const entries = results.serviceRanking
            .map((entry) => {
              const candidate = byId.get(entry.id)
              return candidate ? { ...candidate, probability: entry.probability } : null
            })
            .filter((entry): entry is CerebellumRemoteServiceCandidate & { probability: number } => entry !== null)
          if (entries.length > 0) blocks.push(buildRemoteServiceShortlistBlock(entries))
        }
        if (blocks.length === 0) return decision

        const text = blocks.join('\n\n')
        const shortlistMessage: HostUserMessage = {
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text } as HostTextBlock],
          source: { ...oacMessageSource('snapshot'), sections: [{ name: 'oac:cerebellum-shortlist', text }] },
        }
        return { kind: 'enter', messages: [...decision.messages, shortlistMessage] }
      } catch {
        // Shortlists are an enhancement; a failure must not break the turn.
        return decision
      }
    },
    { prepend: true },
  )
}

// ---------------------------------------------------------------------------
// Spawned-agent reasoning-effort selector (IDBots effort chain, unattended
// spawn form — design doc §2.2 B10)
// ---------------------------------------------------------------------------

/** IDBots sticky-map bound (coworkRunner.ts :10041). */
const EFFORT_STICKY_MAP_BOUND = 128

export interface SpawnedEffortInput {
  /** Stable logical session key (sticky rides it across re-spawns). */
  sessionKey: string
  /** The spawn-time user text the selector judges. */
  promptText: string
  /** The explicit brain pick (bot DSH pair reasoning effort), if any. */
  explicitEffort?: string | undefined
}

export type SpawnedEffortResolver = (input: SpawnedEffortInput) => Promise<string | null>

/**
 * Resolve the reasoning effort for a plugin-spawned agents.create call.
 * Resolution order (IDBots §1.2 semantics, spawn-path form):
 *
 *  1. explicit brain pick wins — returned verbatim, selector NOT consulted;
 *     a literal 'auto' pick maps to 'max' (unattended auto-means-max, the
 *     exact IDBots unattended rule — the OAC bot-profile vocabulary is
 *     off/low/high/max, 'auto' can only arrive from other host surfaces);
 *  2. otherwise, when the cerebellum resolves a context, ONE selector call
 *     (1 s solo budget) feeds the assistant-mode two-level policy
 *     (escalate iff P(high)+P(max) ≥ 0.5, else 'off') with the ported
 *     10-minute session-sticky escalation state;
 *  3. any null (off, unconfigured, timeout, malformed, throw) returns null —
 *     the call site then keeps the previous agentOptions byte-identical.
 *
 * Never throws.
 */
export function createSpawnedEffortResolver(input: { runtime: CerebellumRuntime }): SpawnedEffortResolver {
  const stickyBySession = new Map<string, CerebellumEffortSticky>()

  return async (call: SpawnedEffortInput): Promise<string | null> => {
    try {
      const explicit = typeof call.explicitEffort === 'string' ? call.explicitEffort.trim() : ''
      if (explicit) {
        // Explicit pick is authoritative (assistant-mode escape hatch).
        if (explicit.toLowerCase() === 'auto') {
          return 'max'
        }
        return explicit
      }
      const promptText = String(call.promptText ?? '').trim()
      if (!promptText) return null
      if (!input.runtime.available()) return null
      const callContext = await input.runtime.resolveCallContext()
      if (!callContext) return null
      const distribution = await selectEffortWithCerebellum({
        config: callContext.config,
        fetchImpl: callContext.fetchImpl,
        currentUserText: promptText,
      })
      if (!distribution) return null
      const resolved = resolveStickyAutoEffortRung(distribution, {
        assistantMode: true,
        sticky: stickyBySession.get(call.sessionKey) ?? null,
      })
      if (resolved.nextSticky) {
        stickyBySession.set(call.sessionKey, resolved.nextSticky)
      } else {
        stickyBySession.delete(call.sessionKey)
      }
      // Bounded map: prune expired entries once past idle-session scale
      // (IDBots coworkRunner.ts :10054-10059).
      if (stickyBySession.size > EFFORT_STICKY_MAP_BOUND) {
        const nowMs = Date.now()
        for (const [key, entry] of [...stickyBySession]) {
          if (nowMs - entry.at > CEREBELLUM_EFFORT_STICKY_WINDOW_MS) {
            stickyBySession.delete(key)
          }
        }
      }
      return resolved.rung
    } catch {
      // Fail-open: the existing default effort chain stays untouched.
      return null
    }
  }
}
