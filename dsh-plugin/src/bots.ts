import { mkdtemp, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateCreatePayload } from './bots-input.js'
import { runMetabot, type MetabotCommandResult } from './cli-bridge.js'
import type { HostContext } from './context-types.js'
import { parseBotPersona } from './persona.js'
import { generatePreset, removePreset } from './preset.js'

export type LlmDirectory = {
  providers: Array<{ id: string; name: string }>
  modelsByProvider: Record<string, Array<{ id: string; name: string }>>
}

function profileFromResult(result: MetabotCommandResult): unknown {
  const data = result.data
  if (data && typeof data === 'object' && 'profile' in data) {
    return (data as { profile: unknown }).profile
  }
  return data
}

export async function listLlmDirectory(ctx: HostContext): Promise<LlmDirectory> {
  const llm = ctx.llm
  if (llm === undefined) {
    throw new Error('oac-dsh: llm service is not available')
  }
  const providers = llm.listProviders().map((provider) => ({
    id: provider.id,
    name: provider.name ?? provider.id,
  }))
  const modelsByProvider: LlmDirectory['modelsByProvider'] = {}
  for (const provider of providers) {
    try {
      const models = await llm.listModels(provider.id)
      modelsByProvider[provider.id] = models.map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
      }))
    } catch {
      modelsByProvider[provider.id] = []
    }
  }
  return { providers, modelsByProvider }
}

export async function createBot(
  ctx: HostContext,
  payload: unknown,
  run: typeof runMetabot = runMetabot,
): Promise<MetabotCommandResult> {
  const parsed = validateCreatePayload(payload)
  if (!parsed.ok) {
    return { ok: false, state: 'failed', code: parsed.code, message: parsed.message }
  }
  const args = [
    'bot', 'create',
    '--name', parsed.value.name,
    '--host', 'dsh',
    '--dsh-llm-provider', parsed.value.dshLlmProvider,
    '--dsh-llm-model', parsed.value.dshLlmModel,
  ]
  if (parsed.value.dshLlmFallbackProvider && parsed.value.dshLlmFallbackModel) {
    args.push(
      '--dsh-llm-fallback-provider', parsed.value.dshLlmFallbackProvider,
      '--dsh-llm-fallback-model', parsed.value.dshLlmFallbackModel,
    )
  }
  const result = await run(args)
  if (result.ok && result.state === 'success') {
    const bot = parseBotPersona(profileFromResult(result))
    if (bot) await generatePreset(ctx, bot)
  }
  return result
}

export async function updateBot(
  ctx: HostContext,
  slug: string,
  patch: Record<string, unknown>,
  run: typeof runMetabot = runMetabot,
): Promise<MetabotCommandResult> {
  const dir = await mkdtemp(join(tmpdir(), 'oac-dsh-upd-'))
  const payloadPath = join(dir, 'payload.json')
  await writeFile(payloadPath, JSON.stringify(patch), 'utf8')
  try {
    const result = await run(['bot', 'update', '--from', slug, '--payload-file', payloadPath])
    if (result.ok && result.state === 'success') {
      const shown = await run(['bot', 'show', '--from', slug])
      const bot = parseBotPersona(profileFromResult(shown))
      if (bot) await generatePreset(ctx, bot)
    }
    return result
  } finally {
    await unlink(payloadPath).catch(() => undefined)
  }
}

export async function deleteBot(
  ctx: HostContext,
  slug: string,
  run: typeof runMetabot = runMetabot,
): Promise<MetabotCommandResult> {
  const result = await run(['bot', 'delete', '--from', slug, '--confirm'])
  if (result.ok && result.state === 'success') {
    await removePreset(ctx, slug)
  }
  return result
}
