/**
 * skill_tool — native install/publish/list/read for on-chain metabot-skill
 * packages, OAC port of the IDBots skillAgentTools subset the MetaWeb learning
 * loop needs. All actions go through the OAC CLI: the DSH agent sandbox cannot
 * write ~/.metabot, and the CLI owns download, safe extraction, the install
 * registry, host re-binding, and the publish wallet path. Installs and
 * publishes ask DSH `ctx.approval` before the CLI's --confirm (same posture
 * as bot_browser_publish_app).
 */
import { runMetabot } from './cli-bridge.js'
import type { RunFn } from './cli-payload.js'
import type {
  HostAgentLike,
  HostApproval,
  HostApprovalOutcome,
  HostContext,
  HostToolDefinition,
  HostToolExec,
} from './context-types.js'
import { approvalOf, sessionApprovalPolicy } from './browser-tools.js'

export const SKILL_LEARNING_LOOP_SECTION = 'oac:metaweb-learning-loop'
export const SKILL_LEARNING_LOOP_ORDER = 143

/**
 * The search → pick → install → try SOP (IDBots coworkRunner parity; the
 * tools it names are the DSH native ones registered alongside it).
 */
export const SKILL_LEARNING_LOOP_TEXT = [
  '## Learning from MetaWeb tutorials',
  '',
  'When a tutorial, guide, or pin teaches a repeatable task — or the user asks you to learn something new from the AI internet — follow this loop:',
  '',
  '1. Extract the tutorial\'s concrete steps and execute them in order.',
  '2. When a step needs a skill, install the on-chain metabot-skill package the tutorial references: read the skill pin with read_metaweb_pin, then install it with skill_tool install_skill using that pinId (the package metafile:// URI lives in the pin payload\'s `skill-file` field). Never substitute a Web2 download for the referenced package.',
  '3. Before each install, tell the owner what you will install, why, and the source pinId. The native confirmation dialog is the gate — on decline, stop and report; never retry silently.',
  '4. After installing, verify with skill_tool list_installed_skills, load the instructions with skill_tool read_skill, then apply the new capability to the actual task (that is the demo the owner asked for).',
  '5. Report what you learned, which pins guided you (cited as pin:// links), and what you installed.',
  '6. Save the repeatable procedure with procedure_save (trigger/steps/pitfalls/sourcePinIds) so the task is never relearned; a single fact goes to knowledge_upsert instead.',
  '7. Substantial pin bodies worth keeping → knowledge_base_add_document with sourceType "metaweb" and the pinId.',
  '8. Close the loop: when you built or materially improved a reusable skill, offer to publish it back for other agents to learn — package the skill directory with skill_tool publish_skill (SKILL.md frontmatter carries name/version/description). Publishing writes two on-chain pins and spends small network fees as this bot, so always ask the owner first and wait for their confirmation.',
  '',
  'Where learned things live (pick exactly one home per lesson): knowledge bases (large reference corpora, cite with knowledge_base_query), procedures (repeatable multi-step workflows), knowledge_upsert (single standalone facts).',
  '',
  'Study on your own: queue background topics with metaweb_study_enqueue; it runs at night and is not for tasks the owner wants right now.',
].join('\n')

function textArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value.trim() : ''
}

function boolArg(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true
}

function dataOf(result: { ok: boolean; code?: string; message?: string; data?: unknown }): unknown {
  if (!result.ok) {
    throw new Error(result.message ?? result.code ?? 'metabot command failed')
  }
  return result.data
}

/** Last session approval policy, preferring the approval service's live override. */
function approvalPolicyOf(gate: HostApproval, agent: HostAgentLike | undefined): 'ask' | 'never' | undefined {
  const session = agent?.session
  if (session && typeof gate.overrideOf === 'function') {
    try {
      const fromService = gate.overrideOf(session)
      if (fromService === 'ask' || fromService === 'never') return fromService
    } catch {
      // Fall through to the session-event fold.
    }
  }
  return sessionApprovalPolicy(agent)
}

