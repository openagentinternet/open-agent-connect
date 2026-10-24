/**
 * MetaTask publisher-write tools for DSH — `metatask_publish`,
 * `metatask_publish_spec`, `metatask_amend` bridging the OAC CLI publisher
 * surface (`metabot metatask publish | publish-spec | amend` via
 * `--request-file`). OAC port of the IDBots metatask publisher face: the CLI
 * owns `--request-file` parsing, and the daemon-side writer owns every
 * protocol gate (publish invariants, H_ACT2/H_ACT3 gates, frozen-node and
 * finalnode rules, roster auto-pin). Every call requires the OAC daemon
 * running, and every write acts as the session's OAC bot (the slug is
 * resolved locally and passed as `--from`). This file enforces the
 * file-mode/inline mutual exclusion with readable local errors (the daemon
 * would accept both and merge — the transcription-error foot-gun), then
 * forwards the payload verbatim and surfaces refusals verbatim; it never
 * re-implements protocol logic.
 */
import { runMetabotWithPayloadFile, type RunFn } from './cli-payload.js'
import type { MetabotCommandResult } from './cli-bridge.js'
import { oacSlugOf } from './browser-tools.js'
import type { HostAgentLike, HostContext, HostToolDefinition, HostToolExec } from './context-types.js'

/**
 * Writes are sized for multi-pin flows: a publish spends up to 4 pins
 * (roster → tree → spec → task); 180s was sized for one refresh sweep.
 */
const METATASK_WRITE_TIMEOUT_MS = 300_000

const DAEMON_HINT = 'The metatask tools need the OAC daemon running — start it and retry.'

const NO_ACTOR_MESSAGE =
  'no OAC bot profile is bound to this session — metatask write verbs act as a specific MetaBot. '
  + 'Run the session under an OAC agent preset (its bot slug is passed as --from) or configure one first.'

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
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

/** Connectivity-shaped failures get the "start the daemon" hint. */
function withDaemonHint(text: string): string {
  return looksLikeDaemonIssue(text) ? `${text}\n(${DAEMON_HINT})` : text
}

function looksLikeDaemonIssue(message: string): boolean {
  return /daemon|econnrefused|connect|fetch failed|network|timed? ?out/i.test(message)
}

// ── shared helpers ───────────────────────────────────────────────────────────

/**
 * Resolve the session's acting OAC bot slug (live session agent first, then
 * the composed preset). The write verbs pass it as `--from`; when no slug
 * resolves there is no actor and the tool refuses locally instead of doing a
 * daemon `actor_required` round trip.
 */
export function metataskActorSlug(host: HostContext, hostAgent: HostAgentLike, exec: HostToolExec): string {
  const agent = exec.agent ?? hostAgent
  const live = oacSlugOf(host, agent)
  if (live) return live
  const preset = host.agentPresets?.composedPreset?.(agent.ctx)
  return typeof preset === 'string' ? preset.replace(/^oac-/, '') : ''
}

/** Write success: the daemon writer's `data` object echoed as JSON. */
function renderWriteData(data: unknown): string {
  return typeof data === 'string' ? data : JSON.stringify(data, null, 2)
}

// ── builder + bind ───────────────────────────────────────────────────────────

