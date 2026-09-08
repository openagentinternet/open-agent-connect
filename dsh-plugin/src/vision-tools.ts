import { readFile } from 'node:fs/promises'
import path from 'node:path'
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
      timeoutMs: 120_000,
      async execute(args) { return control.describeImage({ path: absolute(arg(args, 'image_path'), 'describe_image'), question: arg(args, 'question') || undefined }) },
    },
    {
      name: 'describe_video',
      description: 'Watch one local video and return its content summary, timeline, and visible frame text. Videos longer than three minutes are analyzed from the beginning.',
      parameters: { type: 'object', properties: { video_path: { type: 'string', description: 'Absolute local video path.' }, question: { type: 'string', description: 'Optional question about the video.' } }, required: ['video_path'], additionalProperties: false },
      output: TEXT_OUTPUT,
      timeoutMs: 180_000,
      async execute(args) { return control.describeVideo({ path: absolute(arg(args, 'video_path'), 'describe_video'), question: arg(args, 'question') || undefined }) },
    },
    {
      name: 'describe_audio',
      description: 'Transcribe one local audio file, public http(s) audio URL, or data audio reference. Preserve the spoken language and punctuation; use prompt for a specific instruction.',
      parameters: { type: 'object', properties: { audio: { type: 'string', description: 'Absolute local path, public http(s) URL, or data audio reference.' }, prompt: { type: 'string', description: 'Optional transcription instruction.' } }, required: ['audio'], additionalProperties: false },
      output: TEXT_OUTPUT,
      timeoutMs: 180_000,
      async execute(args) {
        const source = arg(args, 'audio')
        if (!source) throw new Error('describe_audio requires audio')
        if (!/^https?:\/\//i.test(source) && !/^data:audio\//i.test(source)) absolute(source, 'describe_audio')
        return control.describeAudio({ source, prompt: arg(args, 'prompt') || undefined })
      },
    },
  ]
}

function relayFromEnvironment(): MediaDescriptionControl {
  const endpoint = process.env.OAC_VISION_RELAY_URL?.trim()
  const token = process.env.OAC_VISION_RELAY_API_KEY?.trim()
  if (!endpoint || !token) return {
    async describeImage() { throw new Error('media description relay is not configured') },
    async describeVideo() { throw new Error('media description relay is not configured') },
    async describeAudio() { throw new Error('media description relay is not configured') },
  }
  const call = async (kind: string, input: Record<string, unknown>): Promise<string> => {
    const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ kind, ...input }), signal: AbortSignal.timeout(120_000) })
    const body = await response.json() as { content?: string; message?: string; data?: { content?: string } }
    if (!response.ok) throw new Error(body.message ?? `media relay HTTP ${response.status}`)
    const content = body.content ?? body.data?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('media relay returned no content')
    return content
  }
  const encoded = async (file: string) => Buffer.from(await readFile(file)).toString('base64')
  return {
    async describeImage(input) { return call('image', { imageBase64: await encoded(input.path), prompt: input.question }) },
    async describeVideo(input) { return call('video', { videoBase64: await encoded(input.path), prompt: input.question }) },
    async describeAudio(input) { return /^https?:\/\//i.test(input.source) || /^data:/i.test(input.source) ? call('audio', { audio: input.source, prompt: input.prompt }) : call('audio', { audioBase64: await encoded(input.source), prompt: input.prompt }) },
  }
}

function unavailable(): MediaDescriptionControl {
  return {
    async describeImage() { throw new Error('media description relay is not configured') },
    async describeVideo() { throw new Error('media description relay is not configured') },
    async describeAudio() { throw new Error('media description relay is not configured') },
  }
}

export function bindMediaDescriptionTools(ctx: HostContext): void {
  const control = (ctx as HostContext & { mediaDescription?: MediaDescriptionControl }).mediaDescription ?? relayFromEnvironment()
  for (const definition of buildMediaDescriptionToolDefinitions(control)) {
    try { ctx.tools?.register(definition) } catch (error) {
      if (!(error instanceof Error && /already.*(registered|exists)|duplicate/i.test(error.message))) ctx.logger?.warn?.(`[oac-dsh] media tool install failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