export interface SkillToolDependencies {
  ctx: HostContext
  run?: RunFn
}

/**
 * One aggregate tool (IDBots naming) so prompts stay portable across hosts:
 * install_skill / list_installed_skills / read_skill.
 */
export function buildSkillToolDefinitions(input: SkillToolDependencies): HostToolDefinition[] {
  const run = input.run ?? runMetabot
  const render = (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
  ]

  return [
    {
      name: 'skill_tool',
      description:
        'Install and use on-chain skill packages (metabot-skill protocol). install_skill takes the skill pin '
        + 'id you found via search_metaweb/read_metaweb_pin (preferred — full provenance) or a direct '
        + 'metafile:// zip URI, asks the owner for confirmation, downloads and safely installs the package '
        + 'under the shared skills root, and rebinds installed hosts. publish_skill packages a local skill '
        + 'directory (SKILL.md frontmatter carries name/version/description) and publishes it on-chain for '
        + 'other agents to learn — it writes two chain pins and spends small fees as this bot, so it always '
        + 'asks the owner first. list_installed_skills lists what is installed; read_skill loads one '
        + 'skill\'s SKILL.md so you can follow it immediately.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['install_skill', 'publish_skill', 'list_installed_skills', 'read_skill'],
            description: 'Which skill operation to run.',
          },
          pinId: { type: 'string', description: 'install_skill: the metabot-skill pin id (from search/read results).' },
          zip: { type: 'string', description: 'install_skill: direct package URI (metafile://<pinId> or https) when no protocol pin is known.' },
          dir: { type: 'string', description: 'publish_skill: local skill directory to package (its root, or single subdirectory, must carry SKILL.md).' },
          name: { type: 'string', description: 'read_skill: installed skill name. publish_skill: overrides the SKILL.md frontmatter name.' },
          version: { type: 'string', description: 'publish_skill: overrides the frontmatter version (required when it has none).' },
          description: { type: 'string', description: 'publish_skill: overrides the frontmatter description in the protocol pin.' },
          force: { type: 'boolean', description: 'install_skill: replace an existing installation even when the publisher differs.' },
        },
        required: ['action'],
      },
      output: { schema: { type: 'string' }, render },
      timeoutMs: 150_000,
      execute: async (args: Record<string, unknown>, exec: HostToolExec) => {
        const action = textArg(args, 'action')
        try {
          if (action === 'list_installed_skills') {
            const data = dataOf(await run(['skills', 'list'], { timeoutMs: 35_000 })) as { formatted?: string }
            return data?.formatted ?? JSON.stringify(data)
          }

          if (action === 'read_skill') {
            const name = textArg(args, 'name')
            if (!name) return 'read_skill requires the installed skill name (see list_installed_skills).'
            const data = dataOf(await run(['skills', 'read', '--name', name], { timeoutMs: 35_000 })) as {
              skillMd?: string
              files?: string[]
              skillDir?: string
            }
            const files = data?.files?.length ? `\n\nFiles under ${data.skillDir}: ${data.files.join(', ')}` : ''
            return `${data?.skillMd ?? ''}${files}`
          }

          if (action === 'install_skill') {
            const pinId = textArg(args, 'pinId')
            const zip = textArg(args, 'zip')
            if (!pinId && !zip) {
              return 'install_skill requires pinId (preferred) or zip (metafile:// or https URI). Read the skill pin with read_metaweb_pin first.'
            }
            const gate = approvalOf(input.ctx)
            if (!gate) {
              return 'Install refused: DSH approval is not available in this composition, so skill installs cannot be confirmed.'
            }
            const agent = exec.agent
            const policy = approvalPolicyOf(gate, agent)
            if (policy !== 'never') {
              const reason = [
                `Install skill package on this machine.`,
                pinId ? `Source pin: ${pinId}` : `Package: ${zip}`,
                'This downloads the on-chain package and installs it under the shared skills root (local disk; reversible via uninstall).',
              ].join('\n')
              const outcome: HostApprovalOutcome = await gate.request({
                agent,
                toolName: 'skill_tool',
                ...(exec.callId ? { callId: exec.callId } : {}),
                reason,
                signal: exec.signal,
              })
              if (outcome !== 'allowed-once') {
                return `Install cancelled by the user in the confirmation dialog (${outcome}). Do not retry unless the user explicitly asks again.`
              }
            }
            const cliArgs = [
              'skills', 'install',
              ...(pinId ? ['--pin', pinId] : ['--uri', zip]),
              '--confirm',
              ...(boolArg(args, 'force') ? ['--force'] : []),
            ]
            const data = dataOf(await run(cliArgs, { timeoutMs: 150_000 })) as {
              formatted?: string
              skill?: { name?: string; skillDir?: string }
            }
            return [
              data?.formatted ?? 'Installed.',
              '',
              `Read the instructions now with skill_tool read_skill (name: ${data?.skill?.name ?? '<name from install output>'}) and apply the skill to the task.`,
            ].join('\n')
          }

          if (action === 'publish_skill') {
            const dir = textArg(args, 'dir')
            if (!dir) {
              return 'publish_skill requires the local skill directory (its root, or single subdirectory, must carry SKILL.md with name/version frontmatter).'
            }
            const gate = approvalOf(input.ctx)
            if (!gate) {
              return 'Publish refused: DSH approval is not available in this composition, so on-chain skill publishing cannot be confirmed.'
            }
            const agent = exec.agent
            const policy = approvalPolicyOf(gate, agent)
            if (policy !== 'never') {
              const reason = [
                `Publish skill package on-chain as this bot.`,
                `Skill directory: ${dir}`,
                'This zips the directory, uploads it as a /file pin, and writes a /protocols/metabot-skill pin — two on-chain writes with small network fees. Publisher identity is this bot.',
              ].join('\n')
              const outcome: HostApprovalOutcome = await gate.request({
                agent,
                toolName: 'skill_tool',
                ...(exec.callId ? { callId: exec.callId } : {}),
                reason,
                signal: exec.signal,
              })
              if (outcome !== 'allowed-once') {
                return `Publish cancelled by the user in the confirmation dialog (${outcome}). Do not retry unless the user explicitly asks again.`
              }
            }
            const cliArgs = [
              'skills', 'publish',
              '--dir', dir,
              '--confirm',
              ...(textArg(args, 'name') ? ['--name', textArg(args, 'name')] : []),
              ...(textArg(args, 'version') ? ['--skill-version', textArg(args, 'version')] : []),
              ...(textArg(args, 'description') ? ['--description', textArg(args, 'description')] : []),
            ]
            const data = dataOf(await run(cliArgs, { timeoutMs: 150_000 })) as {
              formatted?: string
              pinId?: string
            }
            return [
              data?.formatted ?? 'Published.',
              '',
              ...(data?.pinId ? [`Others can learn it: the skill is advertised by pin ${data.pinId} (protocol metabot-skill).`] : []),
            ].join('\n')
          }

          return `Unknown action "${action}". Use install_skill, publish_skill, list_installed_skills, or read_skill.`
        } catch (error) {
          return `skill_tool failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  ]
}

/**
 * Register skill_tool and the learning-loop prompt section on the host global
 * layer during plugin apply (visible from the first turn, including blank
 * session recomposes, exactly like the MetaWeb tools).
 */
export function bindSkillToolInstall(ctx: HostContext): void {
  ctx.systemPrompt?.section({
    name: SKILL_LEARNING_LOOP_SECTION,
    order: SKILL_LEARNING_LOOP_ORDER,
    text: SKILL_LEARNING_LOOP_TEXT,
  })
  for (const definition of buildSkillToolDefinitions({ ctx })) {
    try {
      ctx.tools?.register(definition)
    } catch (error) {
      if (!/already.*(registered|exists)|duplicate/i.test(error instanceof Error ? error.message : String(error))) {
        ctx.logger?.warn?.(`[oac-dsh] skill tool install failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
