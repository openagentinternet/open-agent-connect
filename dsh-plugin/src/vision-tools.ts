/**
 * Media description native tools (describe_image / describe_video /
 * describe_audio), OAC port of the IDBots visionRelayAgentTools family.
 *
 * The control executes the OAC core LLM relay client in-process (same
 * dist-root resolution as metaweb-tools/qa-tools): the machine-wide owner
 * identity signs the assist-base-service relay bootstrap, the relay key is
 * cached in ~/.metabot/owner/llm-relay.json, and each call posts to
 * /v2/assist/llm/vision/recognize (image description + OCR, video summary,
 * audio transcription) with exactly one re-bootstrap on a rejected key.
 * OAC_VISION_RELAY_URL + OAC_VISION_RELAY_API_KEY bypass the bootstrap with
 * pre-provisioned credentials. Works regardless of whether the session's
 * model is multimodal — the relay's VLM/ASR reads the media and the tool
 * returns plain text, so text-only models gain media understanding without
 * base64 ever entering the session.
 */
import path from 'node:path'
import { core } from './local-read.js'
import type { HostContext, HostToolDefinition } from './context-types.js'

export interface MediaDescriptionControl {
  describeImage(input: { path: string; question?: string }): Promise<string>
  describeVideo(input: { path: string; question?: string }): Promise<string>
  describeAudio(input: { source: string; prompt?: string }): Promise<string>
}

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
}

function arg(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === 'string' ? args[key].trim() : ''
}

function absolute(value: string, tool: string): string {
  if (!value) throw new Error(`${tool} requires a path`)
  if (!path.isAbsolute(value)) throw new Error(`${tool} requires an absolute local path; received "${value}"`)
  return value
}