export function buildMetataskTools(input: {
  host: HostContext
  hostAgent: HostAgentLike
  run?: RunFn
}): HostToolDefinition[] {
  const { host, hostAgent } = input
  const run = input.run ?? (async (args, options) => {
    const { runMetabot } = await import('./cli-bridge.js')
    return runMetabot(args, options)
  })

  const render = (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
  ]

  const publish: HostToolDefinition = {
    name: 'metatask_publish',
    description:
      'Publish a new on-chain MetaTask as the session acting OAC MetaBot (you become the task root author = '
      + 'publisher; the bot slug is resolved from the session and passed as --from). Nothing is spent before '
      + 'every invariant passes: single root, acyclic parents, integer weights 1..10000 summing to EXACTLY '
      + '10000 across all nodes, quorum >= 1, TTL/window > 0 — violations come back as refusals and surface '
      + 'verbatim. RECOMMENDED for campaign launches: pass draftsFile (absolute path to the machine-validated '
      + 'campaign drafts JSON) + taskId instead of re-typing title/nodes/spec/policy by hand — file mode '
      + 'removes LLM transcription errors on large nested arguments. File mode also substitutes '
      + 'SPEC_PIN:<key> node specid placeholders with the pinIds you pass in specPinByKey (unmapped '
      + 'placeholders are refused). Never mix the two modes: either draftsFile+taskId, or inline arguments. '
      + 'After publishing you MUST post a discovery buzz within 24h (title + the full task-root pinId + '
      + '#metatask) — use the post_buzz tool. COMPETITIVE MODE: set policy.mode="competitive" + '
      + 'policy.finalnode (the designated terminal node); competitive publishes are refused before H_ACT3 '
      + 'activation unless allowPreActivation=true is passed (boolean body key). '
      + 'Requires the OAC daemon running.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title (inline mode).' },
        brief: { type: 'string', description: 'What the task is about; shown to every participant (inline mode).' },
        nodes: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
          description: 'Task tree nodes: {id, parent (null for the single root), title, kind, weight (basis points, ALL nodes sum to exactly 10000), specid?, params?, deps?} (inline mode).',
        },
        spec: { type: 'object', additionalProperties: true, description: 'Root verifier spec {name, lang, entry, script, input?, output?, validation?, workspace?} (inline mode).' },
        policy: {
          type: 'object',
          additionalProperties: true,
          description: 'verifyQuorum (integer >= 1, required), claimTtlHours, verifyWindowHours, submitterShareBP (default 8000), mode ("tree"|"competitive"), finalnode (competitive only) (inline mode).',
        },
        tags: { type: 'array', items: { type: 'string' }, description: 'Topic tags (inline mode).' },
        allowPreActivation: {
          type: 'boolean',
          description: 'true to allow a competitive publish before H_ACT3 activation (pilot/testing escape hatch). Serialized as a boolean body key — never a CLI flag.',
        },
        draftsFile: { type: 'string', description: 'Absolute path to the campaign drafts JSON; use with taskId instead of inline arguments (file mode).' },
        taskId: { type: 'string', description: 'The tasks[] entry id inside draftsFile to publish (file mode).' },
        specPinByKey: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'File mode only: spec key -> published specPinId, substituting SPEC_PIN:<key> node specid placeholders.',
        },
      },
    },
    output: { schema: { type: 'string' }, render },
    timeoutMs: METATASK_WRITE_TIMEOUT_MS,
    execute: async (args: Record<string, unknown>, exec: HostToolExec) => {
      const draftsFile = textOf(args.draftsFile)
      const taskId = textOf(args.taskId)
      const fileMode = Boolean(draftsFile || taskId)
      const inlineProvided =
        args.title !== undefined || args.brief !== undefined || args.nodes !== undefined
        || args.spec !== undefined || args.policy !== undefined || args.tags !== undefined
      if (fileMode && (!draftsFile || !taskId)) {
        return toolError(
          'metatask_publish',
          'Refused: draftsFile and taskId must be passed together (draftsFile = absolute path to the campaign drafts file, taskId = its tasks[] entry id).',
        )
      }
      if (fileMode && inlineProvided) {
        return toolError(
          'metatask_publish',
          'Refused: pass either draftsFile+taskId OR inline arguments (title/brief/nodes/spec/policy/tags), not both.',
        )
      }
      if (!fileMode && args.specPinByKey !== undefined) {
        return toolError(
          'metatask_publish',
          'Refused: specPinByKey only applies in draftsFile mode (pass draftsFile + taskId).',
        )
      }
      if (args.allowPreActivation !== undefined && typeof args.allowPreActivation !== 'boolean') {
        return toolError('metatask_publish', 'allowPreActivation must be a boolean (true to unlock pre-H_ACT3 competitive publishes).')
      }
      const payload: Record<string, unknown> = {}
      if (fileMode) {
        payload.draftsFile = draftsFile
        payload.taskId = taskId
        if (args.specPinByKey !== undefined) {
          if (!isPlainObject(args.specPinByKey)) {
            return toolError('metatask_publish', 'specPinByKey must be an object of spec key -> specPinId.')
          }
          payload.specPinByKey = args.specPinByKey
        }
      } else {
        const title = textOf(args.title)
        if (!title) return toolError('metatask_publish', 'Refused: title is empty.')
        payload.title = title
        const brief = textOf(args.brief)
        if (brief) payload.brief = brief
        if (args.nodes !== undefined) {
          if (!Array.isArray(args.nodes)) return toolError('metatask_publish', 'nodes must be an array of node objects.')
          payload.nodes = args.nodes
        }
        if (args.spec !== undefined) {
          if (!isPlainObject(args.spec)) return toolError('metatask_publish', 'spec must be an object.')
          payload.spec = args.spec
        }
        if (args.policy !== undefined) {
          if (!isPlainObject(args.policy)) return toolError('metatask_publish', 'policy must be an object.')
          payload.policy = args.policy
        }
        if (args.tags !== undefined) {
          if (!Array.isArray(args.tags)) return toolError('metatask_publish', 'tags must be an array of strings.')
          payload.tags = args.tags
        }
        if (args.allowPreActivation === true) payload.allowPreActivation = true
      }
      const slug = metataskActorSlug(host, hostAgent, exec)
      if (!slug) return toolError('metatask_publish', NO_ACTOR_MESSAGE)
      try {
        const outcome = await runMetabotWithPayloadFile(
          ['metatask', 'publish', '--from', slug],
          payload,
          '--request-file',
          [],
          run,
          { timeoutMs: METATASK_WRITE_TIMEOUT_MS },
        )
        if (!outcome.ok) return commandFailure('metatask_publish', outcome)
        return renderWriteData(outcome.data)
      } catch (error) {
        return thrownFailure('metatask_publish', error)
      }
    },
  }

  const publishSpec: HostToolDefinition = {
    name: 'metatask_publish_spec',
    description:
      'Publish a STANDALONE verifier spec pin (path /protocols/metatask/spec) as the session acting OAC MetaBot '
      + '— for node-level specid overrides that must exist BEFORE their task tree, with no carrier task (the '
      + 'old workaround published a junk single-node task just to harvest its specPinId). Exactly one pin is '
      + 'spent, after the writer-side gates pass: name + entry, a script that is inline text or a pin:// | '
      + 'metafile:// reference, and — by default — the v1.2.1 spec.validation block (null_tolerance, '
      + 'enumeration_closure with a closure string plus an integer self-check count, proposition_fidelity '
      + 'pointing at an independent correspondence artifact). Set enforceHAct2Validation=false (boolean) ONLY '
      + 'for a pre-H_ACT2 v1.1-era spec, where the block did not yet exist. RECOMMENDED for campaign '
      + 'launches: pass draftsFile (absolute path) + specKey instead of re-typing '
      + 'name/lang/entry/script/input/output/validation by hand — never mix the two modes. The returned '
      + 'specPinId is what node specid overrides (and a task-root specid) must reference. '
      + 'Requires the OAC daemon running.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Spec name, e.g. witness-extraction-301 (inline mode).' },
        lang: { type: 'string', description: 'Verifier implementation language, e.g. python3, bash (inline mode).' },
        entry: { type: 'string', description: 'Offline entry point, e.g. spec-witness-extraction.py (inline mode).' },
        script: { type: 'string', description: 'Inline verifier script text, or a pin:// | metafile:// reference when too long (inline mode).' },
        input: { description: 'Input descriptor (string or object); interpreted by the script (inline mode).' },
        output: { description: 'Output/verdict contract (string or object): pass | fail | invalid (inline mode).' },
        workspace: { type: 'object', additionalProperties: true, description: 'Workspace declaration (type: git | metafile | inline | pin; git nodes carry baseRef/baseCommit) (inline mode).' },
        validation: { type: 'object', additionalProperties: true, description: 'v1.2.1 validation block: null_tolerance, enumeration_closure, proposition_fidelity. Required unless enforceHAct2Validation=false (inline mode).' },
        enforceHAct2Validation: { type: 'boolean', description: 'Default true: enforce the v1.2.1 three-item validation block. Set false only for a pre-H_ACT2 (v1.1-era) spec.' },
        draftsFile: { type: 'string', description: 'Absolute path to the campaign drafts JSON; use with specKey instead of inline arguments (file mode).' },
        specKey: { type: 'string', description: 'Key under the draftsFile specs{} map to publish verbatim (file mode).' },
      },
    },
    output: { schema: { type: 'string' }, render },
    timeoutMs: METATASK_WRITE_TIMEOUT_MS,
    execute: async (args: Record<string, unknown>, exec: HostToolExec) => {
      const draftsFile = textOf(args.draftsFile)
      const specKey = textOf(args.specKey)
      const fileMode = Boolean(draftsFile || specKey)
      const inlineProvided =
        args.name !== undefined || args.lang !== undefined || args.entry !== undefined
        || args.script !== undefined || args.input !== undefined || args.output !== undefined
        || args.workspace !== undefined || args.validation !== undefined
      if (fileMode && (!draftsFile || !specKey)) {
        return toolError(
          'metatask_publish_spec',
          'Refused: draftsFile and specKey must be passed together (draftsFile = absolute path to the campaign drafts file, specKey = key under its specs{} map).',
        )
      }
      if (fileMode && inlineProvided) {
        return toolError(
          'metatask_publish_spec',
          'Refused: pass either draftsFile+specKey OR inline arguments (name/lang/entry/script/input/output/validation/workspace), not both.',
        )
      }
      if (args.enforceHAct2Validation !== undefined && typeof args.enforceHAct2Validation !== 'boolean') {
        return toolError('metatask_publish_spec', 'enforceHAct2Validation must be a boolean (false only for a pre-H_ACT2 v1.1-era spec).')
      }
      const payload: Record<string, unknown> = {}
      if (fileMode) {
        payload.draftsFile = draftsFile
        payload.specKey = specKey
      } else {
        for (const key of ['name', 'lang', 'entry'] as const) {
          const value = textOf(args[key])
          if (value) payload[key] = value
        }
        // Script text passes through VERBATIM (no trim): a verifier script's
        // leading indentation and trailing newline are semantic, and the
        // daemon forwards inline script bytes as-is.
        if (args.script !== undefined) {
          if (typeof args.script !== 'string') {
            return toolError('metatask_publish_spec', 'script must be a string (inline verifier text or a pin:// | metafile:// reference).')
          }
          payload.script = args.script
        }
        for (const key of ['input', 'output'] as const) {
          if (args[key] !== undefined) payload[key] = args[key]
        }
        for (const key of ['workspace', 'validation'] as const) {
          if (args[key] !== undefined) {
            if (!isPlainObject(args[key])) return toolError('metatask_publish_spec', `${key} must be an object.`)
            payload[key] = args[key]
          }
        }
      }
      // The escape hatch is a modifier in both modes: forwarded only when
      // explicitly false, as a boolean (the daemon default is true).
      if (args.enforceHAct2Validation === false) payload.enforceHAct2Validation = false
      const slug = metataskActorSlug(host, hostAgent, exec)
      if (!slug) return toolError('metatask_publish_spec', NO_ACTOR_MESSAGE)
      try {
        const outcome = await runMetabotWithPayloadFile(
          ['metatask', 'publish-spec', '--from', slug],
          payload,
          '--request-file',
          [],
          run,
          { timeoutMs: METATASK_WRITE_TIMEOUT_MS },
        )
        if (!outcome.ok) return commandFailure('metatask_publish_spec', outcome)
        return renderWriteData(outcome.data)
      } catch (error) {
        return thrownFailure('metatask_publish_spec', error)
      }
    },
  }

  const amend: HostToolDefinition = {
    name: 'metatask_amend',
    description:
      'Amend the task tree as the PUBLISHER only (the task root author). Ops may touch only nodes that were '
      + 'never effectively claimed (tree mode) / never satisfied (competitive mode) — frozen-node refusals, '
      + 'the weight invariant (sum exactly 10000 after the fold), deps integrity, and the pinned terminal '
      + '(competitive finalnode stays a live deps sink) are all enforced writer-side and surface verbatim. '
      + 'bases is computed daemon-side from the current tree head — never send it. The chain replay is '
      + 'authoritative: an amend this tool accepted but replay rejects is dead on chain. '
      + 'Requires the OAC daemon running.',
    parameters: {
      type: 'object',
      properties: {
        rootPinId: { type: 'string', description: 'Task root pinId (64 lowercase hex + i0, 66 chars).' },
        ops: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: true,
            description:
              'One of: {op:"add_node", node:{id, parent, title, kind, weight, specid?, params?, deps?}} | '
              + '{op:"remove_node", node} | {op:"reweight", node, weight} | {op:"retitle", node, title} | '
              + '{op:"respec", node, specid}.',
          },
        },
      },
      required: ['rootPinId', 'ops'],
    },
    output: { schema: { type: 'string' }, render },
    timeoutMs: METATASK_WRITE_TIMEOUT_MS,
    execute: async (args: Record<string, unknown>, exec: HostToolExec) => {
      const rootPinId = textOf(args.rootPinId)
      if (!rootPinId) return toolError('metatask_amend', 'rootPinId is required.')
      if (!Array.isArray(args.ops) || args.ops.length === 0) {
        return toolError('metatask_amend', 'ops must be a non-empty array of amend operations.')
      }
      const slug = metataskActorSlug(host, hostAgent, exec)
      if (!slug) return toolError('metatask_amend', NO_ACTOR_MESSAGE)
      // Payload is EXACTLY {root, ops} — `bases` is owned by the daemon and
      // computed from the current amend head; sending it is a protocol error.
      const payload: Record<string, unknown> = { root: rootPinId, ops: args.ops }
      try {
        const outcome = await runMetabotWithPayloadFile(
          ['metatask', 'amend', '--from', slug],
          payload,
          '--request-file',
          [],
          run,
          { timeoutMs: METATASK_WRITE_TIMEOUT_MS },
        )
        if (!outcome.ok) return commandFailure('metatask_amend', outcome)
        return renderWriteData(outcome.data)
      } catch (error) {
        return thrownFailure('metatask_amend', error)
      }
    },
  }

  return [publish, publishSpec, amend]
}

function isDuplicateToolError(error: unknown): boolean {
  return error instanceof Error && /already.*(registered|exists)|duplicate/i.test(error.message)
}

/** Register the MetaTask publisher tools on the host global layer during plugin apply. */
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