export function buildMediaDescriptionToolDefinitions(control: MediaDescriptionControl): HostToolDefinition[] {
  return [
    {
      name: 'describe_image',
      description: 'Read one local image and return a visual description plus visible text (OCR). Use the absolute attachment path; an optional question focuses the answer.',
      parameters: { type: 'object', properties: { image_path: { type: 'string', description: 'Absolute local image path.' }, question: { type: 'string', description: 'Optional question about the image.' } }, required: ['image_path'], additionalProperties: false },
      output: TEXT_OUTPUT,
      timeoutMs: 150_000,
      async execute(args) { return control.describeImage({ path: absolute(arg(args, 'image_path'), 'describe_image'), question: arg(args, 'question') || undefined }) },
    },
    {
      name: 'describe_video',
      description: 'Watch one local video and return its content summary, timeline, and visible frame text. Videos longer than three minutes are analyzed from the beginning.',
      parameters: { type: 'object', properties: { video_path: { type: 'string', description: 'Absolute local video path.' }, question: { type: 'string', description: 'Optional question about the video.' } }, required: ['video_path'], additionalProperties: false },
      output: TEXT_OUTPUT,
      timeoutMs: 300_000,
      async execute(args) { return control.describeVideo({ path: absolute(arg(args, 'video_path'), 'describe_video'), question: arg(args, 'question') || undefined }) },
    },
    {
      name: 'describe_audio',
      description: 'Transcribe one local audio file, public http(s) audio URL, or data audio reference. Preserve the spoken language and punctuation; use prompt for a specific instruction.',
      parameters: { type: 'object', properties: { audio: { type: 'string', description: 'Absolute local path, public http(s) URL, or data audio reference.' }, prompt: { type: 'string', description: 'Optional transcription instruction.' } }, required: ['audio'], additionalProperties: false },
      output: TEXT_OUTPUT,
      timeoutMs: 240_000,
      async execute(args) {
        const source = arg(args, 'audio')
        if (!source) throw new Error('describe_audio requires audio')
        if (!/^https?:\/\//i.test(source) && !/^data:audio\//i.test(source)) absolute(source, 'describe_audio')
        return control.describeAudio({ source, prompt: arg(args, 'prompt') || undefined })
      },
    },
  ]
}

interface RelayDescribeResult {
  content?: unknown
  remainingToday?: unknown
  truncated?: unknown
}

/**
 * Control backed by the in-process OAC core relay client
 * (core/llm/llmRelayService.js). Throws when the dist root or the module
 * cannot be resolved so the binder can surface a clear error.
 */
export function controlFromCore(): MediaDescriptionControl {
  const relayModule = core('core/llm/llmRelayService.js') as {
    createLlmRelayService: (deps: Record<string, unknown>) => {
      describeImage(input: { path: string; question?: string }): Promise<RelayDescribeResult>
      describeVideo(input: { path: string; question?: string }): Promise<RelayDescribeResult>
      describeAudio(input: { source: string; prompt?: string }): Promise<RelayDescribeResult>
    }
    formatMediaRelayError: (kind: 'image' | 'video' | 'audio', message: string) => string
  }
  const homeSelection = core('core/state/homeSelection.js') as {
    normalizeSystemHomeDir: (env: NodeJS.ProcessEnv, cwd: string) => string
  }
  const relay = relayModule.createLlmRelayService({
    systemHomeDir: homeSelection.normalizeSystemHomeDir(process.env, process.cwd()),
    ...(process.env.OAC_VISION_RELAY_URL?.trim() && process.env.OAC_VISION_RELAY_API_KEY?.trim()
      ? {
        staticCredentials: {
          baseUrl: process.env.OAC_VISION_RELAY_URL!.trim(),
          apiKey: process.env.OAC_VISION_RELAY_API_KEY!.trim(),
        },
      }
      : {}),
  })
  const text = (result: RelayDescribeResult): string => {
    const content = typeof result.content === 'string' ? result.content : ''
    if (!content.trim()) throw new Error('media relay returned no content')
    return content
  }
  const footnote = (result: RelayDescribeResult): string =>
    typeof result.remainingToday === 'number' && result.remainingToday >= 0
      ? `\n(media quota units left today: ${result.remainingToday})`
      : ''
  const friendly = (kind: 'image' | 'video' | 'audio', error: unknown): never => {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(relayModule.formatMediaRelayError(kind, message))
  }
  return {
    async describeImage(input) {
      try { return text(await relay.describeImage(input)) } catch (error) { return friendly('image', error) }
    },
    async describeVideo(input) {
      try {
        const result = await relay.describeVideo(input)
        return `${text(result)}${result.truncated === true ? '\n(note: the source video exceeded 3 minutes; only the first 3 minutes were analyzed)' : ''}${footnote(result)}`
      } catch (error) { return friendly('video', error) }
    },
    async describeAudio(input) {
      try { return text(await relay.describeAudio(input)) } catch (error) { return friendly('audio', error) }
    },
  }
}

export function bindMediaDescriptionTools(ctx: HostContext, controlFactory: () => MediaDescriptionControl = controlFromCore): void {
  // Cordis contexts are guarded proxies: reading an undeclared service
  // property directly throws before the fallback can run. Use the optional
  // service lookup first, then retain a guarded direct read for plain-object
  // test contexts and hosts that explicitly inject this service.
  let control = ctx.get?.('mediaDescription') as MediaDescriptionControl | undefined
  if (!control) {
    try {
      control = (ctx as HostContext & { mediaDescription?: MediaDescriptionControl }).mediaDescription
    } catch {
      control = undefined
    }
  }
  if (!control) {
    try {
      control = controlFactory()
    } catch (error) {
      ctx.logger?.warn?.(`[oac-dsh] media tools could not bind the OAC relay client: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  control ??= {
    async describeImage() { throw new Error('media description is unavailable: the OAC CLI installation could not be resolved (reinstall open-agent-connect or set OAC_METABOT_CLI_PATH)') },
    async describeVideo() { throw new Error('media description is unavailable: the OAC CLI installation could not be resolved (reinstall open-agent-connect or set OAC_METABOT_CLI_PATH)') },
    async describeAudio() { throw new Error('media description is unavailable: the OAC CLI installation could not be resolved (reinstall open-agent-connect or set OAC_METABOT_CLI_PATH)') },
  }
  for (const definition of buildMediaDescriptionToolDefinitions(control)) {
    try { ctx.tools?.register(definition) } catch (error) {
      if (!(error instanceof Error && /already.*(registered|exists)|duplicate/i.test(error.message))) ctx.logger?.warn?.(`[oac-dsh] media tool install failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
